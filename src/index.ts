import * as opentelemetry from '@opentelemetry/api';
import {GroupManager} from "@/groups";
import {promptLayerBase} from "@/promptlayer";
import {TemplateManager} from "@/templates";
import {getTracer, setupTracing} from '@/tracing';
import {TrackManager} from "@/track";
import {GetPromptTemplateParams, RunRequest} from "@/types";
import {
  anthropicRequest,
  anthropicStreamCompletion,
  anthropicStreamMessage,
  openaiRequest,
  openaiStreamChat,
  openaiStreamCompletion,
  streamResponse,
  trackRequest,
} from "@/utils";

setupTracing();

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
};

const MAP_PROVIDER_TO_FUNCTION: Record<string, any> = {
  openai: openaiRequest,
  anthropic: anthropicRequest,
};

export interface ClientOptions {
  apiKey?: string;
}

export class PromptLayer {
  apiKey: string;
  templates: TemplateManager;
  group: GroupManager;
  track: TrackManager;

  constructor({
                apiKey = process.env.PROMPTLAYER_API_KEY,
              }: ClientOptions = {}) {
    if (apiKey === undefined) {
      throw new Error(
        "PromptLayer API key not provided. Please set the PROMPTLAYER_API_KEY environment variable or pass the api_key parameter."
      );
    }
    this.apiKey = apiKey;
    this.templates = new TemplateManager(apiKey);
    this.group = new GroupManager(apiKey);
    this.track = new TrackManager(apiKey);
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

    return tracer.startActiveSpan('PromptLayer.run', async (span) => {
      try {
        span.setAttribute('promptName', promptName);
        span.setAttribute('promptVersion', promptVersion || 'undefined');
        span.setAttribute('promptReleaseLabel', promptReleaseLabel || 'undefined');
        span.setAttribute('stream', stream);

        if (tags) span.setAttribute('tags', JSON.stringify(tags));
        if (groupId) span.setAttribute('groupId', groupId);

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
        span.setAttribute('provider_type', provider_type);

        const request_start_time = new Date().toISOString();
        const kwargs = promptBlueprint.llm_kwargs;
        const config =
          MAP_PROVIDER_TO_FUNCTION_NAME[
            provider_type as keyof typeof MAP_PROVIDER_TO_FUNCTION_NAME
            ][promptTemplate.type];
        const function_name = config.function_name;
        span.setAttribute('function_name', function_name);

        const stream_function = config.stream_function;
        const request_function = MAP_PROVIDER_TO_FUNCTION[provider_type];
        const provider_base_url = promptBlueprint.provider_base_url;
        if (provider_base_url) {
          kwargs["baseURL"] = provider_base_url.url;
        }
        kwargs["stream"] = stream;
        if (stream && provider_type === "openai") {
          kwargs["stream_options"] = {include_usage: true};
        }

        // Create a new span for the request_function call
        const response = await tracer.startActiveSpan(`${provider_type}.request`, async (requestSpan) => {
          try {
            const result = await request_function(promptBlueprint, kwargs);
            requestSpan.setStatus({code: opentelemetry.SpanStatusCode.OK});
            return result;
          } catch (error) {
            requestSpan.setStatus({
              code: opentelemetry.SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : 'Unknown error',
            });
            throw error;
          } finally {
            requestSpan.end();
          }
        });

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
            ...body,
          });
        };

        if (stream) return streamResponse(response, _trackRequest, stream_function);
        const requestLog = await _trackRequest({request_response: response});
        const data = {
          request_id: requestLog.request_id,
          raw_response: response,
          prompt_blueprint: requestLog.prompt_blueprint,
        };
        return data;
      } catch (error) {
        span.setStatus({
          code: opentelemetry.SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
