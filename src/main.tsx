import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import './layout-fixes.css'
import App from './App'
import { installCloudTransitionOverlay } from './story/cloudTransition'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
installCloudTransitionOverlay()
