import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    base: './', // CRITICAL for relative asset paths behind subdomain proxies
    server: {
        port: 3000,
        strictPort: true,
        proxy: {
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: true
            },
            '/socket.io': {
                target: 'http://localhost:8080',
                ws: true
            }
        }
    }
})
