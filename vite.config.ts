import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' — чтобы сборка работала и с корня домена, и из подпапки GitHub Pages
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5181 },
});
