import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { voice } from './audio/voice'
import { useGame } from './game/store'

// Dev-only handles for forcing states in visual QA (screenshots, Playwright). Tree-shaken
// out of production builds: `import.meta.env.DEV` is replaced with false by Vite.
if (import.meta.env.DEV) {
  Object.assign(window, { __petStore: useGame, __petVoice: voice })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
