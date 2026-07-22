import { EvalScorerColumn } from "@/types";
import { validationError } from "../errors";

const SCORECARD_STEP_OPTION_KEYS = new Set([
  "weight",
  "failureThreshold",
  "failure_threshold",
  "passThreshold",
  "pass_threshold",
  "required",
  "thresholds",
]);

const DEFAULT_PASS_THRESHOLD = 0.8;
const DEFAULT_WARN_THRESHOLD = 0.6;

export type ScorecardStepOptions = {
  weight?: number;
  failureThreshold?: number;
  passThreshold?: number;
  required?: boolean;
  thresholds?: { pass?: number; warn?: number };
};

const normalizeThreshold = (value: unknown, field: string): number => {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    throw validationError(`${field} must be a number between 0 and 1.`);
  }
  return normalized;
};

export const popScorecardStepOptions = (
  settings: Record<string, unknown>
): {
  stepOptions: ScorecardStepOptions;
  configSettings: Record<string, unknown>;
} => {
  const stepOptions: ScorecardStepOptions = {};
  const configSettings: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (!SCORECARD_STEP_OPTION_KEYS.has(key)) {
      configSettings[key] = value;
      continue;
    }
    if (key === "weight") stepOptions.weight = value as number;
    else if (key === "required") stepOptions.required = value as boolean;
    else if (key === "thresholds") {
      stepOptions.thresholds = value as { pass?: number; warn?: number };
    } else if (key === "failureThreshold" || key === "failure_threshold") {
      stepOptions.failureThreshold = value as number;
    } else if (key === "passThreshold" || key === "pass_threshold") {
      stepOptions.passThreshold = value as number;
    }
  }

  return { stepOptions, configSettings };
};

export const applyScorecardStepOptions = (
  payload: EvalScorerColumn,
  options: ScorecardStepOptions = {}
): EvalScorerColumn => {
  const next: EvalScorerColumn = { ...payload };

  if (options.weight !== undefined) {
    const weight = Number(options.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw validationError("weight must be a positive number.");
    }
    next.weight = weight;
  }

  if (options.required !== undefined) {
    if (typeof options.required !== "boolean") {
      throw validationError("required must be a boolean.");
    }
    next.required = options.required;
  }

  let resolvedThresholds: { pass: number; warn: number } | undefined;
  if (options.thresholds !== undefined) {
    if (
      !options.thresholds ||
      typeof options.thresholds !== "object" ||
      Array.isArray(options.thresholds)
    ) {
      throw validationError("thresholds must be an object with pass/warn values.");
    }
    resolvedThresholds = {
      pass: normalizeThreshold(
        options.thresholds.pass ?? DEFAULT_PASS_THRESHOLD,
        "thresholds.pass"
      ),
      warn: normalizeThreshold(
        options.thresholds.warn ?? DEFAULT_WARN_THRESHOLD,
        "thresholds.warn"
      ),
    };
  } else if (
    options.failureThreshold !== undefined ||
    options.passThreshold !== undefined
  ) {
    resolvedThresholds = {
      pass: normalizeThreshold(
        options.passThreshold ?? DEFAULT_PASS_THRESHOLD,
        "passThreshold"
      ),
      warn: normalizeThreshold(
        options.failureThreshold ?? DEFAULT_WARN_THRESHOLD,
        "failureThreshold"
      ),
    };
  }

  if (resolvedThresholds) {
    if (resolvedThresholds.warn > resolvedThresholds.pass) {
      throw validationError(
        "failureThreshold cannot be higher than passThreshold."
      );
    }
    next.thresholds = resolvedThresholds;
  }

  return next;
};
