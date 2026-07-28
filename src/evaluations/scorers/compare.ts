import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
} from "./scorecard-options";
import { requireNonEmptyString } from "./utils";

export const compareScorer = ({
  title = "Compare",
  source = "Output",
  valueSource = "expected",
  comparisonType,
  ...settings
}: {
  title?: string;
  source?: string;
  valueSource?: string;
  comparisonType?: Record<string, unknown> | string;
  [key: string]: unknown;
} = {}): EvalScorerColumn => {
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSource = requireNonEmptyString(source, "source");
  const resolvedValueSource = requireNonEmptyString(
    valueSource,
    "valueSource"
  );
  let comparison: Record<string, unknown> | string;
  if (comparisonType == null) {
    comparison = { type: "STRING" };
  } else if (typeof comparisonType === "string") {
    comparison = { type: comparisonType };
  } else {
    comparison = comparisonType;
  }
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  return applyScorecardStepOptions(
    column(resolvedTitle, "COMPARE", {
      sources: [resolvedSource, resolvedValueSource],
      comparison_type: comparison,
      ...configSettings,
    }),
    stepOptions
  );
};
