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
  scorersReferenceTrace,
} from "@/evaluations/validation";
import { describe, expect, it } from "vitest";

describe("predefined eval scorers", () => {
  it("builds compare COMPARE payloads", () => {
    expect(compareScorer()).toEqual({
      title: "Compare",
      type: "COMPARE",
      config: {
        sources: ["output", "expected"],
        comparison_type: { type: "STRING" },
      },
    });
    expect(
      compareScorer({
        title: "Strict equality",
        sources: ["answer", "label"],
      }).config?.sources
    ).toEqual(["answer", "label"]);
  });

  it("builds contains CONTAINS payloads", () => {
    expect(containsScorer({ value: "refund" })).toEqual({
      title: "Contains",
      type: "CONTAINS",
      config: { source: "output", value: "refund" },
    });
    expect(
      containsScorer({
        title: "Has expected",
        source: "answer",
        valueSource: "expected",
      }).config
    ).toEqual({ source: "answer", value_source: "expected" });
    expect(
      containsScorer({
        value: "refund",
        valueSource: "expected",
      }).config
    ).toEqual({
      source: "output",
      value: "refund",
      value_source: "expected",
    });
  });

  it("builds regex REGEX payloads", () => {
    expect(regexScorer({ regexPattern: "inv_\\d+" })).toEqual({
      title: "Regex",
      type: "REGEX",
      config: { source: "output", regex_pattern: "inv_\\d+" },
    });
  });

  it("builds COUNT payloads with settings", () => {
    expect(countScorer({ minCount: 1, maxCount: 500 })).toEqual({
      title: "Count",
      type: "COUNT",
      config: {
        source: "output",
        type: "chars",
        min_count: 1,
        max_count: 500,
      },
    });
    expect(
      countScorer({ type: "words", minCount: 2, maxCount: 4 }).config
    ).toEqual({
      source: "output",
      type: "words",
      min_count: 2,
      max_count: 4,
    });
  });

  it("builds ASSERT_VALID payloads with settings", () => {
    expect(assertValidScorer()).toEqual({
      title: "Assert valid",
      type: "ASSERT_VALID",
      config: { source: "output", type: "object" },
    });
    expect(
      assertValidScorer({ type: "email", source: "contact" })
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
      config: { source: "output", prompt: "Is the answer helpful?" },
    });
    expect(
      llmAssertionScorer({
        prompt: "Check",
        promptSource: "prompt_col",
        variableMappings: { expected: "expected" },
      }).config
    ).toEqual({
      source: "output",
      prompt: "Check",
      prompt_source: "prompt_col",
      variable_mappings: { expected: "expected" },
    });
  });

  it("builds TRAJECTORY payloads that reference Trace", () => {
    expect(
      trajectoryScorer({ acceptedScenarios: [["search", "checkout"]] })
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
      scorersReferenceTrace([
        trajectoryScorer({ acceptedScenarios: [["search"]] }),
      ])
    ).toBe(true);

    expect(
      trajectoryScorer({
        acceptedScenarios: [["search"]],
        mode: "non_strict",
        title: "Tools",
        traceSource: "Trace",
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
  });

  it("builds column-source TRAJECTORY payloads and diagnoses tool-list failures", () => {
    const scorer = trajectoryScorer({
      expectedSource: "expected",
      title: "Trajectory assertions",
    });
    expect(scorer).toEqual({
      title: "Trajectory assertions",
      type: "TRAJECTORY",
      config: {
        trace_source: "Trace",
        expected_source: "expected",
        mode: "strict",
      },
      _sdkDiagnosis: "trajectory",
    });
    expect(scorersReferenceTrace([scorer])).toBe(true);
    const body = buildScorerColumnBody(scorer, []);
    expect(body).toEqual({
      title: "Trajectory assertions",
      type: "TRAJECTORY",
      config: {
        trace_source: "Trace",
        expected_source: "expected",
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
          expected_source: "expected",
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
        acceptedScenarios: [
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

  it("validates required arguments", () => {
    expect(() => compareScorer({ title: " " })).toThrow(/title/);
    expect(() => compareScorer({ sources: ["only_one"] })).toThrow(
      /exactly two sources/
    );
    expect(() => containsScorer({ source: "output" })).toThrow(
      /value or valueSource/
    );
    expect(() => regexScorer({ regexPattern: "" })).toThrow(/regexPattern/);
    expect(() => countScorer({})).toThrow(/minCount or maxCount/);
    expect(() => countScorer({ minCount: -1 })).toThrow(/non-negative/);
    expect(() => countScorer({ minCount: 1.5 })).toThrow(/non-negative/);
    expect(() => countScorer({ minCount: 5, maxCount: 1 })).toThrow(
      /cannot exceed/
    );
    expect(() => assertValidScorer({ type: "" })).toThrow(/type/);
    expect(() => llmAssertionScorer({})).toThrow(/prompt or promptSource/);
    expect(() => trajectoryScorer({ acceptedScenarios: [] })).toThrow(
      /non-empty array/
    );
    expect(() => trajectoryScorer({ acceptedScenarios: [[" "]] })).toThrow(
      /expected tool/
    );
    expect(() => trajectoryScorer({ expectedSource: " " })).toThrow(
      /expectedSource/
    );
    expect(() =>
      trajectoryScorer({
        acceptedScenarios: [["search"]],
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
