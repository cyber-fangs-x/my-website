import { defineConfig } from 'vite'

export default defineConfig({
  base: '/my-website/',
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        about: new URL('./about.html', import.meta.url).pathname,
        contact: new URL('./contact.html', import.meta.url).pathname,
        projects: new URL('./projects.html', import.meta.url).pathname,
        heatMethod: new URL('./projects/heat-method/index.html', import.meta.url).pathname,
        minimalSurface: new URL('./projects/minimal-surface/index.html', import.meta.url).pathname,
      },
    },
  },
  server: {
    host: true, // same as --host
  },
})