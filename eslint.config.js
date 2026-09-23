/**
 * ESLint, as a second opinion rather than a gate: `npm run lint` reports, and
 * nothing — not `build`, not `typecheck`, not `test` — fails because of it.
 * The compiler (`vue-tsc`/`tsc` in strict mode) and Prettier remain the
 * checks that block; this catches the bugs they cannot see, such as an unused
 * variable or a Vue template mistake.
 *
 * Rules are the three recommended sets as they come, with the exceptions below
 * and a reason for each. Formatting is Prettier's alone.
 */
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Built output, installed packages and runtime data: nothing anyone wrote. */
const IGNORED = [
  "**/dist/**",
  "**/node_modules/**",
  "**/coverage/**",
  "**/.vite/**",
  "**/*.tsbuildinfo",
  // The hub's profile storage and the deploy directory's volumes, when run locally.
  "**/data/**",
  "deploy/**",
  ".claude/**",
];

export default defineConfig(
  { ignores: IGNORED },

  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs["flat/recommended"],
  // Prettier formats the templates; the layout rules in `flat/recommended`
  // would only argue with it, several hundred times.
  pluginVue.configs["no-layout-rules"],

  {
    // Diagnose rather than enforce: the point of this config is to be read.
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      // Kept deliberately where a library's types are too generic to name
      // (fastify's type providers, pino's raw request); each one is marked.
      "@typescript-eslint/no-explicit-any": "warn",
      // `_`-prefixed parameters are how this codebase says "required by the
      // signature, not used" (fakes in tests, event handlers).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
          ignoreRestSiblings: true,
        },
      ],
      // Every hit strips or rejects control characters on purpose: sanitising
      // file names and TeamSpeak's escaped protocol text is what they are for.
      "no-control-regex": "off",
      // A byte-order mark or a no-break space inside a regex or a string is
      // test data or input handling, never a typo; in code it still reports.
      "no-irregular-whitespace": [
        "error",
        { skipStrings: true, skipRegExps: true, skipTemplates: true },
      ],
      // Flags the defensive `let x = null; try { x = ... }` initialiser, which
      // is harmless; worth reading, not worth failing over.
      "no-useless-assignment": "warn",
      // `Desktop` and `Taskbar` are single words on purpose and clash with no
      // HTML element, which is all the rule protects against.
      "vue/multi-word-component-names": "off",
    },
  },

  {
    // `<script setup lang="ts">`: the Vue parser for the template, TypeScript's for the script.
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: [".vue"] },
    },
  },

  {
    files: ["apps/web/src/**/*.{ts,vue}"],
    languageOptions: { globals: globals.browser },
  },
  {
    // Unit tests run the browser modules under node, and read files from disk.
    files: ["apps/web/src/**/*.test.ts", "apps/web/vitest.setup.ts", "apps/web/vite.config.ts"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["apps/web/public/boot.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  {
    files: ["apps/web/public/sw.js"],
    languageOptions: { globals: globals.serviceworker, sourceType: "script" },
  },
  // The audio worklets name their own globals in a `/* global */` comment; adding
  // `globals.audioWorklet` as well would report each one as redeclared.
  {
    files: ["apps/hub/**/*.ts", "*.{js,mjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    // Node scripts driving Playwright: the callbacks they pass to
    // `page.evaluate()` run in the page, where `window` and `document` exist.
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Shared by the hub and the browser, so only what both have.
    files: ["packages/protocol/**/*.ts"],
    languageOptions: { globals: globals["shared-node-browser"] },
  },
);
