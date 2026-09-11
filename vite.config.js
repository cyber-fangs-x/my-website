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
        project1: new URL('./projects/project-1.html', import.meta.url).pathname,
      },
    },
  },
  server: {
    host: true, // same as --host
  },
})