import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'hihyou',
    description: '批評 — an alternative GitHub code review experience',
    // The background service worker hosts web-tree-sitter (github.com's
    // page CSP blocks WASM in content scripts).
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    // M13: npm tarballs + TS lib files fetched by the service worker.
    host_permissions: [
      'https://registry.npmjs.org/*',
      'https://playgroundcdn.typescriptlang.org/*',
    ],
  },
});
