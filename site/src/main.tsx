import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/caprasimo'
import '@fontsource-variable/figtree'
import { App } from './App.tsx'
import './styles.css'

// `?preview=panel` renders the real in-DSH settings tab inside a mock host
// window instead of the public site, so the panel UI can be checked in a
// plain browser. It is code-split: visitors to the site never download the
// plugin bundle.
const PanelPreview = lazy(async () => {
  const module = await import('./PanelPreview.tsx')
  return { default: module.PanelPreview }
})

const root = document.getElementById('root')

if (root === null) throw new Error('missing #root')

const previewPanel = new URLSearchParams(window.location.search).get('preview') === 'panel'

createRoot(root).render(
  <StrictMode>
    {previewPanel
      ? <Suspense fallback={null}><PanelPreview /></Suspense>
      : <App />}
  </StrictMode>,
)
