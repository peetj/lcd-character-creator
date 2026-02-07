import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages (project site) base path
export default defineConfig({
  base: '/lcd-character-creator/',
  plugins: [react()],
})
