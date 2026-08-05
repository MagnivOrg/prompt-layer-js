import {
  assertValidScorer,
  compareScorer,
  containsScorer,
  countScorer,
  diagnoseTrajectoryFailure,
  extractTrajectoryToolNames,
  llmAssertionScorer,
  regexScorer,
  scoreTrajectory,
  trajectoryScorer,
} from "@/evaluations/scorers";
import {
  assertValidScorer as rootAssertValidScorer,
  compareScorer as rootCompareScorer,
  containsScorer as rootContainsScorer,
  countScorer as rootCountScorer,
  scoreTrajectory as rootScoreTrajectory,
  trajectoryScorer as rootTrajectoryScorer,
} from "@/index";
import { buildScorerColumnBody } from "@/evaluations/utils";
import {
  normalizeScorer,
  scorerDependenciesFromConfig,
} from "@/evaluations/validation";
import { describe, expect, it } from "vitest";

describe("predefined eval scorers", () => {
  it("builds compare COMPARE payloads", () => {
    expect(compareScorer()).toEqual({
      title: "Compare",
      type: "COMPARE",
      config: {
        sources: ["Output", "expected"],
        comparison_type: { type: "STRING" },
      },
    });
    expect(
      compareScorer({
        title: "Strict equality",
        sourceColumn: "answer",
        expectedColumn: "label",
      }).config?.sources
    ).toEqual(["answer", "label"]);
    expect(
      compareScorer({
        sourceColumn: "actual",
        expectedColumn: "reference",
      }).config?.sources
    ).toEqual(["actual", "reference"]);
    expect(
      compareScorer({
        sourceColumn: "actual",
        expected: null,
        comparisonType: "JSON",
      }).config
    ).toEqual({
      sources: ["actual"],
      target: null,
      comparison_type: { type: "JSON" },
    });
  });

  it("builds contains CONTAINS payloads", () => {
    expect(containsScorer({ expected: "refund" })).toEqual({
      title: "Contains",
      type: "CONTAINS",
      config: { source: "Output", value: "refund" },
    });
    expect(
      containsScorer({
        title: "Has expected",
        sourceColumn: "answer",
        expectedColumn: "Expected",
      }).config
    ).toEqual({ source: "answer", value_source: "Expected" });
    expect(
      containsScorer({
        expected: "refund",
        case_sensitive: false,
      }).config
    ).toEqual({
      source: "Output",
      value: "refund",
      case_sensitive: false,
    });
  });

  it("builds regex REGEX payloads", () => {
    expect(
      regexScorer({ sourceColumn: "answer", regexPattern: "inv_\\d+" })
    ).toEqual({
      title: "Regex",
      type: "REGEX",
      config: { source: "answer", regex_pattern: "inv_\\d+" },
    });
  });

  it("builds COUNT payloads with settings", () => {
    expect(countScorer({ minCount: 1, maxCount: 500 })).toEqual({
      title: "Count",
      type: "COUNT",
      config: {
        source: "Output",
        type: "chars",
        min_count: 1,
        max_count: 500,
      },
    });
    expect(
      countScorer({
        sourceColumn: "answer",
        type: "words",
        minCount: 2,
        maxCount: 4,
      }).config
    ).toEqual({
      source: "answer",
      type: "words",
      min_count: 2,
      max_count: 4,
    });
  });

  it("builds ASSERT_VALID payloads with settings", () => {
    expect(assertValidScorer()).toEqual({
      title: "Assert valid",
      type: "ASSERT_VALID",
      config: { source: "Output", type: "object" },
    });
    expect(
      assertValidScorer({ type: "email", sourceColumn: "contact" })
    ).toEqual({
      title: "Assert valid",
      type: "ASSERT_VALID",
      config: { source: "contact", type: "email" },
    });
  });

  it("builds llm assertion LLM_ASSERTION payloads", () => {
    expect(llmAssertionScorer({ prompt: "Is the answer helpful?" })).toEqual({
      title: "LLM assertion",
      type: "LLM_ASSERTION",
      config: { source: "Output", prompt: "Is the answer helpful?" },
    });
    expect(
      llmAssertionScorer({
        sourceColumn: "answer",
        prompt: "Check",
        promptSource: "prompt_col",
        variableMappings: { expected: "Expected" },
      }).config
    ).toEqual({
      source: "answer",
      prompt: "Check",
      prompt_source: "prompt_col",
      variable_mappings: { expected: "Expected" },
    });
  });

  it("builds TRAJECTORY payloads that reference Trace", () => {
    expect(
      trajectoryScorer({ expected: [["search", "checkout"]] })
    ).toEqual({
      title: "Trajectory",
      type: "TRAJECTORY",
      config: {
        trace_source: "Trace",
        accepted_scenarios: [["search", "checkout"]],
        mode: "strict",
      },
    });
    expect(
      trajectoryScorer({
        sourceColumn: "Agent trace",
        expected: [["search"]],
      }).config?.trace_source
    ).toBe("Agent trace");
    expect(
      trajectoryScorer({
        expectedColumn: "Expected trajectory",
      }).config?.expected_source
    ).toBe("Expected trajectory");

    expect(
      trajectoryScorer({
        expected: [["search"]],
        mode: "non_strict",
        title: "Tools",
        sourceColumn: "Trace",
        weight: 2,
        failureThreshold: 0.5,
        passThreshold: 0.9,
        required: true,
      })
    ).toMatchObject({
      title: "Tools",
      type: "TRAJECTORY",
      weight: 2,
      required: true,
      thresholds: { pass: 0.9, warn: 0.5 },
      config: {
        mode: "non_strict",
        accepted_scenarios: [["search"]],
        trace_source: "Trace",
      },
    });

    const trace = {
      name: "root",
      start: "2020-01-01T00:00:00Z",
      span_id: "1",
      children: [
        {
          name: "Tool: search",
          start: "2020-01-01T00:00:01Z",
          span_id: "2",
          children: [],
        },
        {
          name: "Tool: checkout",
          start: "2020-01-01T00:00:02Z",
          span_id: "3",
          children: [],
        },
      ],
    };
    const expected = {
      accepted_scenarios: [{ required_tools: ["search", "checkout"] }],
    };
    expect(extractTrajectoryToolNames(trace)).toEqual(["search", "checkout"]);
    expect(scoreTrajectory(trace, expected, "strict")).toBe(true);
    expect(
      scoreTrajectory(
        trace,
        { accepted_scenarios: [{ required_tools: ["search"] }] },
        "strict"
      )
    ).toBe(false);
    expect(
      scoreTrajectory(
        trace,
        { accepted_scenarios: [{ required_tools: ["search"] }] },
        "non_strict"
      )
    ).toBe(true);
    expect(
      scoreTrajectory(
        trace,
        [["search", "checkout"]],
        "strict"
      )
    ).toBe(true);
    expect(
      scoreTrajectory(trace, '[["search", "checkout"]]', "strict")
    ).toBe(true);
    expect(
      scoreTrajectory(
        trace,
        { accepted_scenarios: [["search", "checkout"]] },
        "strict"
      )
    ).toBe(true);
    expect(() => scoreTrajectory(trace, '[["search"], [42]]')).toThrow(
      /Trajectory expected value/
    );
  });

  it("builds column-source TRAJECTORY payloads and diagnoses tool-list failures", () => {
    const scorer = trajectoryScorer({
      expectedColumn: "Expected",
      title: "Trajectory assertions",
    });
    expect(scorer).toEqual({
      title: "Trajectory assertions",
      type: "TRAJECTORY",
      config: {
        trace_source: "Trace",
        expected_source: "Expected",
        mode: "strict",
      },
      _sdkDiagnosis: "trajectory",
    });
    const body = buildScorerColumnBody(scorer, []);
    expect(body).toEqual({
      title: "Trajectory assertions",
      type: "TRAJECTORY",
      config: {
        trace_source: "Trace",
        expected_source: "Expected",
        mode: "strict",
      },
    });
    expect(body).not.toHaveProperty("is_output_column");
    expect(body).not.toHaveProperty("_sdkDiagnosis");
    expect(
      normalizeScorer({
        title: "Trajectory assertions",
        type: "TRAJECTORY",
        config: {
          trace_source: "Trace",
          expected_source: "Expected",
          mode: "strict",
        },
        _sdk_diagnosis: "trajectory",
      })._sdkDiagnosis
    ).toBe("trajectory");
    expect(
      diagnoseTrajectoryFailure(
        { name: "Tool: search", children: [] },
        { accepted_scenarios: [{ required_tools: ["search"] }] }
      )
    ).toBeNull();
    expect(
      diagnoseTrajectoryFailure(null, {
        accepted_scenarios: [{ required_tools: ["search"] }],
      })
    ).toMatch(/trace is missing/);
    expect(
      scoreTrajectory(
        { name: "Tool: search", children: [] },
        { accepted_scenarios: [{ required_tools: ["search"] }] }
      )
    ).toBe(true);
    expect(
      scoreTrajectory(null, {
        accepted_scenarios: [{ required_tools: ["search"] }],
      })
    ).toBe(false);

    const scenarios = {
      accepted_scenarios: [
        { required_tools: ["get_model_config", "create_prompt"] },
        { required_tools: ["list_model_configs", "create_prompt"] },
      ],
    };
    expect(
      scoreTrajectory(
        {
          name: "root",
          children: [
            { name: "Tool: list_model_configs", children: [] },
            { name: "Tool: create_prompt", children: [] },
          ],
        },
        scenarios
      )
    ).toBe(true);
    expect(
      diagnoseTrajectoryFailure(
        { name: "root", children: [{ name: "Tool: create_prompt", children: [] }] },
        scenarios
      )
    ).toMatch(/scenario 1:/);

    expect(
      trajectoryScorer({
        expected: [
          ["get_model_config", "create_prompt"],
          ["list_model_configs", "create_prompt"],
        ],
        title: "multi path",
      }).config
    ).toEqual({
      trace_source: "Trace",
      accepted_scenarios: [
        ["get_model_config", "create_prompt"],
        ["list_model_configs", "create_prompt"],
      ],
      mode: "strict",
    });
  });

  it("tracks literal and column-mode scorer dependencies", () => {
    const columnsByTitle = {
      Output: { id: "out", title: "Output", type: "TEXT" },
      Trace: { id: "trace", title: "Trace", type: "TRACE" },
      expected: { id: "expected", title: "expected", type: "TEXT" },
    };
    const dependencyCount = (scorer: ReturnType<typeof containsScorer>) =>
      scorerDependenciesFromConfig(scorer.config, columnsByTitle).length;

    expect(dependencyCount(containsScorer({ expected: "yes" }))).toBe(1);
    expect(
      dependencyCount(containsScorer({ expectedColumn: "expected" }))
    ).toBe(2);
    expect(dependencyCount(compareScorer({ expected: "yes" }))).toBe(1);
    expect(dependencyCount(compareScorer({ expectedColumn: "expected" }))).toBe(
      2
    );
    expect(dependencyCount(trajectoryScorer({ expected: [["search"]] }))).toBe(
      1
    );
    expect(
      dependencyCount(trajectoryScorer({ expectedColumn: "expected" }))
    ).toBe(2);
  });

  it("retains custom backend settings on every predefined scorer", () => {
    expect(
      containsScorer({ expected: "yes", custom_contains: true }).config
    ).toMatchObject({ custom_contains: true });
    expect(compareScorer({ custom_compare: true }).config).toMatchObject({
      custom_compare: true,
    });
    expect(
      trajectoryScorer({
        expected: [["search"]],
        custom_trajectory: true,
      }).config
    ).toMatchObject({ custom_trajectory: true });
    expect(
      countScorer({ minCount: 1, custom_count: true }).config
    ).toMatchObject({ custom_count: true });
    expect(
      regexScorer({ regexPattern: "ok", custom_regex: true }).config
    ).toMatchObject({ custom_regex: true });
    expect(
      assertValidScorer({ custom_assert_valid: true }).config
    ).toMatchObject({ custom_assert_valid: true });
    expect(
      llmAssertionScorer({ prompt: "ok", custom_llm_assertion: true }).config
    ).toMatchObject({ custom_llm_assertion: true });
  });

  it("rejects removed legacy scorer parameters", () => {
    expect(() =>
      containsScorer({ expected: "yes", source: "Output" })
    ).toThrow(/containsScorer.*source/);
    expect(() => containsScorer({ expected: "yes", value: "yes" })).toThrow(
      /containsScorer.*value/
    );
    expect(() =>
      containsScorer({ expected: "yes", valueSource: "expected" })
    ).toThrow(/containsScorer.*valueSource/);
    expect(() => compareScorer({ source: "Output" })).toThrow(
      /compareScorer.*source/
    );
    expect(() => compareScorer({ valueSource: "expected" })).toThrow(
      /compareScorer.*valueSource/
    );
    expect(() =>
      trajectoryScorer({ expected: [["search"]], source: "Trace" })
    ).toThrow(/trajectoryScorer.*source/);
    expect(() =>
      trajectoryScorer({
        expected: [["search"]],
        acceptedScenarios: [["search"]],
      })
    ).toThrow(/trajectoryScorer.*acceptedScenarios/);
    expect(() =>
      trajectoryScorer({ expected: [["search"]], valueSource: "expected" })
    ).toThrow(/trajectoryScorer.*valueSource/);
    expect(() => countScorer({ minCount: 1, source: "Output" })).toThrow(
      /countScorer.*source/
    );
    expect(() =>
      regexScorer({ regexPattern: "ok", source: "Output" })
    ).toThrow(/regexScorer.*source/);
    expect(() => assertValidScorer({ source: "Output" })).toThrow(
      /assertValidScorer.*source/
    );
    expect(() =>
      llmAssertionScorer({ prompt: "ok", source: "Output" })
    ).toThrow(/llmAssertionScorer.*source/);
  });

  it("validates required arguments", () => {
    expect(() => compareScorer({ title: " " })).toThrow(/title/);
    expect(() => compareScorer({ expectedColumn: "" })).toThrow(
      /expectedColumn/
    );
    expect(() => containsScorer({ sourceColumn: "Output" } as any)).toThrow(
      /expected or expectedColumn/
    );
    expect(() =>
      containsScorer({
        expected: "yes",
        expectedColumn: "expected",
      } as any)
    ).toThrow(/exactly one/);
    expect(() =>
      compareScorer({ expected: "yes", expectedColumn: "expected" } as any)
    ).toThrow(/only one/);
    expect(() => regexScorer({ regexPattern: "" })).toThrow(/regexPattern/);
    expect(() => countScorer({})).toThrow(/minCount or maxCount/);
    expect(() => countScorer({ minCount: -1 })).toThrow(/non-negative/);
    expect(() => countScorer({ minCount: 1.5 })).toThrow(/non-negative/);
    expect(() => countScorer({ minCount: 5, maxCount: 1 })).toThrow(
      /cannot exceed/
    );
    expect(() => assertValidScorer({ type: "" })).toThrow(/type/);
    expect(() => llmAssertionScorer({})).toThrow(/prompt or promptSource/);
    expect(() => trajectoryScorer({ expected: [] })).toThrow(
      /non-empty array/
    );
    expect(() => trajectoryScorer({ expected: [[" "]] })).toThrow(
      /expected tool/
    );
    expect(() => trajectoryScorer({ expectedColumn: " " })).toThrow(
      /expectedColumn/
    );
    expect(() =>
      trajectoryScorer({
        expected: [["search"]],
        sourceColumn: "",
      })
    ).toThrow(/sourceColumn/);
    expect(() =>
      trajectoryScorer({
        expected: [["search"]],
        mode: "loose" as any,
      })
    ).toThrow(/strict/);
  });

  it("re-exports the same factories from the package root", () => {
    expect(rootCompareScorer).toBe(compareScorer);
    expect(rootContainsScorer).toBe(containsScorer);
    expect(rootCountScorer).toBe(countScorer);
    expect(rootAssertValidScorer).toBe(assertValidScorer);
    expect(rootTrajectoryScorer).toBe(trajectoryScorer);
    expect(rootScoreTrajectory).toBe(scoreTrajectory);
  });
});
