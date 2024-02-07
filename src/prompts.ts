import {
  GetPromptTemplate,
  LegacyPromptTemplate,
  LegacyPublishPromptTemplate,
  Pagination,
} from "@/types";
import {
  promptLayerAllPromptTemplates,
  promptLayerGetPrompt,
  promptLayerPublishPrompt,
} from "@/utils";

/**
 * @description List all prompts on PromptLayer.
 * @param params
 */
export const all = (params?: Pagination) =>
  promptLayerAllPromptTemplates(params);
/**
 * Get a prompt template from PromptLayer.
 */
const getPrompt = async (
  params: GetPromptTemplate
): Promise<LegacyPromptTemplate> => {
  const prompt = await promptLayerGetPrompt(params);
  const prompt_template = prompt["prompt_template"];
  const metadata = prompt["metadata"];
  return {
    prompt_template,
    metadata,
  };
};

const publishPrompt = (body: LegacyPublishPromptTemplate): Promise<boolean> => {
  const { prompt_template, commit_message } = body;
  if (commit_message && commit_message.length > 72) {
    throw new Error("Commit message must be less than 72 characters.");
  }
  if (!(prompt_template instanceof Object)) {
    throw new Error("Please provide a JSON prompt template.");
  }
  return promptLayerPublishPrompt(body);
};

export { getPrompt as get, publishPrompt as publish };
