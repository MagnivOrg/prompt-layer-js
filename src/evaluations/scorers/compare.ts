import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import { validationError } from "../errors";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
  type ScorecardStepOptions,
} from "./scorecard-options";
import { rejectLegacyParameters, requireNonEmptyString } from "./utils";

type CompareScorerBaseOptions = ScorecardStepOptions & {
  title?: string;
  sourceColumn?: string;
  comparisonType?: Record<string, unknown> | string;
  [key: string]: unknown;
};

export type CompareScorerOptions = CompareScorerBaseOptions &
  (
    | { expected: unknown; expectedColumn?: never }
    | { expected?: never; expectedColumn?: string }
  );

export const compareScorer = ({
  title = "Compare",
  sourceColumn = "Output",
  expected,
  expectedColumn,
  comparisonType,
  ...settings
}: CompareScorerOptions = {}): EvalScorerColumn => {
  rejectLegacyParameters(
    settings,
    ["source", "valueSource"],
    "compareScorer"
  );
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSourceColumn = requireNonEmptyString(
    sourceColumn,
    "sourceColumn"
  );
  const hasExpected = expected !== undefined;
  const hasExpectedColumn = expectedColumn !== undefined;
  if (hasExpected && hasExpectedColumn) {
    throw validationError(
      "compareScorer accepts only one of expected or expectedColumn."
    );
  }
  const resolvedExpectedColumn = hasExpected
    ? undefined
    : requireNonEmptyString(expectedColumn ?? "expected", "expectedColumn");
  let comparison: Record<string, unknown> | string;
  if (comparisonType == null) {
    comparison = { type: "STRING" };
  } else if (typeof comparisonType === "string") {
    comparison = { type: comparisonType };
  } else {
    comparison = comparisonType;
  }
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  const config: Record<string, unknown> = {
    sources: hasExpected
      ? [resolvedSourceColumn]
      : [resolvedSourceColumn, resolvedExpectedColumn],
    comparison_type: comparison,
    ...configSettings,
  };
  if (hasExpected) config.target = expected;
  return applyScorecardStepOptions(
    column(resolvedTitle, "COMPARE", config),
    stepOptions
  );
};
