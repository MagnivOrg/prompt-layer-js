import BaseOpenAI from "openai";
import {PromptLayer} from "@/index";

const promptlayer = new PromptLayer({
  apiKey: process.env.PROMPTLAYER_API_KEY
});

const OpenAI: typeof BaseOpenAI = promptlayer.OpenAI;
const openai = new OpenAI();

openai.chat.completions.create({
  messages: [{role: "user", content: "Sup bra?"}],
  model: "gpt-3.5-turbo",
  // @ts-ignore
  pl_tags: ["test"],
});
