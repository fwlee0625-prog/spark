import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// 开发实例的 API 端口是 7789(生产实例为 7788),与 apps/server 的 dev 脚本保持一致;
// changeOrigin 保证 Host 头为 127.0.0.1:7789,通过服务的 Host 白名单校验
const apiTarget = `http://127.0.0.1:${process.env.SPARK_PORT ?? 7789}`;

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    host: '127.0.0.1', // 与服务一致只绑 IPv4 回环(默认 localhost 可能绑到 ::1)
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
