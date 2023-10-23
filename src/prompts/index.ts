import { GetPrompt } from "@/types";
import { getApiKey, promptLayerGetPrompt } from "@/utils";
/**
 * Get a prompt template from PromptLayer.
 */
const getPrompt = async (params: GetPrompt) => {
  const api_key = getApiKey();
  const { prompt_name, version, label, include_metadata } = params;
  const prompt = await promptLayerGetPrompt(
    prompt_name,
    api_key,
    version,
    label
  );
  const prompt_template = prompt["prompt_template"];
  return include_metadata
    ? [prompt_template, prompt["metadata"]]
    : prompt_template;
};

export { getPrompt as get };
