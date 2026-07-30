import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
  type ScorecardStepOptions,
} from "./scorecard-options";
import { rejectLegacyParameters, requireNonEmptyString } from "./utils";

export type AssertValidScorerOptions = ScorecardStepOptions & {
  title?: string;
  sourceColumn?: string;
  type?: string;
  [key: string]: unknown;
};

export const assertValidScorer = ({
  title = "Assert valid",
  sourceColumn = "Output",
  type = "object",
  ...settings
}: AssertValidScorerOptions = {}): EvalScorerColumn => {
  rejectLegacyParameters(settings, ["source"], "assertValidScorer");
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSourceColumn = requireNonEmptyString(
    sourceColumn,
    "sourceColumn"
  );
  const resolvedType = requireNonEmptyString(type, "type");
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  return applyScorecardStepOptions(
    column(resolvedTitle, "ASSERT_VALID", {
      source: resolvedSourceColumn,
      type: resolvedType,
      ...configSettings,
    }),
    stepOptions
  );
};
