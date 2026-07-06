import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import { App } from './app.tsx'
import './index.css'
import { boot } from './state/appStore.ts'

void boot()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
