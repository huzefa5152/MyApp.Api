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
      // Uploaded files (company/division logos, avatars) live under /data and
      // are served by the backend, NOT by Vite. Without this, the dev server's
      // SPA fallback returns index.html for /data/... so <img src="/data/…">
      // (e.g. {{companyLogoPath}} / {{divisionLogoPath}} in print templates)
      // renders blank in dev. Production serves the SPA + /data from the same
      // origin, so this only matters for the dev server.
      '/data': {
        target: 'http://localhost:5134',
        changeOrigin: true,
      },
    },
  },
})
