import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// If deploying to GitHub Pages under a repo path, set base in CI or edit here.
export default defineConfig({
  plugins: [react()],
})
