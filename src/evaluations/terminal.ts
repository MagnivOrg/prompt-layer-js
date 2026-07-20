import ora, { type Ora } from "ora";
import pc from "picocolors";
import Table from "cli-table3";
import type { EvalCaseResult, EvalScoreCard } from "@/types";
import {
  extractBooleanScoreCounts,
  extractOverallScore,
  llmAssertionVerdict,
} from "./scores";
import { storedEvalTerminal, type EvalTerminal } from "./terminal-context";

export { type EvalTerminal, withEvalTerminal } from "./terminal-context";

const FAILURE_EXAMPLE_LIMIT = 5;
const CELL_DISPLAY_LIMIT = 80;

const defaultEvalTerminal = (): DefaultEvalTerminal => {
  if (!_defaultEvalTerminal) _defaultEvalTerminal = new DefaultEvalTerminal();
  return _defaultEvalTerminal;
};
let _defaultEvalTerminal: DefaultEvalTerminal | null = null;

/** Always returns a terminal (ALS context or module-level default). */
export const getTerminal = (): EvalTerminal =>
  storedEvalTerminal() ?? defaultEvalTerminal();

export const formatPassRate = (passed: number, total: number): string => {
  if (total <= 0) return "n/a";
  const percent = Math.round((100 * passed) / total);
  return `${passed}/${total} (${percent}%)`;
};

/** Render a Rich-like ASCII table for eval terminal output. */
export const renderAsciiTable = (
  headers: string[],
  rows: string[][],
  options: { rightAlign?: boolean[]; showLines?: boolean } = {}
): string => {
  const table = new Table({
    head: headers,
    colAligns: headers.map((_, index) =>
      options.rightAlign?.[index] ? "right" : "left"
    ),
    style: {
      compact: !options.showLines,
      head: [],
      border: [],
    },
  });
  table.push(...rows);
  return table.toString();
};

export const formatScoreValue = (score: unknown): string => {
  if (score == null) return "n/a";
  const overall = extractOverallScore(score);
  const counts = extractBooleanScoreCounts(score);
  if (overall !== null && counts) return `${overall} (${counts[0]}/${counts[1]})`;
  if (overall !== null) return String(overall);
  if (score && typeof score === "object" && !Array.isArray(score)) {
    const status = (score as Record<string, unknown>).status;
    if (status != null) return `status=${status}`;
  }
  return String(score);
};

const jsonDumps = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return JSON.stringify(String(value));
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => jsonDumps(item)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    const body = keys
      .map(
        (key) =>
          `${JSON.stringify(key)}: ${jsonDumps((value as Record<string, unknown>)[key])}`
      )
      .join(", ");
    return `{${body}}`;
  }
  return JSON.stringify(String(value));
};

export const formatCellValue = (
  value: unknown,
  limit = CELL_DISPLAY_LIMIT
): string => {
  let text: string;
  if (value === null || value === undefined) text = "";
  else if (typeof value === "boolean") text = value ? "true" : "false";
  else if (typeof value === "number") text = String(value);
  else if (typeof value === "string") text = value;
  else {
    try {
      text = jsonDumps(value);
    } catch {
      text = String(value);
    }
  }
  text = text.split(/\s+/).join(" ");
  if (text.length > limit) return `${text.slice(0, Math.max(0, limit - 3))}...`;
  return text;
};

/** Format structured LLM assertion results as their boolean verdict. */
export const formatScorerValue = (value: unknown): string => {
  const verdict = llmAssertionVerdict(value);
  return formatCellValue(verdict !== null ? verdict : value);
};

export class DefaultEvalTerminal implements EvalTerminal {
  private spinner: Ora | null = null;
  private startedAt = performance.now();
  private runnerTotal = 0;

  write(message = "", options: { error?: boolean } = {}): void {
    this.stop();
    (options.error ? process.stderr : process.stdout).write(`${message}\n`);
  }

  rule(title = ""): void {
    const width = 70;
    const decorated = title ? ` ${title} ` : "";
    const side = "=".repeat(
      Math.max(0, Math.floor((width - decorated.length) / 2))
    );
    this.write(
      `${side}${decorated}${"=".repeat(
        Math.max(0, width - side.length - decorated.length)
      )}`
    );
  }

  sessionStart(collected: number, label = "file"): void {
    this.startedAt = performance.now();
    this.rule("eval session starts");
    this.write(`collected ${collected} ${label}${collected === 1 ? "" : "s"}`);
    this.write();
  }

  fileStart(path: string, index = 1, total = 1): void {
    const label = total === 1 ? path : `${path} (${index}/${total})`;
    this.write(label);
  }

  step(message: string): void {
    const text = message.replace(/\.+$/, "");
    this.write(`  ${pc.cyan("•")} ${text}`);
  }

  runnersStart(total: number): void {
    this.runnerTotal = total;
    if (total <= 0) return;
    if (process.stdout.isTTY) {
      // discardStdin defaults to true and puts stdin in raw mode, which stops the
      // terminal from generating SIGINT on Ctrl+C (ora re-emits it from stdin).
      // Keep native SIGINT so interrupt stays responsive during long eval runs.
      this.spinner = ora({
        text: `runners 0/${total}`,
        stream: process.stdout,
        discardStdin: false,
      }).start();
    } else {
      this.write(`    ${pc.cyan("•")} runners 0/${total}`);
    }
  }

