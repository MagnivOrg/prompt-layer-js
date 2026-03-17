import { PromptLayerOpenAIAgentsProcessor } from "@/integrations/openai-agents/processor";
import { trimTrailingSlashes } from "@/integrations/openai-agents/url";
import { readEnv } from "@/utils/utils";

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
  apiKey = readEnv("PROMPTLAYER_API_KEY"),
  baseURL,
  exclusive = true,
  includeRawPayloads = true,
}: InstrumentOpenAIAgentsOptions = {}): Promise<PromptLayerOpenAIAgentsProcessor> => {
  if (!apiKey) {
    throw new Error(
      "PromptLayer API key not provided. Please set PROMPTLAYER_API_KEY or pass apiKey."
    );
  }

  const agentsModule: typeof import("@openai/agents") = await import(
    "@openai/agents"
  );

  const processor = new PromptLayerOpenAIAgentsProcessor({
    apiKey,
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
