import {
  GetPromptTemplateParams,
  GetPromptTemplateResponse,
  ListPromptTemplatesResponse,
  LogRequest,
  Pagination,
  PublishPromptTemplate,
  PublishPromptTemplateResponse,
  RequestLog,
  RunWorkflowRequestParams,
  TrackGroup,
  TrackMetadata,
  TrackPrompt,
  TrackRequest,
  TrackScore,
  WorkflowResponse,
} from "@/types";
import type TypeAnthropic from "@anthropic-ai/sdk";
import {
  Completion as AnthropicCompletion,
  Message,
} from "@anthropic-ai/sdk/resources";
import { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import type { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import Ably from "ably";
import type TypeOpenAI from "openai";
import {
  ChatCompletion,
  ChatCompletionChunk,
  Completion,
} from "openai/resources";

export const SET_WORKFLOW_COMPLETE_MESSAGE = "SET_WORKFLOW_COMPLETE";

export enum FinalOutputCode {
  OK = "OK",
  EXCEEDS_SIZE_LIMIT = "EXCEEDS_SIZE_LIMIT",
}

async function getFinalOutput(
  executionId: number,
  returnAllOutputs: boolean,
  headers: Record<string, string>
): Promise<any> {
  const response = await fetch(
    `${URL_API_PROMPTLAYER}/workflow-version-execution-results?workflow_version_execution_id=${executionId}&return_all_outputs=${returnAllOutputs}`,
    { headers }
  );
  if (!response.ok) {
    throw new Error("Failed to fetch final output");
  }
  return response.json();
}

function makeMessageListener(
  resultsPromise: { resolve: (data: any) => void; reject: (err: any) => void },
  executionId: number,
  returnAllOutputs: boolean,
  headers: Record<string, string>
) {
  return async function (message: any) {
    if (message.name !== SET_WORKFLOW_COMPLETE_MESSAGE) return;

    try {
      const data = JSON.parse(message.data);
      const resultCode = data.result_code;
      let results;

      if (resultCode === FinalOutputCode.OK || resultCode == null) {
        results = data.final_output;
      } else if (resultCode === FinalOutputCode.EXCEEDS_SIZE_LIMIT) {
        results = await getFinalOutput(executionId, returnAllOutputs, headers);
      } else {
        throw new Error(`Unsupported final output code: ${resultCode}`);
      }

      resultsPromise.resolve(results);
    } catch (err) {
      resultsPromise.reject(err);
    }
  };
}

async function waitForWorkflowCompletion({
  token,
  channelName,
  executionId,
  returnAllOutputs,
  headers,
  timeout,
}: {
  token: string;
  channelName: string;
  executionId: number;
  returnAllOutputs: boolean;
  headers: Record<string, string>;
  timeout: number;
}): Promise<any> {
  const client = new Ably.Realtime(token);
  const channel = client.channels.get(channelName);

  const resultsPromise = {} as {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  };

  const promise = new Promise<any>((resolve, reject) => {
    resultsPromise.resolve = resolve;
    resultsPromise.reject = reject;
  });

  const listener = makeMessageListener(
    resultsPromise,
    executionId,
    returnAllOutputs,
    headers
  );
  await channel.subscribe(SET_WORKFLOW_COMPLETE_MESSAGE, listener);

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error("Workflow execution did not complete properly (timeout)")
        );
      }, timeout);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  } finally {
    console.log("Closing client");
    channel.unsubscribe(SET_WORKFLOW_COMPLETE_MESSAGE, listener);
    client.close();
    console.log("Closed client");
  }
}

