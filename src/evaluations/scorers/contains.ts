import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import { validationError } from "../errors";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
  type ScorecardStepOptions,
} from "./scorecard-options";
import { rejectLegacyParameters, requireNonEmptyString } from "./utils";

type ContainsScorerBaseOptions = ScorecardStepOptions & {
  title?: string;
  sourceColumn?: string;
  [key: string]: unknown;
};

export type ContainsScorerOptions = ContainsScorerBaseOptions &
  (
    | { expected: string; expectedColumn?: never }
    | { expected?: never; expectedColumn: string }
  );

export const containsScorer = ({
  title = "Contains",
  sourceColumn = "Output",
  expected,
  expectedColumn,
  ...settings
}: ContainsScorerOptions): EvalScorerColumn => {
  rejectLegacyParameters(
    settings,
    ["source", "value", "valueSource"],
    "containsScorer"
  );
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSourceColumn = requireNonEmptyString(
    sourceColumn,
    "sourceColumn"
  );
  const hasExpected = expected !== undefined;
  const hasExpectedColumn = expectedColumn !== undefined;
  if (hasExpected === hasExpectedColumn) {
    throw validationError(
      "containsScorer requires exactly one of expected or expectedColumn."
    );
  }
  if (hasExpectedColumn) {
    requireNonEmptyString(expectedColumn, "expectedColumn");
  }
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  const config: Record<string, unknown> = {
    source: resolvedSourceColumn,
    ...configSettings,
  };
  if (hasExpected) config.value = expected;
  if (hasExpectedColumn) config.value_source = expectedColumn;
  return applyScorecardStepOptions(
    column(resolvedTitle, "CONTAINS", config),
    stepOptions
  );
};
