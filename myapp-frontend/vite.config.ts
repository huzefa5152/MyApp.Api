import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // The ERP app is served under /admin — the public landing page owns "/".
  // BASE_URL flows into asset URLs, index.html references, and the router
  // basename (see main.jsx) so the whole app is /admin-rooted.
  base: '/admin/',
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