  progress(completed: number, total = this.runnerTotal): void {
    const done = completed >= total && total > 0;
    if (this.spinner) {
      this.spinner.text = `runners ${completed}/${total}`;
      if (done) {
        this.stop();
        this.write(`    ${pc.green("✓")} runners ${completed}/${total}`);
      }
      return;
    }
    if (done) this.write(`    ${pc.green("✓")} runners ${completed}/${total}`);
    else this.write(`    ${pc.cyan("•")} runners ${completed}/${total}`);
  }

  scoringProgress(completed: number, total: number, failed = 0): void {
    this.renderCountedProgress("scorecard rows", completed, total, failed);
  }

  cellProgress(
    completed: number,
    total: number,
    failed = 0,
    status: string | null = null
  ): void {
    this.renderCountedProgress("cells", completed, total, failed, status);
  }

  private renderCountedProgress(
    label: string,
    completed: number,
    total: number,
    failed = 0,
    status: string | null = null
  ): void {
    if (total <= 0 && !status) return;
    const safeTotal = Math.max(total, 0);
    const clamped =
      safeTotal > 0 ? Math.min(Math.max(completed, 0), safeTotal) : Math.max(completed, 0);
    const failedCount = Math.max(failed, 0);
    const parts = [
      `${label} ${safeTotal > 0 ? `${clamped}/${safeTotal}` : String(clamped)}`,
    ];
    if (failedCount) parts.push(`(${failedCount} errors)`);
    if (status && status.trim()) parts.push(`· ${status.trim().toLowerCase()}`);
    const text = parts.join(" ");
    const done = safeTotal > 0 ? clamped >= safeTotal : Boolean(status && ["completed", "failed", "cancelled"].includes(status.toLowerCase()));
    if (this.spinner) {
      this.spinner.text = text;
      if (done) {
        this.stop();
        const icon = failedCount || status?.toLowerCase() === "failed" ? pc.red("✗") : pc.green("✓");
        this.write(`    ${icon} ${text}`);
      }
      return;
    }
    if (process.stdout.isTTY && !done) {
      this.spinner = ora({
        text,
        stream: process.stdout,
        discardStdin: false,
      }).start();
      return;
    }
    let icon = pc.cyan("•");
    if (done && (failedCount || status?.toLowerCase() === "failed")) {
      icon = pc.red("✗");
    } else if (done) {
      icon = pc.green("✓");
    }
    this.write(`    ${icon} ${text}`);
  }

  score(value: string, passed?: boolean): void {
    const marker =
      passed === false ? pc.red("✗") : passed === true ? pc.green("✓") : "•";
    this.write(`  ${marker} score ${value}`);
  }

  evaluationResults(scoreCards: EvalScoreCard[]): void {
    this.write(pc.bold("Evaluation Results:"));
    this.write(
      renderAsciiTable(
        ["Scorer", "Result"],
        scoreCards.map((card) => [
          card.scorer,
          formatPassRate(card.passed, card.total),
        ]),
        { rightAlign: [false, true] }
      )
    );
    this.write("");
  }

  failureExamples(
    rows: EvalCaseResult[],
    options: { scorerTitles?: string[]; limit?: number } = {}
  ): void {
    if (!rows.length) return;
    const limit = options.limit ?? FAILURE_EXAMPLE_LIMIT;
    let scorerTitles = options.scorerTitles ?? [];
    if (!scorerTitles.length) {
      for (const row of rows) {
        for (const title of Object.keys(row.scores || {})) {
          if (!scorerTitles.includes(title)) scorerTitles.push(title);
        }
      }
    }
    this.write(pc.bold("Failure examples:"));
    this.write(
      renderAsciiTable(
        ["Input", "Output", ...scorerTitles],
        rows.slice(0, limit).map((row) => [
          formatCellValue(row.input),
          formatCellValue(row.output),
          ...scorerTitles.map((title) =>
            formatScorerValue(row.scores?.[title])
          ),
        ]),
        { showLines: true }
      )
    );
    this.write("");
  }

  link(url: string): void {
    this.write(`  ↗ ${url}`);
  }

  filePassed(): void {
    this.write(`  ${pc.green("PASSED")}`);
    this.write();
  }

  fileFailed(path: string, detail: string): void {
    this.write(`  ${pc.red("FAILED")} ${path}`, { error: true });
    const trimmed = detail.replace(/\s+$/, "");
    const lines = trimmed.split("\n");
    for (const line of lines.length ? lines : [detail]) {
      this.write(`    ${line}`, { error: true });
    }
    this.write();
  }

  sessionEnd(passed: number, failed: number): void {
    const duration = ((performance.now() - this.startedAt) / 1000).toFixed(2);
    const total = passed + failed;
    let summary: string;
    if (failed) {
      summary = passed
        ? `${failed} failed, ${passed} passed`
        : `${failed} failed`;
      summary = pc.red(summary);
    } else if (total === 0) {
      summary = pc.yellow("no tests ran");
    } else {
      summary = pc.green(`${passed} passed`);
    }
    this.rule(`${summary} in ${duration}s`);
  }

  stop(): void {
    this.spinner?.stop();
    this.spinner = null;
  }
}
