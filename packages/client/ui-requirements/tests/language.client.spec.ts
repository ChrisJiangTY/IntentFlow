import { describe, expect, it } from 'vitest'
import { requirementText } from '../src/client/language.ts'

describe('requirement content language', () => {
  it('selects Chinese and English from a bilingual review', () => {
    const value = { zh: '需求时间轴', en: 'Requirements timeline' }
    expect(requirementText(value, 'zh')).toBe('需求时间轴')
    expect(requirementText(value, 'en')).toBe('Requirements timeline')
  })

  it('preserves a legacy single-language review in either mode', () => {
    expect(requirementText('Requirements timeline', 'zh')).toBe('Requirements timeline')
    expect(requirementText('Requirements timeline', 'en')).toBe('Requirements timeline')
  })
})
