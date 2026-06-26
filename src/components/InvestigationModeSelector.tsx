import type { KeyboardEvent } from 'react'
import type { LogViewerExtensionId, RegisteredLogViewerExtension } from '../extensions/logViewerExtensions'
import { useSettingsStore } from '../stores/settingsStore'
import { t } from '../utils/i18n'

export type InvestigationMode = LogViewerExtensionId

export type InvestigationModeOption = Pick<RegisteredLogViewerExtension, 'id' | 'label' | 'description'>

function safeDomId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-')
}

export function logViewerTabId(id: string) {
  return `log-viewer-tab-${safeDomId(id)}`
}

export function logViewerPanelId(id: string) {
  return `log-viewer-panel-${safeDomId(id)}`
}

export function InvestigationModeSelector({ value, modes, onChange }: { value: InvestigationMode; modes: readonly InvestigationModeOption[]; onChange: (mode: InvestigationMode) => void }) {
  const language = useSettingsStore((s) => s.settings?.language)
  const selectedMode = modes.find((mode) => mode.id === value) ?? modes[0]
  const selectedIndex = Math.max(0, modes.findIndex((mode) => mode.id === selectedMode?.id))
  const selectByIndex = (index: number) => {
    const mode = modes[index]
    if (mode) onChange(mode.id)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (modes.length === 0) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      selectByIndex((selectedIndex + 1) % modes.length)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      selectByIndex((selectedIndex - 1 + modes.length) % modes.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      selectByIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectByIndex(modes.length - 1)
    }
  }
  return <div className="flex shrink-0 items-center justify-between gap-3 rounded border border-slate-800 bg-slate-950 px-2 py-1" aria-label={t(language, 'Investigation mode selector')}>
    <div role="tablist" aria-label={t(language, 'Investigation mode')} className="flex items-center gap-1" onKeyDown={handleKeyDown}>
      {modes.map((mode) => {
        const selected = value === mode.id
        return <button
          key={mode.id}
          id={logViewerTabId(mode.id)}
          type="button"
          role="tab"
          aria-controls={logViewerPanelId(mode.id)}
          aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          className={`rounded px-3 py-1 text-xs font-semibold transition ${selected ? 'bg-yellow-300 text-slate-950' : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-yellow-300 hover:text-yellow-200'}`}
          onClick={() => onChange(mode.id)}
        >
          {t(language, mode.label)}
        </button>
      })}
    </div>
    <span className="hidden text-[11px] text-slate-400 sm:inline">{t(language, selectedMode?.description ?? '')}</span>
  </div>
}
