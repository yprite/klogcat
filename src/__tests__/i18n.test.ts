import { describe, expect, it } from 'vitest'
import { t, translatePhase } from '../utils/i18n'

describe('i18n utilities', () => {
  it('translates known Korean labels and interpolates variables', () => {
    expect(t('ko', 'Targets: {count} selected', { count: 3 })).toBe('대상: 3개 선택됨')
    expect(t('ko', 'Unknown {value}', { value: 'label' })).toBe('Unknown label')
    expect(t('en', 'Targets: {count} selected', { count: 2 })).toBe('Targets: 2 selected')
  })

  it('translates Kubernetes phases only for Korean', () => {
    expect(translatePhase('ko', 'Running')).toBe('실행 중')
    expect(translatePhase('ko', 'Pending')).toBe('대기 중')
    expect(translatePhase('ko', 'Failed')).toBe('실패')
    expect(translatePhase('ko', 'Succeeded')).toBe('Succeeded')
    expect(translatePhase('en', 'Running')).toBe('Running')
  })
})
