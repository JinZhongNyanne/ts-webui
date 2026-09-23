/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Commit the bundle was built from, set by the Dockerfile; unset in dev. */
  readonly VITE_BUILD_ID?: string;
}
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

declare module "vue" {
  interface ComponentCustomProperties {
    /** Translation helper installed by `installI18n`; see src/i18n. */
    $t: (typeof import("./i18n"))["t"];
  }
}
export {};
