import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Base path is BUILD-TIME CONFIG, not code: master builds at "/" (default),
  // the customize branch's deploy workflow sets VITE_BASE_PATH=/admin/ so the
  // app lives under /admin behind its public landing page. Keeping this file
  // identical on every branch means bug-fixing merges never conflict here.
  // BASE_URL flows into asset URLs, index.html references, and the router
  // basename (see main.jsx).
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5134',
        changeOrigin: true,
      },
    },
  },
})
