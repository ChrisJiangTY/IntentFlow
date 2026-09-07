import { describe, expect, it } from 'vitest'
import type {
  RequirementExecutionNode,
  RequirementViewNode,
  RequirementReviewNode,
  RequirementUserVersionNode,
} from '../src/client/contract.ts'
import { RequirementsSnapshotBuilder } from '../src/client/assembly.ts'

function node(seq: number, id: string): RequirementReviewNode {
  return {
    key: `review:${seq}`,
    kind: 'requirements-review',
    id: String(seq),
    target: 'requirements',
    anchorSeq: seq,
    time: seq * 10,
    data: {
      version: 1,
      status: 'completed',
      turn: seq,
      reviewedThroughSeq: seq - 1,
      reviewerSessionId: `reviewer-${seq}` as never,
      requirements: [{
        id,
        title: `Requirement ${id}`,
        statement: `Statement ${seq}`,
        lifecycle: 'active',
        change: seq === 1 ? 'added' : 'refined',
        sources: [],
        code: [],
        audit: { status: 'unverified', summary: 'No evidence.', gaps: ['Implementation'] },
      }],
    },
  }
}

function userVersionNode(seq: number): RequirementUserVersionNode {
  return {
    key: `user-version:${seq}`,
    kind: 'requirements-user-version',
    id: String(seq),
    target: 'requirements',
    anchorSeq: seq,
    time: seq * 10,
    data: {
      version: 1,
      operation: 'revised',
      requirementId: 'R1' as never,
      requirementVersion: 2,
      language: 'en',
      title: 'Editable requirements',
      statement: 'Each requirement can be revised and run independently.',
      messageId: 'message-1' as never,
    },
  }
}

function executionNode(seq: number): RequirementExecutionNode {
  return {
    key: `execution:${seq}`,
    kind: 'requirements-execution',
    id: String(seq),
    target: 'requirements',
    anchorSeq: seq,
    time: seq * 10,
    data: {
      version: 1,
      requirementId: 'R1' as never,
      requirementVersion: 2,
      messageId: 'message-1' as never,
      status: 'processing',
      turn: 3,
    },
  }
}

function notebookNode(kind: RequirementViewNode['kind'], data: unknown, seq: number): RequirementViewNode {
  return {
    key: `${kind}:${seq}`,
    kind,
    id: String(seq),
    target: 'requirements',
    anchorSeq: seq,
    time: seq * 10,
    data,
  } as RequirementViewNode
}

describe('requirements snapshot builder', () => {
  it('keeps every review ordered by the parent session sequence', () => {
    const builder = new RequirementsSnapshotBuilder()
    const first = builder.replace({ nodes: [node(3, 'R1'), node(1, 'R1')] })
    expect(first.reviews.map(review => review.anchorSeq)).toEqual([1, 3])

    const second = builder.apply({ upserts: [node(2, 'R2')] })
    expect(second.reviews.map(review => review.anchorSeq)).toEqual([1, 2, 3])
    expect(second.reviews.map(review => review.data.status === 'completed'
      ? review.data.requirements[0]?.id
      : undefined)).toEqual(['R1', 'R2', 'R1'])
  })

  it('keeps user versions and execution transitions separate from reviews', () => {
    const builder = new RequirementsSnapshotBuilder()
    const snapshot = builder.replace({
      nodes: [executionNode(5), node(2, 'R1'), userVersionNode(4)],
    })

    expect(snapshot.reviews.map(review => review.anchorSeq)).toEqual([2])
    expect(snapshot.userVersions.map(version => version.anchorSeq)).toEqual([4])
    expect(snapshot.executions.map(execution => execution.anchorSeq)).toEqual([5])
  })

  it('projects the round pipeline into ordered Notebook collections', () => {
    const builder = new RequirementsSnapshotBuilder()
    const roundId = 'ROUND-01' as never
    const snapshot = builder.replace({
      nodes: [
        notebookNode('requirements-validation', {
          version: 1, revision: 1, roundId, turn: 4, reviewedThroughSeq: 9, status: 'completed',
          summary: { zh: '已完成。', en: 'Completed.' }, regressions: [], failedTaskIds: [],
        }, 9),
        notebookNode('requirements-task-list', {
          version: 1, revision: 1, roundId, documentRevision: 1, tasks: [],
        }, 8),
        notebookNode('requirements-round', {
          version: 1, revision: 1, roundId, round: 1, sourceMessageId: 'message-1' as never,
          language: 'zh', input: '建立 Notebook', status: 'completed',
        }, 6),
        notebookNode('requirements-document', {
          version: 1, revision: 1, roundId, turn: 1, summary: '建立 Notebook',
          markdown: '# 需求文档\n\n## 简介\n\n建立 Notebook', valid: true, issues: [],
        }, 7),
      ],
    })

    expect(snapshot.rounds.map(item => item.data.roundId)).toEqual([roundId])
    expect(snapshot.documents).toHaveLength(1)
    expect(snapshot.taskLists).toHaveLength(1)
    expect(snapshot.validations).toHaveLength(1)
    expect(snapshot.rounds[0]!.anchorSeq).toBeLessThan(snapshot.validations[0]!.anchorSeq)
  })
})
