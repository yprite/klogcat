import { useLogStore } from '../stores/logStore'
import { useSettingsStore } from '../stores/settingsStore'
import { t } from '../utils/i18n'

export function ActionDebugPanel() {
  const messages = useLogStore((s) => s.actionDebugMessages)
  const language = useSettingsStore((s) => s.settings?.language)
  if (messages.length === 0) return null
  return <section className="bg-slate-950 border border-slate-700 rounded p-2 text-xs font-mono space-y-1">
    <div className="text-slate-300 font-semibold">{t(language, 'Action debug')}</div>
    {messages.map((message, index) => <div key={`${index}-${message}`} className="text-slate-200">{message}</div>)}
  </section>
}
