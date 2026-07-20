import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
} from "./scorecard-options";
import { requireNonEmptyString } from "./utils";

export const regexScorer = ({
  title = "Regex",
  source = "output",
  regexPattern,
  ...settings
}: {
  title?: string;
  source?: string;
  regexPattern: string;
  [key: string]: unknown;
}): EvalScorerColumn => {
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSource = requireNonEmptyString(source, "source");
  const pattern = requireNonEmptyString(regexPattern, "regexPattern");
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  return applyScorecardStepOptions(
    column(resolvedTitle, "REGEX", {
      source: resolvedSource,
      regex_pattern: pattern,
      ...configSettings,
    }),
    stepOptions
  );
};
