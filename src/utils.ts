import {
  GetPromptTemplateParams,
  GetPromptTemplateResponse,
  ListPromptTemplatesResponse,
  Pagination,
  PublishPromptTemplate,
  PublishPromptTemplateResponse,
  TrackGroup,
  TrackMetadata,
  TrackPrompt,
  TrackRequest,
  TrackScore,
} from "@/types";
import type TypeAnthropic from "@anthropic-ai/sdk";
import {
  Completion as AnthropicCompletion,
  Message,
  MessageStreamEvent,
} from "@anthropic-ai/sdk/resources";
import type TypeOpenAI from "openai";
import {
  ChatCompletion,
  ChatCompletionChunk,
  Completion,
} from "openai/resources";

export const URL_API_PROMPTLAYER = process.env.URL_API_PROMPTLAYER || "https://api.promptlayer.com";

const promptlayerApiHandler = async <Item>(
  apiKey: string,
  body: TrackRequest & {
    request_response: AsyncIterable<Item> | any;
  }
) => {
  const isGenerator = body.request_response[Symbol.asyncIterator] !== undefined;
  if (isGenerator) {
    return proxyGenerator(apiKey, body.request_response, body);
  }
  return await promptLayerApiRequest(apiKey, body);
};

const promptLayerApiRequest = async (apiKey: string, body: TrackRequest) => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/track-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While logging your request, PromptLayer experienced the following error:"
      );
    }
    if (data && body.return_pl_id) {
      return [body.request_response, data.request_id];
    }
  } catch (e) {
    console.warn(
      `WARNING: While logging your request PromptLayer had the following error: ${e}`
    );
  }
  return body.request_response;
};