export const URL_API_PROMPTLAYER =
  process.env.PROMPTLAYER_API_URL || "https://api.promptlayer.com";

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
    if (data.warning) {
      console.warn(
        `WARNING: While fetching your prompt PromptLayer had the following error: ${data.warning}`
      );
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

export const runWorkflowRequest = async ({
  workflow_name,
  input_variables,
  metadata = {},
  workflow_label_name = null,
  workflow_version_number = null,
  return_all_outputs = false,
  api_key,
  timeout = 3600000, // Default timeout is 1 hour in milliseconds
}: RunWorkflowRequestParams): Promise<WorkflowResponse> => {
  const payload = {
    input_variables,
    metadata,
    workflow_label_name,
    workflow_version_number,
    return_all_outputs,
  };

  const headers = {
    "X-API-KEY": api_key,
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(
      `${URL_API_PROMPTLAYER}/workflows/${encodeURIComponent(
        workflow_name
      )}/run`,
      {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload),
      }
    );

    if (response.status !== 201) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        message: `Failed to run workflow: ${
          errorData.error || response.statusText
        }`,
      };
    }

    const result = await response.json();
    if (result.warning) {
      console.warn(`WARNING: ${result.warning}`);
    }
    const execution_id = result.workflow_version_execution_id;
    if (!execution_id) {
      console.log("No execution ID returned from workflow run");
      return { success: false, message: "Failed to run workflow" };
    }

    const channel_name = `workflow_updates:${execution_id}`;
    const ws_response = await fetch(
      `${URL_API_PROMPTLAYER}/ws-token-request-library?capability=${channel_name}`,
      {
        method: "POST",
        headers: headers,
      }
    );

    const ws_token_response = await ws_response.json();
    const ably_token = ws_token_response.token_details.token;
    return await waitForWorkflowCompletion({
      token: ably_token,
      channelName: channel_name,
      executionId: execution_id,
      returnAllOutputs: return_all_outputs,
      headers: headers,
      timeout: timeout,
    });
  } catch (error) {
    console.error(
      `Failed to run workflow: ${
        error instanceof Error ? error.message : error
      }`
    );
    throw error;
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
  const firstChoice = results[0].choices.at(0);
  response.choices.push({
    finish_reason: firstChoice?.finish_reason ?? "stop",
    index: firstChoice?.index ?? 0,
    logprobs: firstChoice?.logprobs ?? null,
    message: {
      role: "assistant",
      content,
      function_call: functionCall ? functionCall : undefined,
      tool_calls: toolCalls ? toolCalls : undefined,
      refusal: firstChoice?.delta.refusal ?? null,
    },
  });
  response.id = lastResult.id;
  response.model = lastResult.model;
  response.created = lastResult.created;
  response.system_fingerprint = lastResult.system_fingerprint;
  response.usage = lastResult.usage ?? undefined;
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
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    },
  };
  const lastResult = results.at(-1);
  if (!lastResult) return response;
  let currentBlock: any = null;
  let currentSignature = "";
  let currentThinking = "";
  let currentText = "";
  let currentToolInputJson = "";

  for (const event of results) {
    if (event.type === "message_start") {
      response = { ...event.message };
    } else if (event.type === "content_block_start") {
      currentBlock = { ...event.content_block };
      if (currentBlock.type === "thinking") {
        currentSignature = "";
        currentThinking = "";
      } else if (currentBlock.type === "text") {
        currentText = "";
      } else if (
        currentBlock.type === "tool_use" ||
        currentBlock.type === "server_tool_use"
      ) {
        currentToolInputJson = "";
      }
    } else if (event.type === "content_block_delta" && currentBlock !== null) {
      if (currentBlock.type === "thinking") {
        if ("signature" in event.delta) {
          currentSignature = event.delta.signature || "";
        }
        if ("thinking" in event.delta) {
          currentThinking += event.delta.thinking || "";
        }
      } else if (currentBlock.type === "text") {
        if ("text" in event.delta) {
          currentText += event.delta.text || "";
        }
      } else if (
        currentBlock.type === "tool_use" ||
        currentBlock.type === "server_tool_use"
      ) {
        if (event.delta.type === "input_json_delta") {
          const inputJsonDelta = event.delta as any;
          currentToolInputJson += inputJsonDelta.partial_json || "";
        }
      }
    } else if (event.type === "content_block_stop" && currentBlock !== null) {
      if (currentBlock.type === "thinking") {
        currentBlock.signature = currentSignature;
        currentBlock.thinking = currentThinking;
      } else if (currentBlock.type === "text") {
        currentBlock.text = currentText;
        currentBlock.citations = null;
      } else if (
        currentBlock.type === "tool_use" ||
        currentBlock.type === "server_tool_use"
      ) {
        try {
          currentBlock.input = currentToolInputJson
            ? JSON.parse(currentToolInputJson)
            : {};
        } catch (e) {
          currentBlock.input = {};
        }
      }
      response.content!.push(currentBlock);
      currentBlock = null;
      currentSignature = "";
      currentThinking = "";
      currentText = "";
      currentToolInputJson = "";
    } else if (event.type === "message_delta") {
      if ("usage" in event && event.usage) {
        response.usage = {
          ...response.usage,
          output_tokens: event.usage.output_tokens ?? 0,
        };
      }
      if ("delta" in event && event.delta) {
        if (
          "stop_reason" in event.delta &&
          event.delta.stop_reason !== undefined
        ) {
          response.stop_reason = event.delta.stop_reason;
        }
        if (
          "stop_sequence" in event.delta &&
          event.delta.stop_sequence !== undefined
        ) {
          response.stop_sequence = event.delta.stop_sequence;
        }
      }
    }
  }

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
    const data = await response.json();
    if (response.status !== 200) {
      warnOnBadResponse(
        data,
        "WARNING: While logging your request, PromptLayer experienced the following error:"
      );
    }
    return data;
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
    apiKey: kwargs.apiKey,
  });
  const requestToMake =
    MAP_TYPE_TO_OPENAI_FUNCTION[promptBlueprint.prompt_template.type];
  return requestToMake(client, kwargs);
};

