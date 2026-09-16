/** Session-list projection of durable requirement graphs and Task-derived states. */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  RequirementGraphNodeStatus,
  RequirementGraphProjection,
  RequirementGraphRelationKind,
  RequirementRoundId,
  RequirementTaskId,
} from './types.ts'
import { requirementGraphNodes } from './document-graph.ts'

interface RequirementGraphStateNode {
  readonly requirementId: string
  readonly title: string
  readonly acceptanceRefs: readonly string[]
}

interface RequirementGraphStateRelation {
  readonly source: { readonly roundId: string; readonly requirementId: string }
  readonly target: { readonly roundId: string; readonly requirementId: string }
  readonly kind: RequirementGraphRelationKind
  readonly reason: string
}

interface RequirementGraphStateTask {
  readonly id: string
  readonly kind: 'implementation' | 'checkpoint' | 'final-test'
  readonly requirementRefs: readonly string[]
  readonly status: 'pending' | 'in_progress' | 'reviewing' | 'completed' | 'failed' | 'withdrawn'
}

interface RequirementGraphStateValidation {
  readonly status: 'pending' | 'processing' | 'completed' | 'failed'
  readonly regressions: readonly { readonly requirementId: string; readonly taskId?: string | undefined }[]
  readonly failedTaskIds: readonly string[]
}

interface RequirementGraphRoundState {
  readonly roundId: string
  readonly round: number
  readonly summary: string
  readonly documentRevision: number
  readonly nodes: readonly RequirementGraphStateNode[]
  readonly relations: readonly RequirementGraphStateRelation[]
  readonly tasks: readonly RequirementGraphStateTask[]
  readonly validation?: RequirementGraphStateValidation | undefined
}

/** Persisted fold state for the `requirementGraph` Session projection. */
interface RequirementGraphProjectionState {
  readonly metadata: Readonly<Record<string, { readonly round: number; readonly summary: string }>>
  readonly rounds: readonly RequirementGraphRoundState[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    requirementGraph: RequirementGraphProjectionState
  }
}

const nodeSchema = z.object({
  requirementId: z.string().min(1),
  title: z.string().min(1),
  acceptanceRefs: z.array(z.string().min(1)).min(1),
}).strict()

const nodeRefSchema = z.object({
  roundId: z.string().min(1),
  requirementId: z.string().min(1),
}).strict()

const relationSchema = z.object({
  source: nodeRefSchema,
  target: nodeRefSchema,
  kind: z.enum(['depends-on', 'refines', 'supersedes']),
  reason: z.string().min(1),
}).strict()

const taskSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['implementation', 'checkpoint', 'final-test']),
  requirementRefs: z.array(z.string().min(1)),
  status: z.enum(['pending', 'in_progress', 'reviewing', 'completed', 'failed', 'withdrawn']),
}).strict()

const validationSchema = z.object({
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  regressions: z.array(z.object({
    requirementId: z.string().min(1),
    taskId: z.string().min(1).optional(),
  }).strict()),
  failedTaskIds: z.array(z.string().min(1)),
}).strict()

const stateSchema: z.ZodType<RequirementGraphProjectionState> = z.object({
  metadata: z.record(z.string(), z.object({
    round: z.number().int().positive(),
    summary: z.string(),
  }).strict()),
  rounds: z.array(z.object({
    roundId: z.string().min(1),
    round: z.number().int().positive(),
    summary: z.string(),
    documentRevision: z.number().int().positive(),
    nodes: z.array(nodeSchema).min(1),
    relations: z.array(relationSchema),
    tasks: z.array(taskSchema),
    validation: validationSchema.optional(),
  }).strict()),
}).strict()

const projectedNodeSchema = nodeSchema.extend({
  status: z.enum(['pending', 'in-progress', 'verified', 'blocked']),
  taskIds: z.array(z.string().transform(value => value as RequirementTaskId)),
}).strict()

const projectionSchema: z.ZodType<RequirementGraphProjection> = z.object({
  rounds: z.array(z.object({
    roundId: z.string().transform(value => value as RequirementRoundId),
    round: z.number().int().positive(),
    summary: z.string(),
    documentRevision: z.number().int().positive(),
    nodes: z.array(projectedNodeSchema),
    relations: z.array(z.object({
      source: z.object({
        roundId: z.string().transform(value => value as RequirementRoundId),
        requirementId: z.string(),
      }).strict(),
      target: z.object({
        roundId: z.string().transform(value => value as RequirementRoundId),
        requirementId: z.string(),
      }).strict(),
      kind: z.enum(['depends-on', 'refines', 'supersedes']),
      reason: z.string(),
    }).strict()),
  }).strict()),
}).strict()

function replaceRound(
  rounds: readonly RequirementGraphRoundState[],
  roundId: string,
  replace: (round: RequirementGraphRoundState) => RequirementGraphRoundState | undefined,
): readonly RequirementGraphRoundState[] {
  const index = rounds.findIndex(round => round.roundId === roundId)
  if (index < 0) return rounds
  const current = rounds[index]
  if (current === undefined) return rounds
  const next = replace(current)
  if (next === current) return rounds
  if (next === undefined) return rounds.filter((_round, roundIndex) => roundIndex !== index)
  return rounds.map((round, roundIndex) => roundIndex === index ? next : round)
}

