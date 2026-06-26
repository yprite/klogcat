import type { AppLanguage } from '../types/settings'

export const supportedLanguages = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'ko', label: 'Korean', nativeLabel: '한국어' },
] as const satisfies ReadonlyArray<{ code: AppLanguage; label: string; nativeLabel: string }>

type TranslationKey =
  | 'top.selectTarget'
  | 'top.targetsSelected'
  | 'top.changeTargets'
  | 'top.settings'
  | 'top.targetsDetail'

const translations: Record<AppLanguage, Record<TranslationKey, string>> = {
  en: {
    'top.selectTarget': 'Select a target',
    'top.targetsSelected': 'Targets selected',
    'top.changeTargets': 'Change Targets',
    'top.settings': 'Settings',
    'top.targetsDetail': 'Targets: {count} selected',
  },
  ko: {
    'top.selectTarget': '대상을 선택하세요',
    'top.targetsSelected': '대상 선택됨',
    'top.changeTargets': '대상 변경',
    'top.settings': '설정',
    'top.targetsDetail': '대상: {count}개 선택됨',
  },
}

export function normalizeLanguage(value: unknown): AppLanguage {
  return value === 'ko' ? 'ko' : 'en'
}

export function t(language: AppLanguage | undefined, key: TranslationKey, params: Record<string, string | number> = {}) {
  const template = translations[normalizeLanguage(language)][key]
  return Object.entries(params).reduce((value, [param, replacement]) => value.replaceAll(`{${param}}`, String(replacement)), template)
}
