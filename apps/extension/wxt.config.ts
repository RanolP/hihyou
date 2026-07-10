import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  // Explicit imports only — the real dependency graph must be greppable.
  imports: false,
  // Escape non-ASCII in emitted JS: Chrome refuses content scripts it
  // considers non-UTF-8, and ASCII output is immune (also survives
  // partial Syncthing syncs of multibyte sequences).
  vite: () => ({
    esbuild: { charset: 'ascii' },
    build: { target: 'es2020' },
  }),
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
    // Patch fallback when the daemon isn't running.
    permissions: ['storage', 'clipboardWrite'],
  },
});