function referencesNode(refs: readonly string[], requirementId: string): boolean {
  return refs.some(ref => ref.startsWith(`${requirementId}.`))
}

function nodeStatus(
  node: RequirementGraphStateNode,
  tasks: readonly RequirementGraphStateTask[],
  validation: RequirementGraphStateValidation | undefined,
): RequirementGraphNodeStatus {
  const mapped = tasks.filter(task => task.status !== 'withdrawn'
    && referencesNode(task.requirementRefs, node.requirementId))
  const mappedIds = new Set(mapped.map(task => task.id))
  const validationBlocks = validation?.status === 'failed'
    || validation?.failedTaskIds.some(taskId => mappedIds.has(taskId))
    || validation?.regressions.some(regression => regression.taskId !== undefined
      ? mappedIds.has(regression.taskId)
      : true)
  if (validationBlocks || mapped.some(task => task.status === 'failed')) return 'blocked'
  if (validation?.status === 'completed') return 'verified'
  if (validation !== undefined || mapped.some(task => (
    task.status === 'in_progress' || task.status === 'reviewing' || task.status === 'completed'
  ))) return 'in-progress'
  return 'pending'
}

/** Pure projection definition registered by the host Requirements plugin. */
export const requirementGraphProjectionDefinition = {
  key: 'requirementGraph',
  stateVersion: 3,
  stateSchema,
  init: (): RequirementGraphProjectionState => ({ metadata: {}, rounds: [] }),
  apply: (state, event) => {
    switch (event.type) {
      case 'requirement/round': {
        const key = String(event.data.roundId)
        const prior = state.metadata[key]
        const metadata = {
          ...state.metadata,
          [key]: { round: event.data.round, summary: prior?.summary ?? '' },
        }
        const rounds = replaceRound(state.rounds, key, round => round.round === event.data.round
          ? round
          : { ...round, round: event.data.round })
        return { ...state, metadata, rounds }
      }
      case 'requirement/document': {
        const key = String(event.data.roundId)
        const prior = state.metadata[key]
        const metadata = {
          ...state.metadata,
          [key]: { round: prior?.round ?? 1, summary: event.data.summary },
        }
        const without = state.rounds.filter(round => round.roundId !== key)
        const nodes = event.data.valid ? requirementGraphNodes(event.data.markdown) : []
        const rounds = nodes.length === 0
          ? without
          : [...without, {
            roundId: key,
            round: prior?.round ?? 1,
            summary: event.data.summary,
            documentRevision: event.data.revision,
            nodes,
            relations: [],
            tasks: [],
          }].sort((left, right) => left.round - right.round)
        return { ...state, metadata, rounds }
      }
      case 'requirement/graph': {
        const key = String(event.data.roundId)
        const metadata = state.metadata[key] ?? { round: state.rounds.length + 1, summary: '' }
        const round: RequirementGraphRoundState = {
          roundId: key,
          round: metadata.round,
          summary: metadata.summary,
          documentRevision: event.data.documentRevision,
          nodes: event.data.nodes.map(node => ({ ...node, acceptanceRefs: [...node.acceptanceRefs] })),
          relations: event.data.relations.map(relation => ({
            ...relation,
            source: { ...relation.source },
            target: { ...relation.target },
          })),
          tasks: [],
        }
        const without = state.rounds.filter(candidate => candidate.roundId !== key)
        return { ...state, rounds: [...without, round].sort((left, right) => left.round - right.round) }
      }
      case 'requirement/task-list': {
        const key = String(event.data.roundId)
        const rounds = replaceRound(state.rounds, key, round => round.documentRevision !== event.data.documentRevision
          ? round
          : {
            ...round,
            validation: undefined,
            tasks: event.data.tasks.map(task => ({
              id: String(task.id),
              kind: task.kind,
              requirementRefs: [...task.requirementRefs],
              status: task.status,
            })),
          })
        return rounds === state.rounds ? state : { ...state, rounds }
      }
      case 'requirement/validation': {
        const key = String(event.data.roundId)
        const rounds = replaceRound(state.rounds, key, round => ({
          ...round,
          validation: {
            status: event.data.status,
            regressions: event.data.regressions.map(regression => ({
              requirementId: regression.requirementId,
              ...(regression.taskId === undefined ? {} : { taskId: String(regression.taskId) }),
            })),
            failedTaskIds: event.data.failedTaskIds.map(String),
          },
        }))
        return rounds === state.rounds ? state : { ...state, rounds }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema: projectionSchema,
    view: state => ({
      rounds: state.rounds.map(round => ({
        roundId: round.roundId as RequirementRoundId,
        round: round.round,
        summary: round.summary,
        documentRevision: round.documentRevision,
        nodes: round.nodes.map(node => ({
          ...node,
          status: nodeStatus(node, round.tasks, round.validation),
          taskIds: round.tasks.filter(task => task.status !== 'withdrawn'
            && referencesNode(task.requirementRefs, node.requirementId))
            .map(task => task.id as RequirementTaskId),
        })),
        relations: round.relations.map(relation => ({
          ...relation,
          source: { ...relation.source, roundId: relation.source.roundId as RequirementRoundId },
          target: { ...relation.target, roundId: relation.target.roundId as RequirementRoundId },
        })),
      })),
    }),
  },
} satisfies ProjectionDefinition<'requirementGraph', RequirementGraphProjectionState>
