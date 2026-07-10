import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'hihyou',
    description: '批評 — an alternative GitHub code review experience',
  },
});
