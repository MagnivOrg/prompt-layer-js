import { GroupManager } from "@/groups";
import { promptLayerBase } from "@/promptlayer";
import { wrapWithSpan } from "@/span-wrapper";
import { TemplateManager } from "@/templates";
import { getTracer, setupTracing } from "@/tracing";
import { TrackManager } from "@/track";
import {
  GetPromptTemplateParams,
  LogRequest,
  RunRequest,
  WorkflowRequest,
  WorkflowResponse,
} from "@/types";
import {
  anthropicBedrockRequest,
  anthropicRequest,
  azureOpenAIRequest,
  configureProviderSettings,
  getProviderConfig,
  googleRequest,
  mistralRequest,
  openaiRequest,
  runWorkflowRequest,
  streamResponse,
  trackRequest,
  utilLogRequest,
  vertexaiRequest,
} from "@/utils/utils";
import * as opentelemetry from "@opentelemetry/api";

const MAP_PROVIDER_TO_FUNCTION: Record<string, any> = {
  openai: openaiRequest,
  anthropic: anthropicRequest,
  "openai.azure": azureOpenAIRequest,
  google: googleRequest,
  vertexai: vertexaiRequest,
  "anthropic.bedrock": anthropicBedrockRequest,
  mistral: mistralRequest,
};

export interface ClientOptions {
  apiKey?: string;
  enableTracing?: boolean;
  workspaceId?: number;
}

const isWorkflowResultsDict = (obj: any): boolean => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return false;
  }

  const REQUIRED_KEYS = [
    "status",
    "value",
    "error_message",
    "raw_error_message",
    "is_output_node",
  ];
  const values = Object.values(obj);

  return values.every((val) => {
    if (typeof val !== "object" || val === null) return false;
    return REQUIRED_KEYS.every((key) => key in val);
  });
};

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
    modelParameterOverrides,
    stream = false,
    provider,
    model,
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
          modelParameterOverrides,
          stream,
        };
        span.setAttribute("function_input", JSON.stringify(functionInput));

        const prompt_input_variables = inputVariables;
        const templateGetParams: GetPromptTemplateParams = {
          label: promptReleaseLabel,
          version: promptVersion,
          metadata_filters: metadata,
          provider,
          model,
          model_parameter_overrides: modelParameterOverrides,
        };
        if (inputVariables) templateGetParams.input_variables = inputVariables;

        const promptBlueprint = await this.templates.get(
          promptName,
          templateGetParams
        );

        if (!promptBlueprint) throw new Error("Prompt not found");

        const promptTemplate = promptBlueprint.prompt_template;
        if (!promptBlueprint.llm_kwargs) {
          console.warn(
            `Prompt '${promptName}' does not have any LLM kwargs associated with it. Please set your model parameters in the registry in the PromptLayer dashbaord.`
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

        const customProvider = promptBlueprint.custom_provider;
        const request_start_time = new Date().toISOString();

        const { provider_type, kwargs } = configureProviderSettings(
          promptBlueprint,
          customProvider,
          modelParameterOverrides,
          stream
        );

        let provider_type_config = provider_type;
        if (promptBlueprintModel.name.startsWith("gemini")) {
          provider_type_config = "google";
        } else if (promptBlueprintModel.name.startsWith("claude")) {
          provider_type_config = "anthropic";
        }

        const config = getProviderConfig(provider_type_config, promptTemplate);
        const { function_name, stream_function } = config;

        const request_function = MAP_PROVIDER_TO_FUNCTION[provider_type];
        if (!request_function) {
          throw new Error(
            `No request function found for provider: ${provider_type}`
          );
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
          return streamResponse(
            response,
            _trackRequest,
            stream_function,
            metadata
          );
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

  async runWorkflow({
    workflowName,
    inputVariables = {},
    metadata = {},
    workflowLabelName = null,
    workflowVersion = null, // This is the version number, not the version ID
    returnAllOutputs = false,
  }: WorkflowRequest): Promise<WorkflowResponse> {
    try {
      const result = await runWorkflowRequest({
        workflow_name: workflowName,
        input_variables: inputVariables,
        metadata,
        workflow_label_name: workflowLabelName,
        workflow_version_number: workflowVersion,
        return_all_outputs: returnAllOutputs,
        api_key: this.apiKey,
      });

      if (!returnAllOutputs) {
        if (isWorkflowResultsDict(result)) {
          const nodeValues = Object.values(result);

          const outputNodes = nodeValues.filter(
            (node: any) => node.is_output_node === true
          );

          if (outputNodes.length === 0) {
            throw new Error(JSON.stringify(result, null, 2));
          }

          const anyOutputSuccess = outputNodes.some(
            (node: any) => node.status === "SUCCESS"
          );
          if (!anyOutputSuccess) {
            throw new Error(JSON.stringify(result, null, 2));
          }
        }
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error running workflow:", error.message);
        throw new Error(`Error running workflow: ${error.message}`);
      } else {
        console.error("Unknown error running workflow:", error);
        throw new Error("Unknown error running workflow");
      }
    }
  }

  async logRequest(body: LogRequest) {
    return utilLogRequest(this.apiKey, body);
  }
}
