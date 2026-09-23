/**
 * Unit tests run on the plain node environment — the modules under test are
 * logic, not components. A couple of them reach browser globals at import time
 * (the i18n module reads the saved locale), so those are stubbed here rather
 * than pulling a full DOM implementation in for two properties.
 *
 * A test that genuinely needs a DOM should say so with `@vitest-environment`.
 */
if (!("localStorage" in globalThis)) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

// Node ships a `navigator` without `language`, which the locale sniff reads.
if (typeof navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en" } });
} else if (!navigator.language) {
  Object.defineProperty(navigator, "language", { configurable: true, value: "en" });
}
