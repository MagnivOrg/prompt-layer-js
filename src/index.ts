import { GroupManager } from "@/groups";
import { promptLayerBase } from "@/promptlayer";
import { TemplateManager } from "@/templates";
import { TrackManager } from "@/track";
import { RunRequest } from "@/types";
import { anthropicRequest, openaiRequest, trackRequest } from "@/utils";

const MAP_PROVIDER_TO_FUNCTION_NAME: Record<string, any> = {
  openai: {
    chat: "openai.chat.completions.create",
    completion: "openai.completions.create",
  },
  anthropic: {
    chat: "anthropic.messages.create",
    completion: "anthropic.completions.create",
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
    prompt_name,
    templateGetParams,
    tags,
    metadata,
    group_id,
  }: RunRequest) {
    let prompt_input_variables = {};
    if (templateGetParams?.input_variables)
      prompt_input_variables = templateGetParams.input_variables;
    const promptBlueprint = await this.templates.get(
      prompt_name,
      templateGetParams
    );
    if (!promptBlueprint) throw new Error("Prompt not found");
    const promptTemplate = promptBlueprint.prompt_template;
    if (!promptBlueprint.llm_kwargs) {
      throw new Error(
        `Prompt '${prompt_name}' does not have any LLM kwargs associated with it.`
      );
    }
    const promptBlueprintMetadata = promptBlueprint.metadata;
    if (!promptBlueprintMetadata) {
      throw new Error(
        `Prompt '${prompt_name}' does not have any metadata associated with it.`
      );
    }
    const promptBlueprintModel = promptBlueprintMetadata.model;
    if (!promptBlueprintModel) {
      throw new Error(
        `Prompt '${prompt_name}' does not have a model parameters associated with it.`
      );
    }
    const provider_type = promptBlueprintModel.provider;
    const requestStartTime = new Date().toISOString();
    const kwargs = promptBlueprint.llm_kwargs;
    const function_name =
      MAP_PROVIDER_TO_FUNCTION_NAME[provider_type][promptTemplate.type];
    const request_response = await MAP_PROVIDER_TO_FUNCTION[provider_type](
      promptBlueprint,
      kwargs
    );
    const requestEndTime = new Date().toISOString();
    const requestLog = await trackRequest({
      function_name,
      provider_type,
      args: [],
      kwargs,
      tags,
      request_response,
      request_start_time: requestStartTime,
      request_end_time: requestEndTime,
      api_key: this.apiKey,
      metadata,
      prompt_id: promptBlueprint.id,
      prompt_version: promptBlueprint.version,
      prompt_input_variables,
      group_id,
      return_prompt_blueprint: true,
    });
    const data = {
      request_id: requestLog.request_id,
      raw_response: request_response,
      prompt_blueprint: requestLog.prompt_blueprint,
    };
    return data;
  }
}
