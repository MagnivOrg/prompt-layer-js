import { EvalScorerColumn } from "@/types";
import { column } from "../columns";
import { validationError } from "../errors";
import {
  applyScorecardStepOptions,
  popScorecardStepOptions,
  type ScorecardStepOptions,
} from "./scorecard-options";
import { rejectLegacyParameters, requireNonEmptyString } from "./utils";

export type LlmAssertionScorerOptions = ScorecardStepOptions & {
  title?: string;
  sourceColumn?: string;
  prompt?: string;
  promptSource?: string;
  variableMappings?: Record<string, string>;
  [key: string]: unknown;
};

export const llmAssertionScorer = ({
  title = "LLM assertion",
  sourceColumn = "Output",
  prompt,
  promptSource,
  variableMappings,
  ...settings
}: LlmAssertionScorerOptions = {}): EvalScorerColumn => {
  rejectLegacyParameters(settings, ["source"], "llmAssertionScorer");
  const resolvedTitle = requireNonEmptyString(title, "title");
  const resolvedSourceColumn = requireNonEmptyString(
    sourceColumn,
    "sourceColumn"
  );
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
    source: resolvedSourceColumn,
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
