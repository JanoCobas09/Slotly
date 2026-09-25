import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Librerías que casi nunca cambian, en archivos aparte: el navegador
        // las guarda en caché entre despliegues y con cada cambio de la app
        // solo baja de nuevo el código propio. `react-dom/client` va explícito
        // porque es lo que importa main.jsx: con solo 'react-dom' en la lista,
        // React quedaba mezclado con el código de la app y se re-descargaba
        // entero en cada deploy.
        //
        // No listar acá nada que no se use: un módulo listado entra al build
        // aunque nadie lo importe (así quedaba un chunk "firebase" vacío,
        // resto de antes de la migración a Supabase).
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
