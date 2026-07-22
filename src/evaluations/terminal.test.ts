import { describe, expect, it } from "vitest";
import {
  DefaultEvalTerminal,
  formatScorerValue,
  formatScoreValue,
  renderAsciiTable,
} from "./terminal";

describe("formatScorerValue", () => {
  it("shows LLM assertion verdicts as boolean cells", () => {
    expect(
      formatScorerValue({
        "Pass when the response is professional": {
          value: true,
          reasoning: "The response is clear.",
        },
      })
    ).toBe("true");
    expect(
      formatScorerValue({
        "Check coherence": {
          value: false,
          reasoning: "The trace is incomplete.",
        },
      })
    ).toBe("false");
    expect(formatScorerValue({ custom: "object" })).toBe(
      '{"custom": "object"}'
    );
  });

  it("aggregates multi-assertion objects to a single verdict", () => {
    expect(
      formatScorerValue({
        "Is clear": {
          value: false,
          reasoning: "The answer is vague.",
          citation: "output",
        },
        "Is correct": {
          value: true,
          reasoning: "Facts check out.",
          citation: "output",
        },
      })
    ).toBe("false");
  });
});

describe("formatScoreValue", () => {
  it("formats overall scores with boolean counts", () => {
    expect(
      formatScoreValue({
        aggregate_score: 0.5,
        aggregate: { success_count: 1, total_count: 2 },
      })
    ).toBe("0.5 (1/2)");
    expect(
      formatScoreValue({ status: "completed", aggregate_score: 1.0 })
    ).toBe("1");
  });
});

describe("renderAsciiTable", () => {
  it("renders Scorer/Result tables like Python Rich output", () => {
    const table = renderAsciiTable(
      ["Scorer", "Result"],
      [
        ["schema_ok", "0/4 (0%)"],
        ["city_grounded", "0/4 (0%)"],
      ],
      { rightAlign: [false, true] }
    );
    expect(table).toContain("┌");
    expect(table).toContain("Scorer");
    expect(table).toContain("Result");
    expect(table).toContain("schema_ok");
    expect(table).toContain("0/4 (0%)");
    expect(table).toContain("└");
  });
});

describe("DefaultEvalTerminal formatting", () => {
  it("shows index/total for multi-file starts", () => {
    const lines: string[] = [];
    const terminal = new DefaultEvalTerminal();
    terminal.write = (message = "") => {
      lines.push(message);
    };
    terminal.fileStart("a.ts", 1, 2);
    terminal.fileStart("b.ts", 2, 2);
    terminal.fileStart("only.ts", 1, 1);
    expect(lines).toEqual(["a.ts (1/2)", "b.ts (2/2)", "only.ts"]);
  });

  it("prints FAILED path then indented detail lines", () => {
    const lines: string[] = [];
    const terminal = new DefaultEvalTerminal();
    terminal.write = (message = "") => {
      lines.push(message);
    };
    terminal.fileFailed("eval.ts", "line one\nline two");
    expect(lines[0]).toContain("FAILED");
    expect(lines[0]).toContain("eval.ts");
    expect(lines[1]).toBe("    line one");
    expect(lines[2]).toBe("    line two");
  });

  it("orders sessionEnd summary as failed then passed", () => {
    const lines: string[] = [];
    const terminal = new DefaultEvalTerminal();
    terminal.write = (message = "") => {
      lines.push(message);
    };
    terminal.sessionEnd(2, 1);
    expect(lines[0]).toContain("1 failed, 2 passed");
  });

  it("prints evaluation results as a table", () => {
    const lines: string[] = [];
    const terminal = new DefaultEvalTerminal();
    terminal.write = (message = "") => {
      lines.push(message);
    };
    terminal.evaluationResults([
      { scorer: "schema_ok", passed: 0, total: 4, passRate: 0 },
      { scorer: "city_grounded", passed: 0, total: 4, passRate: 0 },
    ]);
    const joined = lines.join("\n");
    expect(joined).toContain("Evaluation Results:");
    expect(joined).toContain("┌");
    expect(joined).toContain("Scorer");
    expect(joined).toContain("schema_ok");
    expect(joined).toContain("city_grounded");
    expect(joined).toContain("0/4 (0%)");
  });
});
