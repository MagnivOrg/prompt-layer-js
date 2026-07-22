#!/usr/bin/env node
import { Command } from "commander";
import { DefaultEvalTerminal } from "@/evaluations/terminal";
import { runEvalCommand } from "./eval-run";

const program = new Command()
  .name("promptlayer")
  .description("PromptLayer command-line interface");

program
  .command("eval")
  .description("Run evaluation files")
  .command("run")
  .argument("<paths...>", "evaluation files or directories")
  .action(async (paths: string[]) => {
    const terminal = new DefaultEvalTerminal();
    // Registering SIGINT/SIGTERM disables Node's default exit behavior, so the
    // handler must terminate the process. Previously this only stopped the
    // spinner, which left scorecard polling running and made Ctrl+C appear stuck.
    let exiting = false;
    const stop = (signal: NodeJS.Signals) => {
      if (exiting) return;
      exiting = true;
      terminal.stop();
      process.stderr.write(`\nInterrupted (${signal})\n`);
      const code = signal === "SIGINT" ? 130 : 143;
      // If something keeps the event loop alive after exit(), force-kill shortly.
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
    process.on("SIGTERM", stop);
    try {
      process.exitCode = await runEvalCommand(paths, terminal);
    } finally {
      terminal.stop();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
