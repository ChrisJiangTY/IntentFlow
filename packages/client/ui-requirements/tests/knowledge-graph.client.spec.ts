import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { describe, expect, it } from 'vitest'
import { workspaceRequirementGraph } from '../src/client/knowledge-graph.ts'

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

function workspaces(): WorkspaceSnapshot {
  return {
    items: [{
      workspaceId: 'WORKSPACE-01' as never,
      path: '/tmp/intentflow',
      title: 'IntentFlow',
      sessionIds: [currentSessionId, includedSessionId],
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
}

describe('Workspace requirement graph aggregation', () => {
  it('uses Workspace membership and keeps same-numbered requirements distinct by Session and round', () => {
    const graph = workspaceRequirementGraph(sessions(), workspaces(), currentSessionId)

    expect(graph.workspaceTitle).toBe('IntentFlow')
    expect(graph.sessions.map(session => session.title)).toEqual(['当前会话', '同项目会话'])
    expect(graph.nodes.map(node => node.key)).toEqual([
      'SESSION-01:ROUND-01:1',
      'SESSION-01:ROUND-02:1',
      'SESSION-02:ROUND-01:1',
    ])
    expect(graph.relations).toEqual([expect.objectContaining({
      sourceKey: 'SESSION-01:ROUND-02:1',
      targetKey: 'SESSION-01:ROUND-01:1',
      kind: 'refines',
    })])
  })
})
