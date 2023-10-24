import { prompt } from "@/types";
import { getApiKey, promptLayerGetPrompt } from "@/utils";
/**
 * Get a prompt template from PromptLayer.
 */
const getPrompt = async (params: prompt.Retrieve): Promise<prompt.Response> => {
  const api_key = getApiKey();
  const { prompt_name, version, label } = params;
  const prompt = await promptLayerGetPrompt(
    prompt_name,
    api_key,
    version,
    label
  );
  const prompt_template = prompt["prompt_template"];
  const metadata = prompt["metadata"];
  return {
    prompt_template,
    metadata,
  };
};

export { getPrompt as get };
