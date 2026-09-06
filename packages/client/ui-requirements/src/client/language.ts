/** Bilingual requirement content selection. */

import type { RequirementText } from '@deepseek-ai/dsh-session-requirements/client'

/** Language used for reviewer-authored requirement content. */
export type RequirementContentLanguage = 'zh' | 'en'

/**
 * Select one localized rendering while preserving legacy single-language snapshots.
 * @param value - bilingual reviewer text or a legacy plain string.
 * @param language - requested requirement content language.
 * @returns the requested rendering, or the original legacy text.
 */
export function requirementText(value: RequirementText, language: RequirementContentLanguage): string {
  return typeof value === 'string' ? value : value[language]
}
