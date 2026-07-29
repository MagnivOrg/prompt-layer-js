import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import { validationError } from "../errors";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
  type ScorecardStepOptions,
} from "./scorecard-options";
import {
  rejectLegacyParameters,
  requireNonEmptyString,
  requireNonNegativeInteger,
} from "./utils";

export type CountScorerOptions = ScorecardStepOptions & {
  title?: string;
  sourceColumn?: string;
  type?: string;
  minCount?: number;
  maxCount?: number;
  [key: string]: unknown;
};

export const countScorer = ({
  title = "Count",
  sourceColumn = "Output",
  type = "chars",
  minCount,
  maxCount,
  ...settings
}: CountScorerOptions = {}): EvalScorerColumn => {
  rejectLegacyParameters(settings, ["source"], "countScorer");
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSourceColumn = requireNonEmptyString(
    sourceColumn,
    "sourceColumn"
  );
  const resolvedType = requireNonEmptyString(type, "type");
  const hasMin = minCount !== undefined;
  const hasMax = maxCount !== undefined;
  if (!hasMin && !hasMax) {
    throw validationError(
      "countScorer requires at least one of minCount or maxCount."
    );
  }
  const resolvedMin = hasMin
    ? requireNonNegativeInteger(minCount, "minCount")
    : undefined;
  const resolvedMax = hasMax
    ? requireNonNegativeInteger(maxCount, "maxCount")
    : undefined;
  if (
    resolvedMin !== undefined &&
    resolvedMax !== undefined &&
    resolvedMin > resolvedMax
  ) {
    throw validationError("countScorer minCount cannot exceed maxCount.");
  }

  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  const config: Record<string, unknown> = {
    source: resolvedSourceColumn,
    type: resolvedType,
    ...configSettings,
  };
  if (resolvedMin !== undefined) config.min_count = resolvedMin;
  if (resolvedMax !== undefined) config.max_count = resolvedMax;
  return applyScorecardStepOptions(
    column(resolvedTitle, "COUNT", config),
    stepOptions
  );
};
