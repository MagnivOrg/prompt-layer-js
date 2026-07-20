import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
} from "./scorecard-options";
import { requireNonEmptyString } from "./utils";

export const assertValidScorer = ({
  title = "Assert valid",
  source = "output",
  type = "object",
  ...settings
}: {
  title?: string;
  source?: string;
  type?: string;
  [key: string]: unknown;
} = {}): EvalScorerColumn => {
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSource = requireNonEmptyString(source, "source");
  const resolvedType = requireNonEmptyString(type, "type");
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  return applyScorecardStepOptions(
    column(resolvedTitle, "ASSERT_VALID", {
      source: resolvedSource,
      type: resolvedType,
      ...configSettings,
    }),
    stepOptions
  );
};
