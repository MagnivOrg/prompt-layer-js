import * as groups from "@/groups";
import { promptLayerBase } from "@/promptlayer";
import * as prompts from "@/prompts";
import * as templates from "@/templates";
import * as track from "@/track";
import * as utils from "@/utils";

export const promptlayer = new Proxy<{
  OpenAI: any;
  Anthropic: any;
  api_key: string | undefined;
  utils: typeof utils;
  track: typeof track;
  groups: typeof groups;
  prompts: typeof prompts;
  templates: typeof templates;
}>(
  {
    OpenAI: {},
    Anthropic: {},
    api_key: process.env.PROMPTLAYER_API_KEY,
    utils,
    track,
    groups,
    prompts,
    templates,
  },
  {
    get: (target, prop, receiver) => {
      if (["OpenAI", "Anthropic"].includes(prop.toString())) {
        const moduleName = prop === "OpenAI" ? "openai" : "@anthropic-ai/sdk";
        const module = require(moduleName).default;
        return promptLayerBase(
          module,
          prop.toString().toLowerCase(),
          prop.toString().toLowerCase()
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  }
);
