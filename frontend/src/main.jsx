import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { logEnvConfig, validateEnvConfig } from './config/env'

logEnvConfig()

if (import.meta.env.PROD) {
  const { ok, issues } = validateEnvConfig()
  if (!ok) {
    console.warn('[Env] Configuration warnings:', issues)
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
