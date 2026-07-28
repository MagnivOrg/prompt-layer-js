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
  type ScorecardStepOptions,
} from "./scorecard-options";
import { requireNonEmptyString } from "./utils";

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

type TrajectoryScorerOptions = ScorecardStepOptions & {
  mode?: TrajectoryMode;
  title?: string;
  source?: string;
};

type TrajectorySourceScorerOptions = TrajectoryScorerOptions & {
  valueSource: string;
};

type TrajectoryScenariosScorerOptions = TrajectoryScorerOptions & {
  acceptedScenarios: string[][];
};

export function trajectoryScorer(
  options: TrajectorySourceScorerOptions | TrajectoryScenariosScorerOptions
): EvalScorerColumn;
export function trajectoryScorer(
  options: TrajectorySourceScorerOptions | TrajectoryScenariosScorerOptions
): EvalScorerColumn {
  const acceptedScenarios =
    "acceptedScenarios" in options ? options.acceptedScenarios : undefined;
  const valueSource = "valueSource" in options ? options.valueSource : undefined;

  const providedCount = [
    acceptedScenarios !== undefined,
    valueSource !== undefined,
  ].filter(Boolean).length;
  if (providedCount !== 1) {
    throw validationError(
      "trajectoryScorer requires exactly one of acceptedScenarios or valueSource."
    );
  }

  let normalizedScenarios: string[][] | undefined;
  if (acceptedScenarios !== undefined) {
    if (!Array.isArray(acceptedScenarios) || !acceptedScenarios.length) {
      throw validationError(
        "trajectoryScorer acceptedScenarios must be a non-empty array."
      );
    }
    normalizedScenarios = acceptedScenarios.map((scenario) => {
      if (!Array.isArray(scenario) || !scenario.length) {
        throw validationError(
          "trajectoryScorer each scenario must be a non-empty array."
        );
      }
      return scenario.map((tool) =>
        requireNonEmptyString(tool, "expected tool")
      );
    });
  }

  const mode = options.mode ?? "strict";
  if (mode !== "strict" && mode !== "non_strict") {
    throw validationError(
      'trajectoryScorer mode must be "strict" or "non_strict".'
    );
  }
  const title = requireNonEmptyString(options.title ?? "Trajectory", "title");
  const resolvedSource = requireNonEmptyString(
    options.source ?? "Trace",
    "source"
  );

  const config: Record<string, unknown> =
    normalizedScenarios !== undefined
      ? {
          trace_source: resolvedSource,
          accepted_scenarios: normalizedScenarios.map((scenario) => [
            ...scenario,
          ]),
          mode,
        }
      : {
          trace_source: resolvedSource,
          expected_source: requireNonEmptyString(valueSource, "valueSource"),
          mode,
        };

  const payload = applyScorecardStepOptions(column(title, "TRAJECTORY", config), {
    weight: options.weight,
    failureThreshold: options.failureThreshold,
    passThreshold: options.passThreshold,
    required: options.required,
    thresholds: options.thresholds,
  });
  if (valueSource !== undefined) {
    payload._sdkDiagnosis = TRAJECTORY_DIAGNOSIS;
  }
  return payload;
}
