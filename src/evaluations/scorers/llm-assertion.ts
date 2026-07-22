import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import { validationError } from "../errors";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
} from "./scorecard-options";
import { requireNonEmptyString } from "./utils";

export const llmAssertionScorer = ({
  title = "LLM assertion",
  source = "Output",
  prompt,
  promptSource,
  variableMappings,
  ...settings
}: {
  title?: string;
  source?: string;
  prompt?: string;
  promptSource?: string;
  variableMappings?: Record<string, string>;
  [key: string]: unknown;
} = {}): EvalScorerColumn => {
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSource = requireNonEmptyString(source, "source");
  if (prompt == null && promptSource == null) {
    throw validationError(
      "llmAssertionScorer requires either prompt or promptSource."
    );
  }
  if (promptSource != null) {
    requireNonEmptyString(promptSource, "promptSource");
  }
  const { stepOptions, configSettings } = popScorecardStepOptions(settings);
  const config: Record<string, unknown> = {
    source: resolvedSource,
    ...configSettings,
  };
  if (prompt !== undefined) config.prompt = prompt;
  if (promptSource !== undefined) config.prompt_source = promptSource;
  if (variableMappings !== undefined) {
    config.variable_mappings = variableMappings;
  }
  return applyScorecardStepOptions(
    column(resolvedTitle, "LLM_ASSERTION", config),
    stepOptions
  );
};
