import { describe, expect, it, vi } from "vitest";
import { DefaultEvalTerminal } from "@/evaluations/terminal";

describe("CLI interrupt handling", () => {
  it("stops the terminal spinner and exits on SIGINT", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const terminal = new DefaultEvalTerminal();
    const stopSpy = vi.spyOn(terminal, "stop");

    let exiting = false;
    const stop = (signal: NodeJS.Signals) => {
      if (exiting) return;
      exiting = true;
      terminal.stop();
      process.stderr.write(`\nInterrupted (${signal})\n`);
      const code = signal === "SIGINT" ? 130 : 143;
      setTimeout(() => {
        try {
          process.kill(process.pid, "SIGKILL");
        } catch {
          // ignore
        }
      }, 500).unref?.();
      process.exit(code);
    };

    process.on("SIGINT", stop);
    try {
      process.emit("SIGINT", "SIGINT");
      expect(stopSpy).toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledWith("\nInterrupted (SIGINT)\n");
      expect(exitSpy).toHaveBeenCalledWith(130);
    } finally {
      process.off("SIGINT", stop);
      exitSpy.mockRestore();
      killSpy.mockRestore();
      writeSpy.mockRestore();
    }
  });
});
