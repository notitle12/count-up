import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App' // 💡 뒤의 .jsx 확장자를 지우고 깔끔하게 'App'으로만 명시합니다.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)