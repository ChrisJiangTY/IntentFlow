/** Model output rules for executable tasks and their human descriptions. */
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'

/** Structured result of translating or revising one complete task. */
export interface TaskText {
  readonly title: string
  readonly summary: string
  readonly markdown: string
}

/** The child returns both views so the host can verify that translation preserves execution text. */
export const TASK_TEXT_SCHEMA: ObjectJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'summary', 'markdown'],
  properties: {
    title: { type: 'string' }, summary: { type: 'string' }, markdown: { type: 'string' },
  },
}

/** A child returned task text that can be corrected without changing the submitted task. */
export class TaskTextValidationError extends TypeError {}

/**
 * Validate mechanically observable summary rules; semantic fidelity remains a model responsibility.
 * @param value - Structured model response.
 * @returns Validated task text.
 */
export function validateTaskText(value: unknown): TaskText {
  if (typeof value !== 'object' || value === null) throw new TaskTextValidationError('task translation returned no object')
  const text = value as Record<string, unknown>
  for (const key of ['title', 'summary', 'markdown']) {
    if (typeof text[key] !== 'string' || text[key].trim() === '') throw new TaskTextValidationError(`task translation requires ${key}`)
  }
  const result = text as unknown as TaskText
  if (!/\p{Script=Han}/u.test(result.summary) || Array.from(result.summary).length > 120) {
    throw new TaskTextValidationError('generated task summary must use Chinese and contain at most 120 characters')
  }
  if (result.summary.split(/[。！？!?]+/u).filter(part => part.trim()).length > 2
    || /[`\n]|https?:\/\/|(?:^|\s)(?:pnpm|npm|node|curl|git)\s|\bAC\s*\d/iu.test(result.summary)
    || /\b\w+\.(?:json|tsx?|jsx?|cjs|md)\b|\d+\s*个执行步骤/iu.test(result.summary)) {
    throw new TaskTextValidationError('generated task summary must be at most two sentences without commands, paths, or execution statistics')
  }
  return result
}

/** Human output policy shared by translation and user-directed revision. */
export const TASK_TEXT_POLICY = '以下规则只约束title和summary，不限制markdown中的完整执行细节：标题用动作和对象。摘要通常一句自然中文，建议20至60字，最多120字；说明要做什么以及人能感知的结果。只有需要人决策、风险或阻塞时增加第二句。保留影响用户判断的关键条件，不得编造承诺或把计划写成已完成。不要写路径、命令、步骤数量、验收编号、内部推理或营销措辞。对用户明确要求的产品名称、功能名称和业务数量必须保留。'
