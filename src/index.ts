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
      if (prop === "Anthropic") {
        try {
          const module = require("@anthropic-ai/sdk").default;
          return promptLayerBase(module, "anthropic", "anthropic");
        } catch (e) {
          console.error(
            "To use the Anthropic module, you must install the @anthropic-ai/sdk package."
          );
        }
      }
      if (prop === "OpenAI") {
        try {
          const module = require("openai").default;
          return promptLayerBase(module, "openai", "openai");
        } catch (e) {
          console.error(
            "To use the OpenAI module, you must install the @openai/api package."
          );
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  }
);
