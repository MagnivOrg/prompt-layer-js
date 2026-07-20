import {
  ColumnType,
  codeExecutionColumn,
  column,
  llmAssertionScorer,
  scorerFromFunction,
} from "@/index";
import {
  nextExperimentNumberTitle,
  nextUniqueSheetTitle,
} from "@/evaluations/setup";
import { buildScorecardStepsFromScorers } from "@/evaluations/scorecard";
import {
  normalizeScorer,
  resolveConfigSourcesToColumnIds,
  scorerDependenciesFromConfig,
  scorersReferenceTrace,
} from "@/evaluations/validation";
import { describe, expect, it } from "vitest";

function exactMatch(output: unknown, expected: unknown) {
  return output === expected ? 1 : 0;
}

function responseLengthUnder500(output: unknown) {
  "Pass when the assistant response is under 500 characters.";
  const text = output == null ? "" : String(output);
  return text.length < 500 ? 1 : 0;
}

function toolCountUnder5(trace: unknown) {
  "Pass when the Trace subtree has fewer than 5 tool spans.";

  function _countTools(node: any): number {
    if (!node || typeof node !== "object") return 0;
    let count = 0;
    const name = node.name || "";
    if (typeof name === "string" && name.startsWith("Tool:")) count += 1;
    for (const child of node.children || []) {
      count += _countTools(child);
    }
    return count;
  }

  return _countTools(trace) < 5 ? 1 : 0;
}