const promptLayerTrackMetadata = async (
  apiKey: string,
  body: TrackMetadata
): Promise<boolean> => {
  try {
    const response = await fetch(
      `${URL_API_PROMPTLAYER}/library-track-metadata`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          api_key: apiKey,
        }),
      }
    );
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While logging metadata to your request, PromptLayer experienced the following error"
      );
      return false;
    }
  } catch (e) {
    console.warn(
      `WARNING: While logging metadata to your request, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackScore = async (
  apiKey: string,
  body: TrackScore
): Promise<boolean> => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/library-track-score`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        api_key: apiKey,
      }),
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While scoring your request, PromptLayer experienced the following error"
      );
      return false;
    }
  } catch (e) {
    console.warn(
      `WARNING: While scoring your request, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackPrompt = async (
  apiKey: string,
  body: TrackPrompt
): Promise<boolean> => {
  try {
    const response = await fetch(
      `${URL_API_PROMPTLAYER}/library-track-prompt`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          api_key: apiKey,
        }),
      }
    );
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While associating your request with a prompt template, PromptLayer experienced the following error"
      );
      return false;
    }
  } catch (e) {
    console.warn(
      `WARNING: While associating your request with a prompt template, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackGroup = async (
  apiKey: string,
  body: TrackGroup
): Promise<boolean> => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/track-group`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        api_key: apiKey,
      }),
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While associating your request with a group, PromptLayer experienced the following error"
      );
      return false;
    }
  } catch (e) {
    console.warn(
      `WARNING: While associating your request with a group, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerCreateGroup = async (
  apiKey: string
): Promise<number | boolean> => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/create-group`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
      }),
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While creating a group PromptLayer had the following error"
      );
      return false;
    }
    return data.id;
  } catch (e) {
    console.warn(
      `WARNING: While creating a group PromptLayer had the following error: ${e}`
    );
    return false;
  }
};

const getPromptTemplate = async (
  apiKey: string,
  promptName: string,
  params?: Partial<GetPromptTemplateParams>
) => {
  try {
    const url = new URL(
      `${URL_API_PROMPTLAYER}/prompt-templates/${promptName}`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(params),
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While fetching a prompt template PromptLayer had the following error"
      );
      return null;
    }
    return data as Promise<GetPromptTemplateResponse>;
  } catch (e) {
    console.warn(
      `WARNING: While fetching a prompt template PromptLayer had the following error: ${e}`
    );
    return null;
  }
};

const publishPromptTemplate = async (
  apiKey: string,
  body: PublishPromptTemplate
) => {
  try {
    const response = await fetch(
      `${URL_API_PROMPTLAYER}/rest/prompt-templates`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({
          prompt_template: { ...body },
          prompt_version: { ...body },
          release_labels: body.release_labels ? body.release_labels : undefined,
        }),
      }
    );
    const data = await response.json();
    if (response.status === 400) {
      warnOnBadResponse(
        data,
        "WARNING: While publishing a prompt template PromptLayer had the following error"
      );
    }
    return data as Promise<PublishPromptTemplateResponse>;
  } catch (e) {
    console.warn(
      `WARNING: While publishing a prompt template PromptLayer had the following error: ${e}`
    );
  }
};

const getAllPromptTemplates = async (
  apiKey: string,
  params?: Partial<Pagination>
) => {
  try {
    const url = new URL(`${URL_API_PROMPTLAYER}/prompt-templates`);
    Object.entries(params || {}).forEach(([key, value]) =>
      url.searchParams.append(key, value.toString())
    );
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
    });
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While fetching all prompt templates PromptLayer had the following error"
      );
      return null;
    }
    return (data.items ?? []) as Promise<Array<ListPromptTemplatesResponse>>;
  } catch (e) {
    console.warn(
      `WARNING: While fetching all prompt templates PromptLayer had the following error: ${e}`
    );
    return null;
  }
};

const openaiStreamChat = (results: ChatCompletionChunk[]): ChatCompletion => {
  let content: ChatCompletion.Choice["message"]["content"] = null;
  let functionCall: ChatCompletion.Choice["message"]["function_call"] =
    undefined;
  const response: ChatCompletion = {
    id: "",
    choices: [],
    created: Date.now(),
    model: "",
    object: "chat.completion",
  };
  const lastResult = results.at(-1);
  if (!lastResult) return response;
  let toolCalls: ChatCompletion.Choice["message"]["tool_calls"] = undefined;
  for (const result of results) {
    if (result.choices.length === 0) continue;
    const delta = result.choices[0].delta;

    if (delta.content) {
      content = `${content || ""}${delta.content || ""}`;
    }
    if (delta.function_call) {
      functionCall = {
        name: `${functionCall ? functionCall.name : ""}${
          delta.function_call.name || ""
        }`,
        arguments: `${functionCall ? functionCall.arguments : ""}${
          delta.function_call.arguments || ""
        }`,
      };
    }
    const toolCall = delta.tool_calls?.[0];
    if (toolCall) {
      toolCalls = toolCalls || [];
      const lastToolCall = toolCalls.at(-1);
      if (!lastToolCall || toolCall.id) {
        toolCalls.push({
          id: toolCall.id || "",
          type: toolCall.type || "function",
          function: {
            name: toolCall.function?.name || "",
            arguments: toolCall.function?.arguments || "",
          },
        });
        continue;
      }
      lastToolCall.function.name = `${lastToolCall.function.name}${
        toolCall.function?.name || ""
      }`;
      lastToolCall.function.arguments = `${lastToolCall.function.arguments}${
        toolCall.function?.arguments || ""
      }`;
    }
  }
  response.choices.push({
    finish_reason: results[0].choices[0].finish_reason || "stop",
    index: results[0].choices[0].index || 0,
    logprobs: results[0].choices[0].logprobs || null,
    message: {
      role: "assistant",
      content,
      function_call: functionCall ? functionCall : undefined,
      tool_calls: toolCalls ? toolCalls : undefined,
    },
  });
  response.id = lastResult.id;
  response.model = lastResult.model;
  response.created = lastResult.created;
  response.system_fingerprint = lastResult.system_fingerprint;
  response.usage = lastResult.usage;
  return response;
};

const anthropicStreamMessage = (results: MessageStreamEvent[]): Message => {
  let response: Message = {
    id: "",
    model: "",
    content: [],
    role: "assistant",
    type: "message",
    stop_reason: "stop_sequence",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
  const lastResult = results.at(-1);
  if (!lastResult) return response;
  let content = "";
  for (const result of results) {
    switch (result.type) {
      case "message_start": {
        response = {
          ...result.message,
        };
        break;
      }
      case "content_block_delta": {
        if (result.delta.type === "text_delta")
          content = `${content}${result.delta.text}`;
      }
      case "message_delta": {
        if ("usage" in result)
          response.usage.output_tokens = result.usage.output_tokens;
        if ("stop_reason" in result.delta)
          response.stop_reason = result.delta.stop_reason;
      }
      default: {
        break;
      }
    }
  }
  response.content.push({
    type: "text",
    text: content,
  });
  return response;
};

const cleaned_result = (
  results: any[],
  function_name = "openai.chat.completions.create"
) => {
  if ("completion" in results[0]) {
    return results.reduce(
      (prev, current) => ({
        ...current,
        completion: `${prev.completion}${current.completion}`,
      }),
      {}
    );
  }

  if (function_name === "anthropic.messages.create")
    return anthropicStreamMessage(results);

  if ("text" in results[0].choices[0]) {
    let response = "";
    for (const result of results) {
      response = `${response}${result.choices[0].text}`;
    }
    const final_result = structuredClone(results.at(-1));
    final_result.choices[0].text = response;
    return final_result;
  }

  if ("delta" in results[0].choices[0]) {
    const response = openaiStreamChat(results);
    response.choices[0] = {
      ...response.choices[0],
      ...response.choices[0].message,
    };
    return response;
  }

  return "";
};

async function* proxyGenerator<Item>(
  apiKey: string,
  generator: AsyncIterable<Item>,
  body: TrackRequest
) {
  const results = [];
  for await (const value of generator) {
    yield body.return_pl_id ? [value, null] : value;
    results.push(value);
  }
  const request_response = cleaned_result(results, body.function_name);
  const response = await promptLayerApiRequest(apiKey, {
    ...body,
    request_response,
    request_end_time: new Date().toISOString(),
  });
  if (response) {
    if (body.return_pl_id) {
      const request_id = (response as any)[1];
      const lastResult = results.at(-1);
      yield [lastResult, request_id];
    }
  }
}

const warnOnBadResponse = (request_response: any, main_message: string) => {
  try {
    console.warn(`${main_message}: ${request_response.message}`);
  } catch (e) {
    console.warn(`${main_message}: ${request_response}`);
  }
};

const trackRequest = async (body: TrackRequest) => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/track-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (response.status !== 200)
      warnOnBadResponse(
        response,
        "WARNING: While logging your request, PromptLayer experienced the following error:"
      );
    return response.json();
  } catch (e) {
    console.warn(
      `WARNING: While logging your request PromptLayer had the following error: ${e}`
    );
  }
  return {};
};

const openaiStreamCompletion = (results: Completion[]) => {
  const response: Completion = {
    id: "",
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        text: "",
        logprobs: null,
      },
    ],
    created: Date.now(),
    model: "",
    object: "text_completion",
  };
  const lastResult = results.at(-1);
  if (!lastResult) return response;
  let text = "";
  for (const result of results) {
    if (result.choices.length > 0 && result.choices[0].text) {
      text = `${text}${result.choices[0].text}`;
    }
  }
  response.choices[0].text = text;
  response.id = lastResult.id;
  response.created = lastResult.created;
  response.model = lastResult.model;
  response.system_fingerprint = lastResult.system_fingerprint;
  response.usage = lastResult.usage;
  return response;
};

const anthropicStreamCompletion = (results: AnthropicCompletion[]) => {
  const response: AnthropicCompletion = {
    completion: "",
    id: "",
    model: "",
    stop_reason: "",
    type: "completion",
  };
  const lastResult = results.at(-1);
  if (!lastResult) return response;
  let completion = "";
  for (const result of results) {
    completion = `${completion}${result.completion}`;
  }
  response.completion = completion;
  response.id = lastResult.id;
  response.model = lastResult.model;
  response.stop_reason = lastResult.stop_reason;
  return response;
};

async function* streamResponse<Item>(
  generator: AsyncIterable<Item>,
  afterStream: (body: object) => any,
  mapResults: any
) {
  const data: {
    request_id: number | null;
    raw_response: any;
    prompt_blueprint: any;
  } = {
    request_id: null,
    raw_response: null,
    prompt_blueprint: null,
  };
  const results = [];
  for await (const result of generator) {
    results.push(result);
    data.raw_response = result;
    yield data;
  }
  const request_response = mapResults(results);
  const response = await afterStream({ request_response });
  data.request_id = response.request_id;
  data.prompt_blueprint = response.prompt_blueprint;
  yield data;
}

const openaiChatRequest = async (client: TypeOpenAI, kwargs: any) => {
  return client.chat.completions.create(kwargs);
};

const openaiCompletionsRequest = async (client: TypeOpenAI, kwargs: any) => {
  return client.completions.create(kwargs);
};

const MAP_TYPE_TO_OPENAI_FUNCTION = {
  chat: openaiChatRequest,
  completion: openaiCompletionsRequest,
};

const openaiRequest = async (
  promptBlueprint: GetPromptTemplateResponse,
  kwargs: any
) => {
  const OpenAI = require("openai").default;
  const client = new OpenAI({
    baseURL: kwargs.baseURL,
  });
  const requestToMake =
    MAP_TYPE_TO_OPENAI_FUNCTION[promptBlueprint.prompt_template.type];
  return requestToMake(client, kwargs);
};

const anthropicChatRequest = async (client: TypeAnthropic, kwargs: any) => {
  return client.messages.create(kwargs);
};

const anthropicCompletionsRequest = async (
  client: TypeAnthropic,
  kwargs: any
) => {
  return client.completions.create(kwargs);
};

const MAP_TYPE_TO_ANTHROPIC_FUNCTION = {
  chat: anthropicChatRequest,
  completion: anthropicCompletionsRequest,
};

const anthropicRequest = async (
  promptBlueprint: GetPromptTemplateResponse,
  kwargs: any
) => {
  const Anthropic = require("@anthropic-ai/sdk").default;
  const client = new Anthropic({
    baseURL: kwargs.baseURL,
  });
  const requestToMake =
    MAP_TYPE_TO_ANTHROPIC_FUNCTION[promptBlueprint.prompt_template.type];
  return requestToMake(client, kwargs);
};

export {
  anthropicRequest,
  anthropicStreamCompletion,
  anthropicStreamMessage,
  getAllPromptTemplates,
  getPromptTemplate,
  openaiRequest,
  openaiStreamChat,
  openaiStreamCompletion,
  promptLayerApiRequest,
  promptLayerCreateGroup,
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
  promptlayerApiHandler,
  publishPromptTemplate,
  streamResponse,
  trackRequest,
};
