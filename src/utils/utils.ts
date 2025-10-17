import pRetry from "p-retry";
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
import type { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
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
import {
  buildPromptBlueprintFromAnthropicEvent,
  buildPromptBlueprintFromBedrockEvent,
  buildPromptBlueprintFromGoogleEvent,
  buildPromptBlueprintFromOpenAIEvent,
} from "./blueprint-builder";

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
  const response = await fetchWithRetry(
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

/**
 * Wrapper around fetch that retries on 5xx server errors with exponential backoff.
 * Uses p-retry for industry-standard retry logic with exponential backoff.
 * 
 * @param input - The URL or Request object to fetch
 * @param init - The request initialization options
 * @returns Promise<Response> - The fetch response
 */
export const fetchWithRetry = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  return pRetry(
    async () => {
      const response = await fetch(input, init);

      if (response.status >= 500 && response.status < 600) {
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      return response;
    },
    {
      retries: 3, // Retry up to 3 times (4 total attempts)
      factor: 2, // Exponential backoff factor
      minTimeout: 1000, // First retry after 1 second
      maxTimeout: 8000, // Cap at 8 seconds (gives us ~1s, ~2s, ~4s progression with randomization)
      randomize: true, // Add jitter to avoid thundering herd
      onFailedAttempt: (error) => {
        console.warn(
          `PromptLayer API request attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
        );
      },
    }
  );
};

const promptlayerApiHandler = async <Item>(
  apiKey: string,
  body: TrackRequest & {
    request_response: AsyncIterable<Item> | any;
  },
  throwOnError: boolean = true
) => {
  const isGenerator = body.request_response[Symbol.asyncIterator] !== undefined;
  if (isGenerator) {
    return proxyGenerator(apiKey, body.request_response, body, throwOnError);
  }
  return await promptLayerApiRequest(apiKey, body, throwOnError);
};

const promptLayerApiRequest = async (
  apiKey: string,
  body: TrackRequest,
  throwOnError: boolean = true
) => {
  try {
    const response = await fetchWithRetry(`${URL_API_PROMPTLAYER}/track-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 200) {
      const errorMessage = data.message || data.error || "Failed to log request";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        warnOnBadResponse(
          data,
          "WARNING: While logging your request, PromptLayer experienced the following error:"
        );
      }
    }
    if (data && body.return_pl_id) {
      return [body.request_response, data.request_id];
    }
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
    console.warn(
      `WARNING: While logging your request PromptLayer had the following error: ${e}`
    );
  }
  return body.request_response;
};

const promptLayerTrackMetadata = async (
  apiKey: string,
  body: TrackMetadata,
  throwOnError: boolean = true
): Promise<boolean> => {
  try {
    const response = await fetchWithRetry(
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
      const errorMessage = data.message || data.error || "Failed to track metadata";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        warnOnBadResponse(
          data,
          "WARNING: While logging metadata to your request, PromptLayer experienced the following error"
        );
        return false;
      }
    }
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
    console.warn(
      `WARNING: While logging metadata to your request, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackScore = async (
  apiKey: string,
  body: TrackScore,
  throwOnError: boolean = true
): Promise<boolean> => {
  try {
    const response = await fetchWithRetry(`${URL_API_PROMPTLAYER}/library-track-score`, {
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
      const errorMessage = data.message || data.error || "Failed to track score";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        warnOnBadResponse(
          data,
          "WARNING: While scoring your request, PromptLayer experienced the following error"
        );
        return false;
      }
    }
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
    console.warn(
      `WARNING: While scoring your request, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackPrompt = async (
  apiKey: string,
  body: TrackPrompt,
  throwOnError: boolean = true
): Promise<boolean> => {
  try {
    const response = await fetchWithRetry(
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
      const errorMessage = data.message || data.error || "Failed to track prompt";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        warnOnBadResponse(
          data,
          "WARNING: While associating your request with a prompt template, PromptLayer experienced the following error"
        );
        return false;
      }
    }
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
    console.warn(
      `WARNING: While associating your request with a prompt template, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerTrackGroup = async (
  apiKey: string,
  body: TrackGroup,
  throwOnError: boolean = true
): Promise<boolean> => {
  try {
    const response = await fetchWithRetry(`${URL_API_PROMPTLAYER}/track-group`, {
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
      const errorMessage = data.message || data.error || "Failed to track group";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        warnOnBadResponse(
          data,
          "WARNING: While associating your request with a group, PromptLayer experienced the following error"
        );
        return false;
      }
    }
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
    console.warn(
      `WARNING: While associating your request with a group, PromptLayer experienced the following error: ${e}`
    );
    return false;
  }
  return true;
};

const promptLayerCreateGroup = async (
  apiKey: string,
  throwOnError: boolean = true
): Promise<number | boolean> => {
  try {
    const response = await fetchWithRetry(`${URL_API_PROMPTLAYER}/create-group`, {
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
      const errorMessage = data.message || data.error || "Failed to create group";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        warnOnBadResponse(
          data,
          "WARNING: While creating a group PromptLayer had the following error"
        );
        return false;
      }
    }
    return data.id;
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
    console.warn(
      `WARNING: While creating a group PromptLayer had the following error: ${e}`
    );
    return false;
  }
};

const getPromptTemplate = async (
  apiKey: string,
  promptName: string,
  params?: Partial<GetPromptTemplateParams>,
  throwOnError: boolean = true
): Promise<GetPromptTemplateResponse | null> => {
  try {
    const url = new URL(
      `${URL_API_PROMPTLAYER}/prompt-templates/${promptName}`
    );
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(params),
    });
    const data = await response.json();
    if (response.status !== 200) {
      const errorMessage = data.message || data.error || "Failed to fetch prompt template";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        console.warn(
          `WARNING: While fetching a prompt template PromptLayer had the following error: ${errorMessage}`
        );
        return null;
      }
    }
    if (data.warning) {
      console.warn(
        `WARNING: While fetching your prompt PromptLayer had the following error: ${data.warning}`
      );
    }
    return data as GetPromptTemplateResponse;
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
    console.warn(
      `WARNING: While fetching a prompt template PromptLayer had the following error: ${e}`
    );
    return null;
  }
};

const publishPromptTemplate = async (
  apiKey: string,
  body: PublishPromptTemplate,
  throwOnError: boolean = true
): Promise<PublishPromptTemplateResponse> => {
  const response = await fetchWithRetry(
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
  if (response.status !== 200 && response.status !== 201) {
    const errorMessage = data.message || data.error || "Failed to publish prompt template";
    if (throwOnError) {
      throw new Error(errorMessage);
    } else {
      warnOnBadResponse(
        data,
        "WARNING: While publishing a prompt template PromptLayer had the following error"
      );
    }
  }
  return data as PublishPromptTemplateResponse;
};

const getAllPromptTemplates = async (
  apiKey: string,
  params?: Partial<Pagination>,
  throwOnError: boolean = true
): Promise<Array<ListPromptTemplatesResponse>> => {
  const url = new URL(`${URL_API_PROMPTLAYER}/prompt-templates`);
  Object.entries(params || {}).forEach(([key, value]) =>
    url.searchParams.append(key, value.toString())
  );
  const response = await fetchWithRetry(url, {
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
  });
  const data = await response.json();
  if (response.status !== 200) {
    const errorMessage = data.message || data.error || "Failed to fetch prompt templates";
    if (throwOnError) {
      throw new Error(errorMessage);
    } else {
      warnOnBadResponse(
        data,
        "WARNING: While fetching all prompt templates PromptLayer had the following error"
      );
      return [];
    }
  }
  return (data.items ?? []) as Array<ListPromptTemplatesResponse>;
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
    const response = await fetchWithRetry(
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
    const ws_response = await fetchWithRetry(
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
  body: TrackRequest,
  throwOnError: boolean = true
) {
  const results = [];
  for await (const value of generator) {
    yield body.return_pl_id ? [value, null] : value;
    results.push(value);
  }
  const request_response = cleaned_result(results, body.function_name);
  const response = await promptLayerApiRequest(
    apiKey,
    {
      ...body,
      request_response,
      request_end_time: new Date().toISOString(),
    },
    throwOnError
  );
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

const trackRequest = async (body: TrackRequest, throwOnError: boolean = true) => {
  try {
    const response = await fetchWithRetry(`${URL_API_PROMPTLAYER}/track-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 200) {
      const errorMessage = data.message || data.error || "Failed to track request";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        warnOnBadResponse(
          data,
          "WARNING: While logging your request, PromptLayer experienced the following error:"
        );
      }
    }
    return data;
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
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

const mistralStreamChat = (results: any[]) => {
  let content: ChatCompletion.Choice["message"]["content"] = null;
  const response: ChatCompletion = {
    id: "",
    choices: [],
    created: Date.now(),
    model: "",
    object: "chat.completion",
  };
  const lastResult = results.at(-1).data;
  if (!lastResult) return response;
  let toolCalls: ChatCompletion.Choice["message"]["tool_calls"] = undefined;

  for (const result of results) {
    if (result.data.choices.length === 0) continue;
    const delta = result.data.choices[0].delta;

    if (delta.content) {
      content = `${content || ""}${delta.content || ""}`;
    }

    const toolCall = delta.toolCalls?.[0];
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
  const firstChoice = results[0].data.choices.at(0);
  response.choices.push({
    finish_reason: firstChoice?.finish_reason ?? "stop",
    index: firstChoice?.index ?? 0,
    logprobs: firstChoice?.logprobs ?? null,
    message: {
      role: "assistant",
      content,
      tool_calls: toolCalls ? toolCalls : undefined,
      refusal: firstChoice?.delta.refusal ?? null,
    },
  });
  response.id = lastResult.id;
  response.model = lastResult.model;
  response.created = lastResult.created;
  response.usage = lastResult.usage ?? undefined;
  return response;
};

const bedrockStreamMessage = (results: any[]) => {
  const response: any = {
    ResponseMetadata: {},
    output: { message: {} },
    stopReason: "end_turn",
    metrics: {},
    usage: {},
  };

  const content_blocks: any[] = [];
  let current_tool_call: any = null;
  let current_tool_input = "";
  let current_text = "";
  let current_signature = "";
  let current_thinking = "";

  for (const event of results) {
    if ("contentBlockStart" in event) {
      const content_block = event["contentBlockStart"];
      if ("start" in content_block && "toolUse" in content_block["start"]) {
        const tool_use = content_block["start"]["toolUse"];
        current_tool_call = {
          toolUse: {
            toolUseId: tool_use["toolUseId"],
            name: tool_use["name"],
          },
        };
        current_tool_input = "";
      }
    } else if ("contentBlockDelta" in event) {
      const delta = event["contentBlockDelta"]["delta"];
      if ("text" in delta) {
        current_text += delta["text"];
      } else if ("reasoningContent" in delta) {
        const reasoning_content = delta["reasoningContent"];
        if ("text" in reasoning_content) {
          current_thinking += reasoning_content["text"];
        } else if ("signature" in reasoning_content) {
          current_signature += reasoning_content["signature"];
        }
      } else if ("toolUse" in delta) {
        if ("input" in delta["toolUse"]) {
          const input_chunk = delta["toolUse"]["input"];
          current_tool_input += input_chunk;
          if (!input_chunk.trim()) {
            continue;
          }
        }
      }
    } else if ("contentBlockStop" in event) {
      if (current_tool_call && current_tool_input) {
        try {
          current_tool_call.toolUse.input = JSON.parse(current_tool_input);
        } catch {
          current_tool_call.toolUse.input = {};
        }
        content_blocks.push(current_tool_call);
        current_tool_call = null;
        current_tool_input = "";
      } else if (current_text) {
        content_blocks.push({ text: current_text });
        current_text = "";
      } else if (current_thinking && current_signature) {
        content_blocks.push({
          reasoningContent: {
            reasoningText: {
              text: current_thinking,
              signature: current_signature,
            },
          },
        });
        current_thinking = "";
        current_signature = "";
      }
    } else if ("messageStop" in event) {
      response.stopReason = event["messageStop"]["stopReason"];
    } else if ("metadata" in event) {
      const metadata = event["metadata"];
      response.usage = metadata?.usage || {};
      response.metrics = metadata?.metrics || {};
    }
  }

  response.output.message = { role: "assistant", content: content_blocks };
  return response;
};

async function* streamResponse<Item>(
  generator: AsyncIterable<Item> | any,
  afterStream: (body: object) => any,
  mapResults: any,
  metadata: any
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
  let response_metadata: any = {};
  const provider = metadata.model.provider;
  if (provider == "amazon.bedrock") {
    response_metadata = generator?.$metadata;
    generator = generator?.stream;
  }
  const results = [];
  for await (const result of generator) {
    results.push(result);
    data.raw_response = result;

    // Build prompt blueprint for Anthropic streaming events
    if (result && typeof result === "object" && "type" in result) {
      data.prompt_blueprint = buildPromptBlueprintFromAnthropicEvent(
        result as MessageStreamEvent,
        metadata
      );
    }

    // Build prompt blueprint for Google streaming events
    if (result && typeof result === "object" && "candidates" in result) {
      data.prompt_blueprint = buildPromptBlueprintFromGoogleEvent(
        result,
        metadata
      );
    }

    // Build prompt blueprint for OpenAI streaming events
    if (result && typeof result === "object" && "choices" in result) {
      data.prompt_blueprint = buildPromptBlueprintFromOpenAIEvent(
        result,
        metadata
      );
    }

    // Build prompt blueprint for Mistral streaming events
    if (result && typeof result === "object" && "data" in result) {
      data.prompt_blueprint = buildPromptBlueprintFromOpenAIEvent(
        result.data,
        metadata
      );
    }

    // Build prompt blueprint for Amazon Bedrock events
    if (provider === "amazon.bedrock") {
      data.prompt_blueprint = buildPromptBlueprintFromBedrockEvent(
        result,
        metadata
      );
    }

    yield data;
  }
  const request_response = mapResults(results);
  if (provider === "amazon.bedrock") {
    request_response.ResponseMetadata = response_metadata;
  }
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

  delete kwargs?.apiKey;
  delete kwargs?.baseURL;

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
  client: TypeAnthropic | AnthropicVertex | AnthropicBedrock,
  kwargs: any
) => {
  return client.messages.create(kwargs);
};

const anthropicCompletionsRequest = async (
  client: TypeAnthropic | AnthropicBedrock,
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
    apiKey: kwargs.apiKey,
  });
  const requestToMake =
    MAP_TYPE_TO_ANTHROPIC_FUNCTION[promptBlueprint.prompt_template.type];
  return requestToMake(client, kwargs);
};

const utilLogRequest = async (
  apiKey: string,
  body: LogRequest,
  throwOnError: boolean = true
): Promise<RequestLog | null> => {
  try {
    const response = await fetchWithRetry(`${URL_API_PROMPTLAYER}/log-request`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 201) {
      const errorMessage = data.message || data.error || "Failed to log request";
      if (throwOnError) {
        throw new Error(errorMessage);
      } else {
        warnOnBadResponse(
          data,
          "WARNING: While logging your request PromptLayer had the following error"
        );
        return null;
      }
    }
    return data;
  } catch (e) {
    if (throwOnError) {
      throw e;
    }
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

  return await requestToMake(genAI, kwargs);
};

const snakeToCamel = (str: string): string =>
  str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

const convertKeysToCamelCase = <T>(
  obj: T,
  ignoreValuesWithKeys: Set<string> = new Set()
): T => {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj))
    return obj.map((item) =>
      convertKeysToCamelCase(item, ignoreValuesWithKeys)
    ) as T;

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (ignoreValuesWithKeys.has(key)) {
        return [snakeToCamel(key), value];
      }
      return [
        snakeToCamel(key),
        convertKeysToCamelCase(value, ignoreValuesWithKeys),
      ];
    })
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
  "amazon.bedrock": {
    chat: {
      function_name: "boto3.bedrock-runtime.converse",
      stream_function: bedrockStreamMessage,
    },
    completion: {
      function_name: "boto3.bedrock-runtime.converse",
      stream_function: bedrockStreamMessage,
    },
  },
  "anthropic.bedrock": {
    chat: {
      function_name: "anthropic.messages.create",
      stream_function: anthropicStreamMessage,
    },
    completion: {
      function_name: "anthropic.completions.create",
      stream_function: anthropicStreamCompletion,
    },
  },
  mistral: {
    chat: {
      function_name: "mistral.client.chat",
      stream_function: mistralStreamChat,
    },
    completion: {
      function_name: "",
      stream_function: null,
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

  let kwargs = {
    ...(promptBlueprint.llm_kwargs || {}),
    stream,
  };

  if (
    ["google", "vertexai"].includes(provider_type) &&
    promptBlueprint.metadata?.model?.name.startsWith("gemini")
  )
    kwargs = convertKeysToCamelCase(
      kwargs,
      new Set(["function_declarations", "properties"])
    );

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

const amazonBedrockRequest = async (
  promptBlueprint: GetPromptTemplateResponse,
  kwargs: any
) => {
  const { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } =
    await import("@aws-sdk/client-bedrock-runtime");
  const client = new BedrockRuntimeClient({
    credentials: {
      accessKeyId: kwargs?.aws_access_key || process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey:
        kwargs?.aws_secret_key || process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: kwargs?.aws_session_token || process.env.AWS_SESSION_TOKEN,
    },
    region:
      kwargs?.aws_region ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-east-1",
  });

  if (kwargs?.stream) {
    delete kwargs.stream;
    const command = new ConverseStreamCommand({
      ...kwargs,
    });
    return await client.send(command);
  } else {
    delete kwargs?.stream;
    const command = new ConverseCommand({
      ...kwargs,
    });
    return await client.send(command);
  }
};

const anthropicBedrockRequest = async (
  promptBlueprint: GetPromptTemplateResponse,
  kwargs: any
) => {
  const { AnthropicBedrock } = await import("@anthropic-ai/bedrock-sdk");
  const client = new AnthropicBedrock({
    awsAccessKey: kwargs.aws_access_key,
    awsSecretKey: kwargs.aws_secret_key,
    awsRegion: kwargs.aws_region,
    awsSessionToken: kwargs.aws_session_token,
    baseURL: kwargs.base_url,
  });

  const requestToMake =
    MAP_TYPE_TO_ANTHROPIC_FUNCTION[promptBlueprint.prompt_template.type];
  return requestToMake(client, kwargs);
};

const mistralRequest = async (
  promptBlueprint: GetPromptTemplateResponse,
  kwargs: any
) => {
  const { Mistral } = await import("@mistralai/mistralai");
  const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
  kwargs = convertKeysToCamelCase(kwargs, new Set());
  if (kwargs?.stream) {
    delete kwargs.stream;
    return await client.chat.stream(kwargs);
  }
  delete kwargs.stream;
  return await client.chat.complete(kwargs);
};

export {
  amazonBedrockRequest,
  anthropicBedrockRequest,
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
  mistralRequest,
  mistralStreamChat,
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