describe("evaluations column helpers", () => {
  it("builds code execution and generic columns", () => {
    const code = codeExecutionColumn("required_tools", { code: "result = 1" });
    expect(code.type).toBe("CODE_EXECUTION");
    expect(code.config).toEqual({
      code: "result = 1",
      language: "JAVASCRIPT",
    });

    const generic = column("custom", "JSON_PATH", {
      source: "Output",
      json_path: "$.a",
    });
    expect(generic.type).toBe("JSON_PATH");

    const viaEnum = column("summary", ColumnType.JSON_PATH, {
      source: "Output",
      json_path: "$.summary",
    });
    expect(viaEnum.type).toBe(ColumnType.JSON_PATH);
    expect(viaEnum.type).toBe("JSON_PATH");
  });

  it("validates codeExecutionColumn required fields", () => {
    expect(() => codeExecutionColumn("x", { code: " " })).toThrow(
      /non-empty code/
    );
  });

  it("resolves scorer dependencies from titles", () => {
    const columnsByTitle = {
      Output: { id: "out-1", title: "Output", type: "TEXT" },
      Trace: { id: "tr-1", title: "Trace", type: "TEXT" },
      Expected: { id: "exp-1", title: "Expected", type: "TEXT" },
      Input: { id: "in-1", title: "Input", type: "TEXT" },
    };
    const deps = scorerDependenciesFromConfig(
      {
        source: "Trace",
        variable_mappings: { ground_truth: "Expected" },
      },
      columnsByTitle
    );
    expect(deps).toEqual([
      {
        column_id: "tr-1",
        reference_type: "value",
        config_key: "source",
      },
      {
        column_id: "exp-1",
        reference_type: "value",
        config_key: "variable_mappings",
        config_meta: { variable_name: "ground_truth" },
      },
    ]);
    expect(
      resolveConfigSourcesToColumnIds(
        {
          source: "Output",
          prompt: "check {user_request}",
          variable_mappings: {
            user_request: "Input",
            execution_trace: "Trace",
          },
        },
        columnsByTitle
      )
    ).toEqual({
      source: "out-1",
      prompt: "check {user_request}",
      variable_mappings: {
        user_request: "in-1",
        execution_trace: "tr-1",
      },
    });
    expect(
      scorersReferenceTrace([
        llmAssertionScorer({ title: "x", source: "Trace", prompt: "ok" }),
      ])
    ).toBe(true);
    expect(
      scorersReferenceTrace([
        llmAssertionScorer({ title: "x", source: "Output", prompt: "ok" }),
      ])
    ).toBe(false);
    expect(() =>
      scorerDependenciesFromConfig({ source: "missing" }, columnsByTitle)
    ).toThrow(/not found: missing/);
  });

  it("persists column IDs in scorecard step primitive_config", () => {
    const columns = [
      { id: "out-1", title: "Output", type: "TEXT" },
      { id: "in-1", title: "Input", type: "TEXT" },
      { id: "tr-1", title: "Trace", type: "TEXT" },
    ];
    const steps = buildScorecardStepsFromScorers(
      [
        llmAssertionScorer({
          title: "Response grounded",
          source: "Output",
          prompt: "User: {user_request}\nTrace: {execution_trace}",
          variableMappings: {
            user_request: "Input",
            execution_trace: "Trace",
          },
        }),
      ],
      columns
    );
    expect(steps).toHaveLength(1);
    const step = steps[0];
    expect(step.source_column_ids).toEqual(["out-1", "in-1", "tr-1"]);
    expect(step.primitive_config).toMatchObject({
      source: "out-1",
      variable_mappings: {
        user_request: "in-1",
        execution_trace: "tr-1",
      },
      prompt: "User: {user_request}\nTrace: {execution_trace}",
    });
  });

  it("serializes function scorers to body-only JS bound from data", () => {
    const col = scorerFromFunction(exactMatch);
    expect(col.type).toBe("CODE_EXECUTION");
    expect(col.title).toBe("exactMatch");
    expect(col.config?.language).toBe("JAVASCRIPT");
    const code = String(col.config?.code);
    expect(code).not.toContain("function exactMatch");
    expect(code).toContain('const output = data.get("Output")');
    expect(code).toContain('const expected = data.get("Expected")');
    expect(code).toContain("result = output === expected ? 1 : 0");

    const normalized = normalizeScorer(exactMatch);
    expect(normalized.type).toBe("CODE_EXECUTION");
    expect(String(normalized.config?.code)).not.toContain("function exactMatch");

    expect(() => scorerFromFunction((() => 1) as any)).toThrow(
      /Lambda|named function/
    );
  });

  it("preserves nested helpers and binds Trace for trace params", () => {
    const lengthCol = scorerFromFunction(responseLengthUnder500);
    const lengthCode = String(lengthCol.config?.code);
    expect(lengthCode).not.toContain("function responseLengthUnder500");
    expect(lengthCode).not.toContain(
      "Pass when the assistant response is under 500 characters."
    );
    expect(lengthCode).toContain('const output = data.get("Output")');
    expect(lengthCode).toContain("result = text.length < 500 ? 1 : 0");

    const toolCol = scorerFromFunction(toolCountUnder5);
    const toolCode = String(toolCol.config?.code);
    expect(toolCode).not.toContain("function toolCountUnder5");
    expect(toolCode).toContain('const trace = data.get("Trace")');
    expect(toolCode).toContain("function _countTools");
    expect(toolCode).toContain("return count");
    expect(toolCode).toContain("result = _countTools(trace) < 5 ? 1 : 0");
  });

  it("supports named arrows, data style, and score object returns", () => {
    const scoreArrow = (output: unknown) => ({ score: output ? 1 : 0 });
    const arrowCode = String(scorerFromFunction(scoreArrow).config?.code);
    expect(arrowCode).toContain('const output = data.get("Output")');
    expect(arrowCode).toContain("result = output ? 1 : 0");

    function dataScorer(data: { trace?: unknown }) {
      return data.trace ? 1 : 0;
    }
    const dataCode = String(scorerFromFunction(dataScorer).config?.code);
    expect(dataCode).not.toContain("const data =");
    expect(dataCode).toContain("data.Trace");
  });

  it("suffixes experiment sheet titles", () => {
    expect(nextUniqueSheetTitle(new Set(), "Agent v2")).toBe("Agent v2");
    expect(nextUniqueSheetTitle(new Set(["Agent v2"]), "Agent v2")).toBe(
      "Agent v2 #2"
    );
    expect(
      nextUniqueSheetTitle(new Set(["Agent v2", "Agent v2 #2"]), "Agent v2")
    ).toBe("Agent v2 #3");
    expect(nextExperimentNumberTitle(new Set(), 0)).toBe("Experiment #1");
    expect(nextExperimentNumberTitle(new Set(["Experiment #1"]), 1)).toBe(
      "Experiment #2"
    );
    expect(
      nextExperimentNumberTitle(new Set(["Sheet 1", "Experiment #3"]), 2)
    ).toBe("Experiment #4");
  });
});
