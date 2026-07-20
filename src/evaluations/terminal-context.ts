import { AsyncLocalStorage } from "node:async_hooks";
import type { EvalCaseResult, EvalScoreCard } from "@/types";

export interface EvalTerminal {
  write(message?: string, options?: { error?: boolean }): void;
  rule(title?: string): void;
  sessionStart(collected: number, label?: string): void;
  fileStart(path: string, index: number, total: number): void;
  step(message: string): void;
  runnersStart(total: number): void;
  progress(completed: number, total: number): void;
  scoringProgress(completed: number, total: number, failed?: number): void;
  cellProgress(
    completed: number,
    total: number,
    failed?: number,
    status?: string | null
  ): void;
  score(value: string, passed?: boolean): void;
  evaluationResults(scoreCards: EvalScoreCard[]): void;
  failureExamples(
    rows: EvalCaseResult[],
    options?: { scorerTitles?: string[]; limit?: number }
  ): void;
  link(url: string): void;
  filePassed(): void;
  fileFailed(path: string, detail: string): void;
  sessionEnd(passed: number, failed: number): void;
  stop(): void;
}

const terminalContext = new AsyncLocalStorage<EvalTerminal>();

export const withEvalTerminal = <T>(
  terminal: EvalTerminal,
  callback: () => T
): T => terminalContext.run(terminal, callback);

/** ALS store only — prefer `getTerminal()` which always returns a terminal. */
export const storedEvalTerminal = (): EvalTerminal | undefined =>
  terminalContext.getStore();
