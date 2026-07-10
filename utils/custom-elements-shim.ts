/**
 * Content-script isolated worlds have `customElements === null`, which
 * crashes @pierre/trees at module scope (it probes the registry before
 * defining its container element). Its runtime mount path never relies on
 * upgrades — it calls attachShadow + prepareFileTreeShadowRoot directly —
 * so an inert registry is all it needs. Import BEFORE '@pierre/trees'.
 */

if (globalThis.customElements == null) {
  const registry = new Map<string, CustomElementConstructor>();
  // `customElements` is a getter-only Window accessor — plain assignment
  // silently no-ops; shadow it with an own data property.
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: {
      get: (name: string) => registry.get(name),
      define: (name: string, ctor: CustomElementConstructor) => {
        registry.set(name, ctor);
      },
      whenDefined: async (name: string) => registry.get(name),
      upgrade: () => {},
    },
  });
}

export {};
