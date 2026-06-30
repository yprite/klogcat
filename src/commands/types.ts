import type { SettingsValidationError } from '../types/settings'

export type CommandError = {
  code: string
  message: string
  details?: string
  validationErrors?: SettingsValidationError[]
}

export function commandErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) {
    const candidate = error as { message: unknown; details?: unknown }
    const message = String(candidate.message)
    return candidate.details ? `${message}: ${String(candidate.details)}` : message
  }
  return String(error)
}
