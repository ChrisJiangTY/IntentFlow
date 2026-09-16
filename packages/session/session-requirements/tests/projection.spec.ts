import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { requirementGraphProjectionDefinition } from '../src/projection.ts'

const roundId = 'ROUND-01' as never

function event<T extends SessionEvent['type']>(
  type: T,
  data: Extract<SessionEvent, { type: T }>['data'],
  seq: number,
): Extract<SessionEvent, { type: T }> {
  return { type, data, seq, time: seq } as Extract<SessionEvent, { type: T }>
}

function fold(events: readonly SessionEvent[]) {
  let state = requirementGraphProjectionDefinition.init()
  for (const item of events) state = requirementGraphProjectionDefinition.apply(state, item)
  return requirementGraphProjectionDefinition.wire?.view(state)
}

const baseEvents = [
  event('requirement/round', {
    version: 1,
    revision: 1,
    roundId,
    round: 1,
    sourceMessageId: 'message' as never,
    language: 'zh',
    input: '构建页面。',
    status: 'document-ready',
  }, 0),
  event('requirement/document', {
    version: 1,
    revision: 1,
    roundId,
    turn: 1,
    summary: '构建页面',
    markdown: '# 需求文档',
    valid: true,
    issues: [],
  }, 1),
  event('requirement/graph', {
    version: 1,
    revision: 1,
    roundId,
    documentRevision: 1,
    nodes: [
      { requirementId: '1', title: '页面结构', acceptanceRefs: ['1.1', '1.2'] },
      { requirementId: '2', title: '提交反馈', acceptanceRefs: ['2.1'] },
    ],
    relations: [{
      source: { roundId, requirementId: '2' },
      target: { roundId, requirementId: '1' },
      kind: 'depends-on',
      reason: '提交反馈依赖页面结构。',
    }],
  }, 2),
] as const satisfies readonly SessionEvent[]

