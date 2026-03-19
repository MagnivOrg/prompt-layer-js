import { PromptLayerOpenAIAgentsProcessor } from "@/integrations/openai-agents/processor";
import { trimTrailingSlashes } from "@/integrations/openai-agents/url";
import { readEnv, requirePromptLayerApiKey } from "@/utils/utils";

export interface InstrumentOpenAIAgentsOptions {
  apiKey?: string;
  baseURL?: string;
  exclusive?: boolean;
  includeRawPayloads?: boolean;
}

const resolveBaseURL = (baseURL?: string): string => {
  return trimTrailingSlashes(
    baseURL ?? readEnv("PROMPTLAYER_BASE_URL") ?? "https://api.promptlayer.com"
  );
};

export const instrumentOpenAIAgents = async ({
  apiKey,
  baseURL,
  exclusive = true,
  includeRawPayloads = true,
}: InstrumentOpenAIAgentsOptions = {}): Promise<PromptLayerOpenAIAgentsProcessor> => {
  const resolvedApiKey = requirePromptLayerApiKey(apiKey);

  const agentsModule: typeof import("@openai/agents") = await import(
    "@openai/agents"
  );

  const processor = new PromptLayerOpenAIAgentsProcessor({
    apiKey: resolvedApiKey,
    baseURL: resolveBaseURL(baseURL),
    includeRawPayloads,
  });

  if (exclusive) {
    agentsModule.setTraceProcessors([processor]);
  } else {
    agentsModule.addTraceProcessor(processor);
  }

  return processor;
};
