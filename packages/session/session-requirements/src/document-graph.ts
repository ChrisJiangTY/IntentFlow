/** Deterministic graph-node extraction shared by authoring and historical projection replay. */

import type { RequirementGraphNode } from './types.ts'

/**
 * Collect stable acceptance-criterion references from a validated Chinese requirement document.
 * @param markdown - Complete requirement document Markdown.
 * @returns document-ordered references such as `1.1`.
 */
export function requirementAcceptanceRefs(markdown: string): Set<string> {
  const refs = new Set<string>()
  let requirement: string | undefined
  let inAcceptance = false
  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const heading = /^### 需求\s+(\d+)：/u.exec(line)
    if (heading?.[1] !== undefined) {
      requirement = heading[1]
      inAcceptance = false
      continue
    }
    if (/^#### 验收标准\s*$/u.test(line)) {
      inAcceptance = true
      continue
    }
    if (/^#{1,4}\s/u.test(line)) inAcceptance = false
    const criterion = inAcceptance ? /^(\d+)\.\s+\S/u.exec(line) : null
    if (requirement !== undefined && criterion?.[1] !== undefined) refs.add(`${requirement}.${criterion[1]}`)
  }
  return refs
}

/**
 * Extract top-level requirement graph nodes from a validated Chinese requirement document.
 * @param markdown - Complete requirement document Markdown.
 * @returns document-ordered nodes with their acceptance-criterion references.
 */
export function requirementGraphNodes(markdown: string): RequirementGraphNode[] {
  const normalized = markdown.replaceAll('\r\n', '\n')
  const knownRefs = requirementAcceptanceRefs(normalized)
  const headings = [...normalized.matchAll(/^### 需求\s+(\d+)：\s*(\S.*)$/gmu)]
  return headings.map((heading) => {
    const requirementId = heading[1]
    const title = heading[2]
    if (requirementId === undefined || title === undefined) {
      throw new Error('validated requirement document contains an unreadable requirement heading')
    }
    const acceptanceRefs = [...knownRefs].filter(ref => ref.startsWith(`${requirementId}.`))
    return { requirementId, title, acceptanceRefs }
  })
}
