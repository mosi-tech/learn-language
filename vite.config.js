import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ollamaTarget = env.OLLAMA_API_URL || 'http://localhost:11434'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/chat': {
          target: ollamaTarget,
          changeOrigin: true,
          headers: env.OLLAMA_API_KEY ? { Authorization: `Bearer ${env.OLLAMA_API_KEY}` } : {},
        },
        '^/api/tts/.*': {
          target: 'https://api.elevenlabs.io',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/tts\//, '/v1/text-to-speech/'),
          headers: env.ELEVENLABS_API_KEY ? { 'xi-api-key': env.ELEVENLABS_API_KEY } : {},
        },
      },
    },
  }
})