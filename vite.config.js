import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 🚨 중요: 깃허브 레포지토리 이름을 앞뒤 슬래시(/)와 함께 꼭 적어주세요!
  base: '/count-up/', 
})