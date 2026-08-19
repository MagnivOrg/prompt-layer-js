/**
 * Shared Ctrl+C / SIGTERM cleanup for Eval SDK runs.
 *
 * The CLI registers SIGINT/SIGTERM (prints Interrupted, exits). Runners only
 * register cleanup here — they must not also call process.exit, or a race can
 * clear the abort registration before `eval_run_status: aborted` is PATCHed
 * and leave the dashboard stuck on Running.
 *
 * State lives on `globalThis` so `dist/cli.js` and `dist/index.js` (separate
 * tsup bundles that each inline this module) share one registry.
 */

type InterruptCleanup = () => Promise<void>;

type InterruptState = {
  cleanup: InterruptCleanup | null;
  inFlight: Promise<void> | null;
};

const GLOBAL_KEY = "__promptlayer_eval_interrupt_v1__" as const;

const getInterruptState = (): InterruptState => {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: InterruptState;
  };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { cleanup: null, inFlight: null };
  }
  return g[GLOBAL_KEY];
};

export const setEvalInterruptCleanup = (fn: InterruptCleanup | null): void => {
  const state = getInterruptState();
  state.cleanup = fn;
  if (fn) {
    // New eval run — allow a fresh abort. Do not clear `inFlight` when
    // unregistering (`fn === null`); an abort may already be underway.
    state.inFlight = null;
  }
};

/** Test helper — clears registration and any completed in-flight promise. */
export const resetEvalInterruptState = (): void => {
  const state = getInterruptState();
  state.cleanup = null;
  state.inFlight = null;
};

export const runEvalInterruptCleanup = (): Promise<void> => {
  const state = getInterruptState();
  if (state.inFlight) {
    return state.inFlight;
  }
  const fn = state.cleanup;
  state.cleanup = null;
  state.inFlight = (fn ? fn() : Promise.resolve()).catch(() => undefined);
  return state.inFlight;
};
