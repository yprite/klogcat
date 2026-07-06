import React from 'react'
import ReactDOM from 'react-dom/client'
import { applyColorTheme, initialColorTheme } from './utils/colorTheme'
import { loadLogPolicyConfig } from './utils/logPolicy'
import './index.css'

applyColorTheme(initialColorTheme())

async function bootstrap() {
  const result = await loadLogPolicyConfig('/log-policy.json')
  if (!result.loaded) console.warn(`Using embedded default log policy: ${result.error ?? 'runtime config not loaded'}`)
  const { default: App } = await import('./App')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void bootstrap()
