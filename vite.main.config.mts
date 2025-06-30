import { defineConfig } from "vite";
import path from "path";
import fs from "fs-extra";

// Custom plugin to copy the telegram host file
const copyTelegramHostFile = () => {
  return {
    name: 'copy-telegram-host-file',
    closeBundle: async () => {
      const source = path.resolve(__dirname, 'src/main/telegram/telegram_build_host.html');
      const destination = path.resolve(__dirname, '.vite/build/telegram_build_host.html');
      try {
        await fs.copy(source, destination);
        console.log('Successfully copied Telegram host file.');
      } catch (err) {
        console.error('Error copying Telegram host file:', err);
      }
    }
  }
}

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      external: ["better-sqlite3"],
      output: {
        sourcemap: true,
      },
    },
  },
  plugins: [
    copyTelegramHostFile(),
    {
      name: "restart",
      closeBundle() {
        process.stdin.emit("data", "rs");
      },
    },
  ],
});
