/** Select delivery and explanatory sections without exposing the execution transcript. */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'

interface TaskResult {
  readonly deliverables: string
  readonly notes: string
}

/**
 * Project recognized Markdown sections; unstructured reports remain available in the transcript.
 * @param source - Saved Agent output, including historical multi-message reports.
 * @returns Delivery and explanation Markdown with reference-link definitions preserved.
 */
export function taskResult(source: string): TaskResult {
  const sections: Record<keyof TaskResult, string[]> = { deliverables: [], notes: [] }
  const definitions: string[] = []
  let active: keyof TaskResult | undefined
  for (const node of fromMarkdown(source).children) {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    /* v8 ignore if -- fromMarkdown supplies source offsets for every parsed block. */
    if (start === undefined || end === undefined) throw new Error('Markdown parser omitted source offsets')
    const markdown = source.slice(start, end)
    if (node.type === 'heading') {
      const title = extractMarkdownPlainText(markdown).replace(/[：:]$/u, '').trim().toLowerCase()
      if (['交付结果', '交付文件', '交付物', 'deliverables', 'delivered files', 'delivery results'].includes(title)) active = 'deliverables'
      else if (['说明', '使用说明', '注意事项', 'notes', 'explanation', 'usage notes'].includes(title)) active = 'notes'
      else active = undefined
    } else if (node.type === 'definition') definitions.push(markdown)
    else if (active !== undefined) sections[active].push(markdown)
  }
  const content = (key: keyof TaskResult): string => sections[key].length === 0 ? '' : [...sections[key], ...definitions].join('\n\n')
  return { deliverables: content('deliverables'), notes: content('notes') }
}
