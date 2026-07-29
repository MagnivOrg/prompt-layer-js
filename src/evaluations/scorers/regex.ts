import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
  type ScorecardStepOptions,
} from "./scorecard-options";
import { rejectLegacyParameters, requireNonEmptyString } from "./utils";

export type RegexScorerOptions = ScorecardStepOptions & {
  title?: string;
  sourceColumn?: string;
  regexPattern: string;
  [key: string]: unknown;
};

export const regexScorer = ({
  title = "Regex",
  sourceColumn = "Output",
  regexPattern,
  ...settings
}: RegexScorerOptions): EvalScorerColumn => {
  rejectLegacyParameters(settings, ["source"], "regexScorer");
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSourceColumn = requireNonEmptyString(
    sourceColumn,
    "sourceColumn"
  );
  const pattern = requireNonEmptyString(regexPattern, "regexPattern");
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  return applyScorecardStepOptions(
    column(resolvedTitle, "REGEX", {
      source: resolvedSourceColumn,
      regex_pattern: pattern,
      ...configSettings,
    }),
    stepOptions
  );
};
