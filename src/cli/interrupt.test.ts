import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetEvalInterruptState,
  runEvalInterruptCleanup,
  setEvalInterruptCleanup,
} from "@/evaluations/interrupt";
import { DefaultEvalTerminal } from "@/evaluations/terminal";

describe("eval interrupt cleanup registry", () => {
  afterEach(() => {
    resetEvalInterruptState();
    vi.restoreAllMocks();
  });

  it("runs registered cleanup once and dedupes concurrent calls", async () => {
    const cleanup = vi.fn(async () => undefined);
    setEvalInterruptCleanup(cleanup);

    await Promise.all([runEvalInterruptCleanup(), runEvalInterruptCleanup()]);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps in-flight abort when registration is cleared", async () => {
    let resolveCleanup!: () => void;
    let finished = false;
    const started = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    setEvalInterruptCleanup(async () => {
      await started;
      finished = true;
    });

    const first = runEvalInterruptCleanup();
    setEvalInterruptCleanup(null);
    // Second call must still await the in-flight abort, not resolve as a no-op.
    const second = runEvalInterruptCleanup();
    expect(finished).toBe(false);
    resolveCleanup();
    await Promise.all([first, second]);
    expect(finished).toBe(true);
  });

  it("no-ops when no cleanup is registered", async () => {
    await expect(runEvalInterruptCleanup()).resolves.toBeUndefined();
  });

  it("shares registry across simulated dual-bundle copies via globalThis", async () => {
    const cleanup = vi.fn(async () => undefined);
    // Mimic tsup splitting cli vs index: two module-level wrappers, one global state.
    const setA = setEvalInterruptCleanup;
    const runB = runEvalInterruptCleanup;
    setA(cleanup);
    await runB();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe("CLI interrupt handling", () => {
  afterEach(() => {
    resetEvalInterruptState();
    vi.restoreAllMocks();
  });

  it("awaits eval cleanup before exiting on SIGINT", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const terminal = new DefaultEvalTerminal();
    const stopSpy = vi.spyOn(terminal, "stop");
    let cleanupResolved = false;
    setEvalInterruptCleanup(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      cleanupResolved = true;
    });

    let exiting = false;
    const stop = (signal: NodeJS.Signals) => {
      if (exiting) return;
      exiting = true;
      terminal.stop();
      process.stderr.write(`\nInterrupted (${signal})\n`);
      const code = signal === "SIGINT" ? 130 : 143;
      void runEvalInterruptCleanup().finally(() => {
        process.exit(code);
      });
    };

    process.on("SIGINT", stop);
    try {
      process.emit("SIGINT", "SIGINT");
      expect(stopSpy).toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledWith("\nInterrupted (SIGINT)\n");
      await vi.waitFor(() => {
        expect(cleanupResolved).toBe(true);
        expect(exitSpy).toHaveBeenCalledWith(130);
      });
    } finally {
      process.off("SIGINT", stop);
    }
  });
});
