/**
 * One in-flight flag and one error line for an admin window: `run()` wraps a
 * command, shows its (already translated) failure, and resolves undefined
 * (`act`: false) instead of throwing, so templates only need `busy` and `error`.
 */
import { ref } from "vue";

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useBusy() {
  const busy = ref(false);
  const error = ref<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    busy.value = true;
    error.value = null;
    try {
      return await fn();
    } catch (err) {
      error.value = errorText(err);
      return undefined;
    } finally {
      busy.value = false;
    }
  }

  /** For commands that answer with nothing: true when it went through. */
  async function act(fn: () => Promise<unknown>): Promise<boolean> {
    let ok = false;
    await run(async () => {
      await fn();
      ok = true;
    });
    return ok;
  }

  return { busy, error, run, act };
}