describe('requirement graph Session projection', () => {
  it('rebuilds nodes from historical documents recorded before graph events existed', () => {
    const historical = event('requirement/document', {
      ...baseEvents[1].data,
      markdown: '# 需求文档\n\n## 简介\n\n历史需求。\n\n## 需求\n\n### 需求 1：历史页面\n\n**用户故事：** 作为用户，我希望打开页面，以便使用功能。\n\n#### 验收标准\n\n1. 当页面打开时，系统应当显示主要内容。\n2. 当任务完成时，系统应当显示结果。',
    }, 1)
    const projected = fold([baseEvents[0], historical])
    expect(projected?.rounds[0]?.nodes).toEqual([{
      requirementId: '1',
      title: '历史页面',
      acceptanceRefs: ['1.1', '1.2'],
      status: 'pending',
      taskIds: [],
    }])
  })

  it('keeps completed work in progress until final validation verifies the round', () => {
    const pending = fold(baseEvents)
    expect(pending?.rounds[0]?.nodes.map(node => node.status)).toEqual(['pending', 'pending'])

    const activeTasks = event('requirement/task-list', {
      version: 1,
      revision: 1,
      roundId,
      documentRevision: 1,
      tasks: [
        { id: 'TASK-1' as never, order: 0, kind: 'implementation', title: '页面', summary: '用户可以查看页面。', statement: '页面', requirementRefs: ['1.1', '1.2'], status: 'in_progress' },
        { id: 'TASK-2' as never, order: 1, kind: 'implementation', title: '反馈', summary: '用户可以获得反馈。', statement: '反馈', requirementRefs: ['2.1'], status: 'pending' },
        { id: 'FINAL' as never, order: 2, kind: 'final-test', title: '最终测试', summary: '确认完整体验可用。', statement: '测试', requirementRefs: ['1.1', '1.2', '2.1'], status: 'pending' },
      ],
    }, 3)
    expect(fold([...baseEvents, activeTasks])?.rounds[0]?.nodes.map(node => node.status))
      .toEqual(['in-progress', 'pending'])

    const completedTasks = event('requirement/task-list', {
      ...activeTasks.data,
      revision: 2,
      tasks: activeTasks.data.tasks.map(task => task.id === 'TASK-1' ? { ...task, status: 'completed' as const } : task),
    }, 4)
    const completed = fold([...baseEvents, activeTasks, completedTasks])
    expect(completed?.rounds[0]?.nodes.map(node => node.status)).toEqual(['in-progress', 'pending'])
    expect(completed?.rounds[0]?.nodes[0]?.taskIds).toEqual(['TASK-1', 'FINAL'])

    const finalTasks = event('requirement/task-list', {
      ...completedTasks.data,
      revision: 3,
      tasks: completedTasks.data.tasks.map(task => ({ ...task, status: 'completed' as const })),
    }, 5)
    expect(fold([...baseEvents, activeTasks, completedTasks, finalTasks])?.rounds[0]?.nodes
      .map(node => node.status)).toEqual(['in-progress', 'in-progress'])
    const validation = event('requirement/validation', {
      version: 1,
      revision: 1,
      roundId,
      turn: 3,
      reviewedThroughSeq: 5,
      status: 'completed',
      summary: { zh: '最终审核通过。', en: 'Final review passed.' },
      regressions: [],
      failedTaskIds: [],
    }, 6)
    expect(fold([...baseEvents, activeTasks, completedTasks, finalTasks, validation])?.rounds[0]?.nodes
      .map(node => node.status)).toEqual(['verified', 'verified'])

    const invalidatedTasks = event('requirement/task-list', {
      ...finalTasks.data,
      revision: 4,
      tasks: finalTasks.data.tasks.map(task => task.kind === 'final-test'
        ? { ...task, status: 'pending' as const }
        : task),
    }, 7)
    expect(fold([...baseEvents, activeTasks, completedTasks, finalTasks, validation, invalidatedTasks])?.rounds[0]?.nodes
      .map(node => node.status)).toEqual(['in-progress', 'in-progress'])
  })

  it('demotes a verified node when final validation attributes a regression to its Task', () => {
    const tasks = event('requirement/task-list', {
      version: 1,
      revision: 1,
      roundId,
      documentRevision: 1,
      tasks: [
        { id: 'TASK-1' as never, order: 0, kind: 'implementation', title: '页面', summary: '用户可以查看页面。', statement: '页面', requirementRefs: ['1.1', '1.2'], status: 'completed' },
        { id: 'FINAL' as never, order: 1, kind: 'final-test', title: '最终测试', summary: '确认完整体验可用。', statement: '测试', requirementRefs: ['1.1', '1.2', '2.1'], status: 'completed' },
      ],
    }, 3)
    const validation = event('requirement/validation', {
      version: 1,
      revision: 1,
      roundId,
      turn: 3,
      reviewedThroughSeq: 4,
      status: 'completed',
      summary: { zh: '发现回归。', en: 'Regression found.' },
      regressions: [{ requirementId: 'R-old', taskId: 'TASK-1' as never, reason: { zh: '页面损坏。', en: 'Page broke.' } }],
      failedTaskIds: [],
    }, 4)
    expect(fold([...baseEvents, tasks, validation])?.rounds[0]?.nodes.map(node => node.status))
      .toEqual(['blocked', 'verified'])
  })

  it('blocks the round when a regression cannot be attributed to one mapped Task', () => {
    const validation = event('requirement/validation', {
      version: 1,
      revision: 1,
      roundId,
      turn: 3,
      reviewedThroughSeq: 4,
      status: 'completed',
      summary: { zh: '发现未归因回归。', en: 'An unattributed regression was found.' },
      regressions: [{ requirementId: 'R-old', reason: { zh: '既有行为损坏。', en: 'Existing behavior broke.' } }],
      failedTaskIds: [],
    }, 3)
    expect(fold([...baseEvents, validation])?.rounds[0]?.nodes.map(node => node.status))
      .toEqual(['blocked', 'blocked'])
  })

  it('removes a graph when the current document revision has no valid graph', () => {
    const invalid = event('requirement/document', {
      version: 1,
      revision: 2,
      roundId,
      turn: 1,
      summary: '等待修订',
      markdown: '# 需求文档',
      valid: false,
      issues: ['缺少需求。'],
    }, 3)
    expect(fold([...baseEvents, invalid])?.rounds).toEqual([])
  })
})