const azureOpenAIRequest = async (
  promptBlueprint: GetPromptTemplateResponse,
  kwargs: any
) => {
  const { AzureOpenAI } = require("openai");
  const client = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || kwargs.baseURL,
    apiVersion: process.env.OPENAI_API_VERSION || kwargs.apiVersion,
    apiKey: process.env.AZURE_OPENAI_API_KEY || kwargs.apiKey,
  });
  delete kwargs?.baseURL;
  delete kwargs?.apiVersion;
  delete kwargs?.apiKey;
  const requestToMake =
    MAP_TYPE_TO_OPENAI_FUNCTION[promptBlueprint.prompt_template.type];
  return requestToMake(client, kwargs);
};

const anthropicChatRequest = async (
  client: TypeAnthropic | AnthropicVertex,
  kwargs: any
) => {
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

const utilLogRequest = async (
  apiKey: string,
  body: LogRequest
): Promise<RequestLog | null> => {
  try {
    const response = await fetch(`${URL_API_PROMPTLAYER}/log-request`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 201) {
      warnOnBadResponse(
        data,
        "WARNING: While logging your request PromptLayer had the following error"
      );
      return null;
    }
    return data;
  } catch (e) {
    console.warn(
      `WARNING: While tracking your prompt PromptLayer had the following error: ${e}`
    );
    return null;
  }
};

const buildGoogleResponseFromParts = (
  thoughtContent: string,
  regularContent: string,
  functionCalls: any[],
  lastResult: any
) => {
  const response = { ...lastResult };
  const finalParts = [];

  if (thoughtContent) {
    const thoughtPart = {
      text: thoughtContent,
      thought: true,
    };
    finalParts.push(thoughtPart);
  }

  if (regularContent) {
    const textPart = {
      text: regularContent,
      thought: null,
    };
    finalParts.push(textPart);
  }

  for (const functionCall of functionCalls) {
    const functionPart = {
      function_call: functionCall,
    };
    finalParts.push(functionPart);
  }

  if (finalParts.length > 0 && response.candidates?.[0]?.content) {
    response.candidates[0].content.parts = finalParts;
  }

  return response;
};

const googleStreamResponse = (results: any[]) => {
  const { GenerateContentResponse } = require("@google/genai");

  if (!results.length) {
    return new GenerateContentResponse();
  }

  let thoughtContent = "";
  let regularContent = "";
  const functionCalls: any[] = [];

  for (const result of results) {
    if (result.candidates && result.candidates[0]?.content?.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.text) {
          if (part.thought === true) {
            thoughtContent += part.text;
          } else {
            regularContent += part.text;
          }
        } else if (part.functionCall) {
          functionCalls.push(part.functionCall);
        }
      }
    }
  }

  return buildGoogleResponseFromParts(
    thoughtContent,
    regularContent,
    functionCalls,
    results[results.length - 1]
  );
};

const googleStreamChat = (results: any[]) => {
  return googleStreamResponse(results);
};

const googleStreamCompletion = (results: any[]) => {
  return googleStreamResponse(results);
};

const googleChatRequest = async (model_client: any, kwargs: any) => {
  const history = kwargs?.history;
  const generationConfig = kwargs?.generationConfig;
  const lastMessage =
    history.length > 0 ? history[history.length - 1]?.parts : "";
  const chat = model_client.chats.create({
    model: kwargs?.model,
    history: history.slice(0, -1) ?? [],
    config: generationConfig,
  });

  if (kwargs?.stream)
    return await chat.sendMessageStream({ message: lastMessage });
  return await chat.sendMessage({ message: lastMessage });
};

const googleCompletionsRequest = async (
  model_client: any,
  { stream, ...kwargs }: any
) => {
  if (stream) return await model_client.generateContentStream({ ...kwargs });
  return await model_client.generateContent({ ...kwargs });
};

const MAP_TYPE_TO_GOOGLE_FUNCTION = {
  chat: googleChatRequest,
  completion: googleCompletionsRequest,
};

