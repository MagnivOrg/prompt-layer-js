import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import { validationError } from "../errors";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
} from "./scorecard-options";
import { requireNonEmptyString } from "./utils";

export const containsScorer = ({
  title = "Contains",
  source = "Output",
  value,
  valueSource,
  ...settings
}: {
  title?: string;
  source?: string;
  value?: string;
  valueSource?: string;
  [key: string]: unknown;
} = {}): EvalScorerColumn => {
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSource = requireNonEmptyString(source, "source");
  if (value == null && valueSource == null) {
    throw validationError(
      "containsScorer requires either value or valueSource."
    );
  }
  if (valueSource != null) {
    requireNonEmptyString(valueSource, "valueSource");
  }
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  const config: Record<string, unknown> = {
    source: resolvedSource,
    ...configSettings,
  };
  if (value !== undefined) config.value = value;
  if (valueSource !== undefined) config.value_source = valueSource;
  return applyScorecardStepOptions(
    column(resolvedTitle, "CONTAINS", config),
    stepOptions
  );
};
