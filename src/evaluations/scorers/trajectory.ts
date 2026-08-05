import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import { validationError } from "../errors";
import { extractToolNames } from "../trace-tree";
import {
  diagnoseStrictTraceFailure,
  scoreStrictTrace,
  type TrajectoryMode,
} from "./strict-trace";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
  type ScorecardStepOptions,
} from "./scorecard-options";
import { rejectLegacyParameters, requireNonEmptyString } from "./utils";

export type { TrajectoryMode };
const TRAJECTORY_DIAGNOSIS = "trajectory";

export const extractTrajectoryToolNames = (trace: unknown): string[] =>
  extractToolNames(trace);

export const scoreTrajectory = (
  trace: unknown,
  expected: unknown,
  mode: TrajectoryMode = "strict"
): boolean => scoreStrictTrace(trace, expected, mode) === 1;

export const diagnoseTrajectoryFailure = (
  trace: unknown,
  expected: unknown,
  mode: TrajectoryMode = "strict"
): string | null => diagnoseStrictTraceFailure(trace, expected, mode);

type TrajectoryScorerBaseOptions = ScorecardStepOptions & {
  mode?: TrajectoryMode;
  title?: string;
  sourceColumn?: string;
  [key: string]: unknown;
};

export type TrajectoryScorerOptions = TrajectoryScorerBaseOptions &
  (
    | { expected: string[][]; expectedColumn?: never }
    | { expected?: never; expectedColumn: string }
  );

export function trajectoryScorer(
  options: TrajectoryScorerOptions
): EvalScorerColumn {
  const {
    expected,
    expectedColumn,
    mode = "strict",
    title = "Trajectory",
    sourceColumn = "Trace",
    ...settings
  } = options;
  rejectLegacyParameters(
    settings,
    ["source", "acceptedScenarios", "valueSource"],
    "trajectoryScorer"
  );

  const providedCount = [
    expected !== undefined,
    expectedColumn !== undefined,
  ].filter(Boolean).length;
  if (providedCount !== 1) {
    throw validationError(
      "trajectoryScorer requires exactly one of expected or expectedColumn."
    );
  }

  let normalizedScenarios: string[][] | undefined;
  if (expected !== undefined) {
    if (!Array.isArray(expected) || !expected.length) {
      throw validationError(
        "trajectoryScorer expected must be a non-empty array."
      );
    }
    normalizedScenarios = expected.map((scenario) => {
      if (!Array.isArray(scenario)) {
        throw validationError(
          "trajectoryScorer each expected scenario must be an array."
        );
      }
      return scenario.map((tool) =>
        requireNonEmptyString(tool, "expected tool")
      );
    });
  }

  if (mode !== "strict" && mode !== "non_strict") {
    throw validationError(
      'trajectoryScorer mode must be "strict" or "non_strict".'
    );
  }
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSource = requireNonEmptyString(
    sourceColumn,
    "sourceColumn"
  );
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);

  const config: Record<string, unknown> =
    normalizedScenarios !== undefined
      ? {
          trace_source: resolvedSource,
          accepted_scenarios: normalizedScenarios.map((scenario) => [
            ...scenario,
          ]),
          mode,
          ...configSettings,
        }
      : {
          trace_source: resolvedSource,
          expected_source: requireNonEmptyString(
            expectedColumn,
            "expectedColumn"
          ),
          mode,
          ...configSettings,
        };

  const payload = applyScorecardStepOptions(
    column(resolvedTitle, "TRAJECTORY", config),
    stepOptions
  );
  if (expectedColumn !== undefined) {
    payload._sdkDiagnosis = TRAJECTORY_DIAGNOSIS;
  }
  return payload;
}
