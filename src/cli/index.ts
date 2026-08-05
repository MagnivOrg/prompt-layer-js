#!/usr/bin/env node
import { Command } from "commander";
import { DefaultEvalTerminal } from "@/evaluations/terminal";
import { runEvalCommand } from "./eval-run";
import { runSetupCommand, type SetupTarget } from "./setup/run";

const program = new Command()
  .name("promptlayer")
  .description("PromptLayer command-line interface");

const addSetupOptions = (command: Command) =>
  command
    .option(
      "-a, --agent <agents...>",
      'Agents to configure (cursor, claude, codex, or "*")'
    )
    .option("-f, --force", "Overwrite existing skill or MCP config entries", false);

const runSetup = async (target: SetupTarget, options: {
  agent?: string[];
  force?: boolean;
}) => {
  await runSetupCommand({
    target,
    agents: options.agent,
    force: options.force,
  });
};

const setup = addSetupOptions(
  program
    .command("setup")
    .description(
      "Install PromptLayer coding-agent skills and the Docs MCP server"
    )
    .action(async (options) => {
      await runSetup("all", options);
    })
);

addSetupOptions(
  setup
    .command("skills")
    .description("Install PromptLayer skill files for coding agents")
    .action(async (options) => {
      await runSetup("skills", options);
    })
);

addSetupOptions(
  setup
    .command("mcp")
    .description("Install the PromptLayer Docs MCP server into agent configs")
    .action(async (options) => {
      await runSetup("mcp", options);
    })
);

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
