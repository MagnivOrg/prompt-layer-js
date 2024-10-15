import { GroupManager } from "@/groups";
import { promptLayerBase } from "@/promptlayer";
import { wrapWithSpan } from "@/span-wrapper";
import { TemplateManager } from "@/templates";
import { getTracer, setupTracing } from "@/tracing";
import { TrackManager } from "@/track";
import { GetPromptTemplateParams, LogRequest, RunRequest } from "@/types";
import {
  anthropicRequest,
  anthropicStreamCompletion,
  anthropicStreamMessage,
  azureOpenAIRequest,
  openaiRequest,
  openaiStreamChat,
  openaiStreamCompletion,
  streamResponse,
  trackRequest,
  utilLogRequest,
} from "@/utils";
import * as opentelemetry from "@opentelemetry/api";

const MAP_PROVIDER_TO_FUNCTION_NAME = {
  openai: {
    chat: {
      function_name: "openai.chat.completions.create",
      stream_function: openaiStreamChat,
    },
    completion: {
      function_name: "openai.completions.create",
      stream_function: openaiStreamCompletion,
    },
  },
  anthropic: {
    chat: {
      function_name: "anthropic.messages.create",
      stream_function: anthropicStreamMessage,
    },
    completion: {
      function_name: "anthropic.completions.create",
      stream_function: anthropicStreamCompletion,
    },
  },
  "openai.azure": {
    chat: {
      function_name: "openai.AzureOpenAI.chat.completions.create",
      stream_function: openaiStreamChat,
    },
    completion: {
      function_name: "openai.AzureOpenAI.completions.create",
      stream_function: openaiStreamCompletion,
    },
  },
};

const MAP_PROVIDER_TO_FUNCTION: Record<string, any> = {
  openai: openaiRequest,
  anthropic: anthropicRequest,
  "openai.azure": azureOpenAIRequest,
};

export interface ClientOptions {
  apiKey?: string;
  enableTracing?: boolean;
  workspaceId?: number;
}

export class PromptLayer {
  apiKey: string;
  templates: TemplateManager;
  group: GroupManager;
  track: TrackManager;
  enableTracing: boolean;
  wrapWithSpan: typeof wrapWithSpan;

  constructor({
    apiKey = process.env.PROMPTLAYER_API_KEY,
    enableTracing = false,
  }: ClientOptions = {}) {
    if (apiKey === undefined) {
      throw new Error(
        "PromptLayer API key not provided. Please set the PROMPTLAYER_API_KEY environment variable or pass the api_key parameter."
      );
    }

    this.apiKey = apiKey;
    this.enableTracing = enableTracing;
    this.templates = new TemplateManager(apiKey);
    this.group = new GroupManager(apiKey);
    this.track = new TrackManager(apiKey);
    this.wrapWithSpan = wrapWithSpan;

    if (enableTracing) {
      setupTracing(enableTracing, apiKey);
    }
  }

  get Anthropic() {
    try {
      const module = require("@anthropic-ai/sdk").default;
      return promptLayerBase(this.apiKey, module, "anthropic", "anthropic");
    } catch (e) {
      console.error(
        "To use the Anthropic module, you must install the @anthropic-ai/sdk package."
      );
    }
  }

  get OpenAI() {
    try {
      const module = require("openai").default;
      return promptLayerBase(this.apiKey, module, "openai", "openai");
    } catch (e) {
      console.error(
        "To use the OpenAI module, you must install the @openai/api package."
      );
    }
  }

  async run({
    promptName,
    promptVersion,
    promptReleaseLabel,
    inputVariables,
    tags,
    metadata,
    groupId,
    stream = false,
  }: RunRequest) {
    const tracer = getTracer();

    return tracer.startActiveSpan("PromptLayer Run", async (span) => {
      try {
        const functionInput = {
          promptName,
          promptVersion,
          promptReleaseLabel,
          inputVariables,
          tags,
          metadata,
          groupId,
          stream,
        };
        span.setAttribute("function_input", JSON.stringify(functionInput));

        const prompt_input_variables = inputVariables;
        const templateGetParams: GetPromptTemplateParams = {
          label: promptReleaseLabel,
          version: promptVersion,
          metadata_filters: metadata,
        };
        if (inputVariables) templateGetParams.input_variables = inputVariables;

        const promptBlueprint = await this.templates.get(
          promptName,
          templateGetParams
        );

        if (!promptBlueprint) throw new Error("Prompt not found");

        const promptTemplate = promptBlueprint.prompt_template;
        if (!promptBlueprint.llm_kwargs) {
          throw new Error(
            `Prompt '${promptName}' does not have any LLM kwargs associated with it.`
          );
        }

        const promptBlueprintMetadata = promptBlueprint.metadata;
        if (!promptBlueprintMetadata) {
          throw new Error(
            `Prompt '${promptName}' does not have any metadata associated with it.`
          );
        }

        const promptBlueprintModel = promptBlueprintMetadata.model;
        if (!promptBlueprintModel) {
          throw new Error(
            `Prompt '${promptName}' does not have a model parameters associated with it.`
          );
        }

        const provider_type = promptBlueprintModel.provider;

        const request_start_time = new Date().toISOString();
        const kwargs = promptBlueprint.llm_kwargs;
        const config =
          MAP_PROVIDER_TO_FUNCTION_NAME[
            provider_type as keyof typeof MAP_PROVIDER_TO_FUNCTION_NAME
          ][promptTemplate.type];
        const function_name = config.function_name;

        const stream_function = config.stream_function;
        const request_function = MAP_PROVIDER_TO_FUNCTION[provider_type];
        const provider_base_url = promptBlueprint.provider_base_url;
        if (provider_base_url) {
          kwargs["baseURL"] = provider_base_url.url;
        }
        kwargs["stream"] = stream;
        if (stream && ["openai", "openai.azure"].includes(provider_type)) {
          kwargs["stream_options"] = { include_usage: true };
        }

        const response = await request_function(promptBlueprint, kwargs);

        const _trackRequest = (body: object) => {
          const request_end_time = new Date().toISOString();
          return trackRequest({
            function_name,
            provider_type,
            args: [],
            kwargs,
            tags,
            request_start_time,
            request_end_time,
            api_key: this.apiKey,
            metadata,
            prompt_id: promptBlueprint.id,
            prompt_version: promptBlueprint.version,
            prompt_input_variables,
            group_id: groupId,
            return_prompt_blueprint: true,
            span_id: span.spanContext().spanId,
            ...body,
          });
        };

        if (stream)
          return streamResponse(response, _trackRequest, stream_function);
        const requestLog = await _trackRequest({ request_response: response });

        const functionOutput = {
          request_id: requestLog.request_id,
          raw_response: response,
          prompt_blueprint: requestLog.prompt_blueprint,
        };
        span.setAttribute("function_output", JSON.stringify(functionOutput));

        return functionOutput;
      } catch (error) {
        span.setStatus({
          code: opentelemetry.SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async logRequest(body: LogRequest) {
    return utilLogRequest(this.apiKey, body);
  }
}
