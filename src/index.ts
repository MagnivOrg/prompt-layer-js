import { GroupManager } from "@/groups";
import { promptLayerBase } from "@/promptlayer";
import { TemplateManager } from "@/templates";
import { TrackManager } from "@/track";

export class BasePromptLayer {
  apiKey: string;
  templates: TemplateManager;
  group: GroupManager;
  track: TrackManager;

  constructor(apiKey = process.env.PROMPTLAYER_API_KEY) {
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
}
