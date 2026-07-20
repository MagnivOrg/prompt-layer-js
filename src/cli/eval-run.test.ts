import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationFailedError } from "@/errors";
import type { EvalTerminal } from "@/evaluations/terminal";

vi.mock("./eval-loader", () => ({
  loadEvalEnvironment: vi.fn(async () => {}),
  executeEvalFile: vi.fn(async () => {}),
}));

import { executeEvalFile } from "./eval-loader";
import { formatFailureDetail, runEvalCommand } from "./eval-run";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
  vi.mocked(executeEvalFile).mockReset();
  vi.mocked(executeEvalFile).mockResolvedValue(undefined);
});

const mockTerminal = (): EvalTerminal & { lines: string[]; errors: string[] } => {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    write(message = "", options: { error?: boolean } = {}) {
      (options.error ? errors : lines).push(message);
    },
    rule() {},
    sessionStart() {},
    fileStart() {},
    step() {},
    runnersStart() {},
    progress() {},
    scoringProgress() {},
    cellProgress() {},
    score() {},
    evaluationResults() {},
    failureExamples() {},
    link() {},
    filePassed() {},
    fileFailed(path: string, detail: string) {
      errors.push(`FAILED ${path}`);
      for (const line of detail.split("\n")) errors.push(`  ${line}`);
    },
    sessionEnd() {},
    stop() {},
  };
};

describe("formatFailureDetail", () => {
  it("returns EvaluationFailedError message without a stack", () => {
    const error = new EvaluationFailedError("score below threshold");
    expect(formatFailureDetail(error)).toBe("score below threshold");
  });

  it("includes stack for generic errors", () => {
    const error = new Error("boom");
    const detail = formatFailureDetail(error);
    expect(detail).toContain("boom");
    expect(detail).toContain("Error:");
  });
});

describe("runEvalCommand", () => {
  beforeEach(() => {
    vi.mocked(executeEvalFile).mockResolvedValue(undefined);
  });

  it("reports missing paths clearly and exits 1", async () => {
    const terminal = mockTerminal();
    const code = await runEvalCommand(
      [join(tmpdir(), "missing-promptlayer-evals-path")],
      terminal
    );
    expect(code).toBe(1);
    expect(terminal.errors.some((line) => /Path not found:/.test(line))).toBe(
      true
    );
  });

  it("reports empty discovery with Python-style message", async () => {
    const root = await mkdtemp(join(tmpdir(), "promptlayer-evals-"));
    roots.push(root);
    await writeFile(join(root, "plain.ts"), "export const value = 1");
    const terminal = mockTerminal();
    const code = await runEvalCommand([root], terminal);
    expect(code).toBe(1);
    expect(
      terminal.errors.some((line) =>
        line.includes("evaluate(...), aevaluate(...), or *_eval(...)")
      )
    ).toBe(true);
  });

  it("surfaces EvaluationFailedError without stack and exits 1", async () => {
    const root = await mkdtemp(join(tmpdir(), "promptlayer-evals-"));
    roots.push(root);
    const file = join(root, "fail.eval.js");
    await writeFile(file, "evaluate('x', {})");
    vi.mocked(executeEvalFile).mockRejectedValue(
      new EvaluationFailedError("score below threshold")
    );
    const terminal = mockTerminal();
    const code = await runEvalCommand([file], terminal);
    expect(code).toBe(1);
    expect(terminal.errors.some((line) => line.startsWith("FAILED ") && line.endsWith("fail.eval.js"))).toBe(
      true
    );
    expect(terminal.errors).toContain("  score below threshold");
    expect(terminal.errors.every((line) => !/\bat\s/.test(line))).toBe(true);
  });
});
