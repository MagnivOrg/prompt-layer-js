import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import { validationError } from "../errors";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
} from "./scorecard-options";
import { requireNonEmptyString } from "./utils";

export const compareScorer = ({
  title = "Compare",
  sources = ["output", "expected"],
  comparisonType,
  ...settings
}: {
  title?: string;
  sources?: string[];
  comparisonType?: Record<string, unknown> | string;
  [key: string]: unknown;
} = {}): EvalScorerColumn => {
  const resolvedTitle = requireNonEmptyString(title, "title");
  if (!Array.isArray(sources) || sources.length !== 2) {
    throw validationError("compareScorer requires exactly two sources.");
  }
  for (const source of sources) {
    requireNonEmptyString(source, "source");
  }
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
      sources: [...sources],
      comparison_type: comparison,
      ...configSettings,
    }),
    stepOptions
  );
};
