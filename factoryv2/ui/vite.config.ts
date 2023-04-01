import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {

      // with options: http://localhost:5173/api/bar-> http://jsonplaceholder.typicode.com/bar
      '/trpc': {
        target: 'http://localhost:5000',
        ws: true
        //changeOrigin: true,
        //rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  }
})
