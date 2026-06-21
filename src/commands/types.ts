import type { SettingsValidationError } from '../types/settings'

export type CommandError = {
  code: string
  message: string
  details?: string
  validationErrors?: SettingsValidationError[]
}

export function commandErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}