const googleRequest = async (
  promptBlueprint: GetPromptTemplateResponse,
  kwargs: any
) => {
  const { GoogleGenAI } = await import("@google/genai");

  const geminiAPI = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  const project =
    process.env.VERTEX_AI_PROJECT_ID ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT;
  const location =
    process.env.VERTEX_AI_PROJECT_LOCATION ||
    process.env.GOOGLE_PROJECT_LOCATION ||
    process.env.GOOGLE_CLOUD_PROJECT_LOCATION;
  const googleAuthOptions = {
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    projectId: project,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  };

  const genAI = geminiAPI
    ? new GoogleGenAI({ apiKey: geminiAPI })
    : new GoogleGenAI({
        vertexai: true,
        project: project,
        location: location,
        googleAuthOptions,
      });
  const requestToMake =
    MAP_TYPE_TO_GOOGLE_FUNCTION[promptBlueprint.prompt_template.type];

  const kwargsCamelCased = convertKeysToCamelCase(kwargs);
  if (kwargsCamelCased.generationConfig)
    kwargsCamelCased.generationConfig = convertKeysToCamelCase(
      kwargsCamelCased.generationConfig
    );

  return await requestToMake(genAI, kwargsCamelCased);
};

const snakeToCamel = (str: string): string =>
  str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const convertKeysToCamelCase = <T>(obj: T): T => {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(convertKeysToCamelCase) as T;

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [snakeToCamel(key), value])
  ) as T;
};

const STREAMING_PROVIDERS_WITH_USAGE = ["openai", "openai.azure"] as const;

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
  google: {
    chat: {
      function_name: "google.convo.send_message",
      stream_function: googleStreamChat,
    },
    completion: {
      function_name: "google.model.generate_content",
      stream_function: googleStreamCompletion,
    },
  },
};

const configureProviderSettings = (
  promptBlueprint: any,
  customProvider: any,
  modelParameterOverrides: any = {},
  stream: boolean = false
) => {
  const provider_type =
    customProvider?.client ?? promptBlueprint.metadata?.model?.provider;

  if (!provider_type) {
    throw new Error(
      "Provider type not found in prompt blueprint or custom provider"
    );
  }

  const kwargs = {
    ...(promptBlueprint.llm_kwargs || {}),
    ...modelParameterOverrides,
    stream,
  };

  const providerConfig = {
    baseURL: customProvider?.base_url ?? promptBlueprint.provider_base_url?.url,
    apiKey: customProvider?.api_key,
  };

  Object.entries(providerConfig).forEach(([key, value]) => {
    if (value !== undefined) {
      kwargs[key] = value;
    }
  });

  if (stream && STREAMING_PROVIDERS_WITH_USAGE.includes(provider_type as any)) {
    kwargs.stream_options = { include_usage: true };
  }

  return { provider_type, kwargs };
};

const getProviderConfig = (provider_type: string, promptTemplate: any) => {
  const providerMap =
    MAP_PROVIDER_TO_FUNCTION_NAME[
      provider_type as keyof typeof MAP_PROVIDER_TO_FUNCTION_NAME
    ];

  if (!providerMap) {
    throw new Error(`Unsupported provider type: ${provider_type}`);
  }

  const templateType = promptTemplate.type as keyof typeof providerMap;
  const config = providerMap[templateType];

  if (!config) {
    throw new Error(
      `Unsupported template type '${promptTemplate.type}' for provider '${provider_type}'`
    );
  }

  return config;
};

const vertexaiRequest = async (
  promptBlueprint: GetPromptTemplateResponse,
  kwargs: any
) => {
  const model = promptBlueprint.metadata?.model;
  if (!model) throw new Error("Model metadata not found in prompt blueprint");
  if (model.name.startsWith("gemini"))
    return googleRequest(promptBlueprint, kwargs);
  if (model.name.startsWith("claude")) {
    const { AnthropicVertex } = await import("@anthropic-ai/vertex-sdk");
    const client = new AnthropicVertex({ baseURL: kwargs.baseURL });
    if (promptBlueprint.prompt_template.type === "chat")
      return anthropicChatRequest(client, kwargs);
    throw new Error(
      `Unsupported prompt template type '${promptBlueprint.prompt_template.type}' for Anthropic Vertex AI`
    );
  }
  throw new Error(
    `Unsupported model name '${model.name}' for Vertex AI request`
  );
};
export {
  anthropicRequest,
  anthropicStreamCompletion,
  anthropicStreamMessage,
  azureOpenAIRequest,
  configureProviderSettings,
  getAllPromptTemplates,
  getPromptTemplate,
  getProviderConfig,
  googleRequest,
  googleStreamChat,
  googleStreamCompletion,
  openaiRequest,
  openaiStreamChat,
  openaiStreamCompletion,
  promptlayerApiHandler,
  promptLayerApiRequest,
  promptLayerCreateGroup,
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
  publishPromptTemplate,
  streamResponse,
  trackRequest,
  utilLogRequest,
  vertexaiRequest,
};
