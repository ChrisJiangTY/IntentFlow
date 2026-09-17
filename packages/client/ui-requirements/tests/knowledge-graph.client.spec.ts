import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { describe, expect, it } from 'vitest'
import { sessionRequirementGraph, focusedTraceKeys } from '../src/client/knowledge-graph.ts'

import { EMPTY_REQUIREMENTS_SNAPSHOT } from '../src/client/assembly.ts'
import type { RequirementsSnapshot } from '../src/client/contract.ts'

const currentSessionId = 'SESSION-01' as never
const includedSessionId = 'SESSION-02' as never
const excludedSessionId = 'SESSION-03' as never
const firstRoundId = 'ROUND-01' as never
const secondRoundId = 'ROUND-02' as never

function sessions(): SessionListState {
  const summary = (id: typeof currentSessionId, title: string, roundId: typeof firstRoundId) => ({
    id,
    displayTitle: title,
    running: false,
    blank: false,
    updatedAt: 1,
    projectionValues: {
      requirementGraph: {
        rounds: [{
          roundId,
          round: 1,
          summary: title,
          documentRevision: 1,
          nodes: [{
            requirementId: '1', title, acceptanceRefs: ['1.1'], taskIds: [], status: 'pending' as const,
          }],
          relations: [],
        }],
      },
    },
  })
  return {
    ids: [currentSessionId, includedSessionId, excludedSessionId],
    byId: {
      [currentSessionId]: {
        ...summary(currentSessionId, '当前会话', firstRoundId),
        projectionValues: {
          requirementGraph: {
            rounds: [
              summary(currentSessionId, '当前会话', firstRoundId).projectionValues.requirementGraph.rounds[0]!,
              {
                roundId: secondRoundId,
                round: 2,
                summary: '第二轮',
                documentRevision: 1,
                nodes: [{
                  requirementId: '1', title: '第二轮需求', acceptanceRefs: ['1.1'], taskIds: [], status: 'verified',
                }],
                relations: [{
                  source: { roundId: secondRoundId, requirementId: '1' },
                  target: { roundId: firstRoundId, requirementId: '1' },
                  kind: 'refines',
                  reason: '第二轮细化第一轮。',
                }],
              },
            ],
          },
        },
      },
      [includedSessionId]: summary(includedSessionId, '同项目会话', firstRoundId),
      [excludedSessionId]: summary(excludedSessionId, '其他项目会话', firstRoundId),
    },
    current: currentSessionId,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

describe('Session requirement graph', () => {
  it('excludes other Sessions and preserves round identity', () => {
    const graph = sessionRequirementGraph(sessions(), EMPTY_REQUIREMENTS_SNAPSHOT, currentSessionId)
    expect(graph.title).toBe('当前会话')
    expect(graph.documents.map(node => [node.key, node.title])).toEqual([['document:ROUND-01', '当前会话'], ['document:ROUND-02', '第二轮']])
    expect(graph.requirements.map(node => node.key)).toEqual(['requirement:ROUND-01:1', 'requirement:ROUND-02:1'])
    expect(graph.tasks).toEqual([])
    expect(sessionRequirementGraph(sessions(), EMPTY_REQUIREMENTS_SNAPSHOT, 'absent' as never).requirements).toEqual([])
  })

  it('joins exact document revisions and Turn IDs, sharing file nodes across Tasks', () => {
    const list = sessions()
    const summary = list.byId[currentSessionId]!
    const changes = [
      { path: 'shared.ts', oldText: 'a', newText: 'b', seq: 10, turn: 2 },
      { path: 'shared.ts', oldText: 'b', newText: 'c', seq: 11, turn: 3 },
      { path: 'unrelated.ts', oldText: null, newText: 'x', seq: 12, turn: 99 },
    ]
    const withChanges = { ...list, byId: { ...list.byId, [currentSessionId]: {
      ...summary, projectionValues: { ...summary.projectionValues, requirementChanges: { changes } },
    } } }
    const task = (id: string) => ({ id, title: id, summary: '', statement: '', kind: 'implementation', order: 0, status: 'completed', requirementRefs: ['1.1'] })
    const notebook = {
      ...EMPTY_REQUIREMENTS_SNAPSHOT,
      taskLists: [{ anchorSeq: 4, data: {
        roundId: firstRoundId, documentRevision: 1, tasks: [task('T1'), task('T2'), { ...task('T3'), status: 'withdrawn' }],
      } }],
      taskExecutions: [
        { data: { roundId: firstRoundId, taskId: 'T1', turn: 2 } },
        { data: { roundId: firstRoundId, taskId: 'T2', turn: 3 } },
      ],
    } as unknown as RequirementsSnapshot
    const graph = sessionRequirementGraph(withChanges, notebook, currentSessionId)
    expect(graph.tasks).toHaveLength(2)
    expect(graph.files).toHaveLength(1)
    expect(graph.files[0]?.changes.map(change => change.turn)).toEqual([2, 3])
    expect(graph.edges).toHaveLength(6)
    expect([...focusedTraceKeys(graph, 'task:ROUND-01:T1')].sort()).toEqual(['document:ROUND-01', 'file:shared.ts', 'requirement:ROUND-01:1', 'task:ROUND-01:T1'])
    expect(focusedTraceKeys(graph, 'file:shared.ts').has('task:ROUND-01:T2')).toBe(true)
    expect(focusedTraceKeys(graph, undefined).size).toBe(7)
    const ambiguous = { ...notebook, taskExecutions: notebook.taskExecutions.map(execution => ({
      ...execution, data: { ...execution.data, turn: 2 },
    })) }
    expect(sessionRequirementGraph(withChanges, ambiguous, currentSessionId).files).toEqual([])
    const changedDocument = { ...notebook, taskLists: [{
      ...notebook.taskLists[0]!, data: { ...notebook.taskLists[0]!.data, documentRevision: 9 },
    }] }
    expect(sessionRequirementGraph(withChanges, changedDocument, currentSessionId).files).toEqual([])
  })
})
