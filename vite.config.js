import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const src = (p) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

// No `base` here: the host sets it (Webflow Cloud mounts the app at a subpath
// and sets Vite's base at build time). Code builds URLs from
// import.meta.env.BASE_URL, never from '/'.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@core': src('core'), '@data': src('data'), '@models': src('models'), '@ui': src('ui') },
  },
})
