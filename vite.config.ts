import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' — чтобы сборка работала и с корня домена, и из подпапки GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react()],
  // порт задаёт панель превью через PORT: в папке могут работать серверы нескольких сессий
  server: { port: Number(process.env.PORT) || 5181 },
});
