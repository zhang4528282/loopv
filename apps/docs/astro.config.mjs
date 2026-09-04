import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// 与 apps/portal 保持一致：Tailwind v4 走 @tailwindcss/vite 插件
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
