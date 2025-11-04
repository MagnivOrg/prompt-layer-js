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
import type { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import Ably from "ably";
import { Centrifuge } from "centrifuge";
import type TypeOpenAI from "openai";
import pRetry from "p-retry";
import {
  MAP_PROVIDER_TO_FUNCTION_NAME,
  cleaned_result,
  STREAMING_PROVIDERS_WITH_USAGE,
} from "./streaming";

export const SET_WORKFLOW_COMPLETE_MESSAGE = "SET_WORKFLOW_COMPLETE";

export enum FinalOutputCode {
  OK = "OK",
  EXCEEDS_SIZE_LIMIT = "EXCEEDS_SIZE_LIMIT",
}

async function getFinalOutput(
  baseURL: string,
  executionId: number,
  returnAllOutputs: boolean,
  headers: Record<string, string>
): Promise<any> {
  const response = await fetchWithRetry(
    `${baseURL}/workflow-version-execution-results?workflow_version_execution_id=${executionId}&return_all_outputs=${returnAllOutputs}`,
    { headers }
  );
  if (!response.ok) {
    throw new Error("Failed to fetch final output");
  }
  return response.json();
}

function makeMessageListener(
  baseURL: string,
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
        results = await getFinalOutput(
          baseURL,
          executionId,
          returnAllOutputs,
          headers
        );
        resultsPromise.resolve(results);
      } else {
        throw new Error(`Unsupported final output code: ${resultCode}`);
      }

      resultsPromise.resolve(results);
    } catch (err) {
      resultsPromise.reject(err);
    }
  };
}

interface WaitForWorkflowCompletionParams {
  token: string;
  channelName: string;
  executionId: number;
  returnAllOutputs: boolean;
  headers: Record<string, string>;
  timeout: number;
  baseURL: string;
}

async function waitForWorkflowCompletion({
  token,
  channelName,
  executionId,
  returnAllOutputs,
  headers,
  timeout,
  baseURL,
}: WaitForWorkflowCompletionParams): Promise<any> {
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
    baseURL,
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

      if ((response.status >= 500 && response.status < 600) || (response.status === 429)) {
        throw new Error(
          `Server error: ${response.status} ${response.statusText}`
        );
      }

      return response;
    },
    {
      retries: 3, // Retry up to 3 times (4 total attempts)
      factor: 2, // Exponential backoff factor
      minTimeout: 2000, // First retry after 2 seconds
      maxTimeout: 15000, // Cap at 15 seconds (gives us ~2s, ~4s, ~8s progression with randomization)
      randomize: true, // Add jitter to avoid thundering herd
      onFailedAttempt: (error) => {
        console.info(
          `PromptLayer API request attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`
        );
      },
    }
  );
};

const promptlayerApiHandler = async <Item>(
  apiKey: string,
  baseURL: string,
  body: TrackRequest & {
    request_response: AsyncIterable<Item> | any;
  },
  throwOnError: boolean = true
) => {
  const isGenerator = body.request_response[Symbol.asyncIterator] !== undefined;
  if (isGenerator) {
    return proxyGenerator(
      apiKey,
      baseURL,
      body.request_response,
      body,
      throwOnError
    );
  }
  return await promptLayerApiRequest(apiKey, baseURL, body, throwOnError);
};

const promptLayerApiRequest = async (
  apiKey: string,
  baseURL: string,
  body: TrackRequest,
  throwOnError: boolean = true
) => {
  try {
    const response = await fetchWithRetry(`${baseURL}/track-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 200) {
      const errorMessage =
        data.message || data.error || "Failed to log request";
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
  baseURL: string,
  body: TrackMetadata,
  throwOnError: boolean = true
): Promise<boolean> => {
  try {
    const response = await fetchWithRetry(`${baseURL}/library-track-metadata`, {
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
      const errorMessage =
        data.message || data.error || "Failed to track metadata";
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
  baseURL: string,
  body: TrackScore,
  throwOnError: boolean = true
): Promise<boolean> => {
  try {
    const response = await fetchWithRetry(`${baseURL}/library-track-score`, {
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
      const errorMessage =
        data.message || data.error || "Failed to track score";
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
  baseURL: string,
  body: TrackPrompt,
  throwOnError: boolean = true
): Promise<boolean> => {
  try {
    const response = await fetchWithRetry(`${baseURL}/library-track-prompt`, {
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
      const errorMessage =
        data.message || data.error || "Failed to track prompt";
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
  baseURL: string,
  body: TrackGroup,
  throwOnError: boolean = true
): Promise<boolean> => {
  try {
    const response = await fetchWithRetry(`${baseURL}/track-group`, {
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
      const errorMessage =
        data.message || data.error || "Failed to track group";
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
  baseURL: string,
  throwOnError: boolean = true
): Promise<number | boolean> => {
  try {
    const response = await fetchWithRetry(`${baseURL}/create-group`, {
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
      const errorMessage =
        data.message || data.error || "Failed to create group";
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
  baseURL: string,
  promptName: string,
  params?: Partial<GetPromptTemplateParams>,
  throwOnError: boolean = true
): Promise<GetPromptTemplateResponse | null> => {
  try {
    const url = new URL(`${baseURL}/prompt-templates/${promptName}`);
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
      const errorMessage =
        data.message || data.error || "Failed to fetch prompt template";
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
  baseURL: string,
  body: PublishPromptTemplate,
  throwOnError: boolean = true
): Promise<PublishPromptTemplateResponse> => {
  const response = await fetchWithRetry(`${baseURL}/rest/prompt-templates`, {
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
  });
  const data = await response.json();
  if (response.status !== 200 && response.status !== 201) {
    const errorMessage =
      data.message || data.error || "Failed to publish prompt template";
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
  baseURL: string,
  params?: Partial<Pagination>,
  throwOnError: boolean = true
): Promise<Array<ListPromptTemplatesResponse>> => {
  const url = new URL(`${baseURL}/prompt-templates`);
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
    const errorMessage =
      data.message || data.error || "Failed to fetch prompt templates";
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

const waitForWorkflowCompletionCentrifugo = async (
  params: WaitForWorkflowCompletionParams
): Promise<any> => {
  const url = new URL(`${params.baseURL}/connection/websocket`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  const client = new Centrifuge(url.toString(), { token: params.token });
  const sub = client.newSubscription(params.channelName);

  return new Promise((resolve, reject) => {
    const cleanupWithResolve = (data: any) => {
      cleanup();
      resolve(data);
    };

    const listener = makeMessageListener(
      params.baseURL,
      { resolve: cleanupWithResolve, reject },
      params.executionId,
      params.returnAllOutputs,
      params.headers
    );

    sub.on("publication", (message) => {
      listener({
        name: message.data.message_name,
        data: message.data.data,
      });
    });

    const timeout = setTimeout(() => {
      reject(
        new Error("Workflow execution did not complete properly (timeout)")
      );
    }, params.timeout);

    const cleanup = () => {
      clearTimeout(timeout);
      sub.unsubscribe();
      client.disconnect();
    };

    sub.on("error", (err) => {
      cleanup();
      reject(`Centrifugo subscription error: ${err}`);
    });

    client.on("error", (err) => {
      cleanup();
      reject(`Centrifugo client error: ${err}`);
    });

    sub.subscribe();
    client.connect();
  });
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
  baseURL,
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
      `${baseURL}/workflows/${encodeURIComponent(workflow_name)}/run`,
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
      `${baseURL}/ws-token-request-library?capability=${channel_name}`,
      {
        method: "POST",
        headers: headers,
      }
    );

    const ws_token_response = await ws_response.json();
    const token = ws_token_response.token_details.token;

    const params: WaitForWorkflowCompletionParams = {
      token,
      channelName: channel_name,
      executionId: execution_id,
      returnAllOutputs: return_all_outputs,
      headers: headers,
      timeout: timeout,
      baseURL: baseURL,
    };
    if (ws_token_response.messaging_backend === "centrifugo")
      return waitForWorkflowCompletionCentrifugo(params);
    return await waitForWorkflowCompletion(params);
  } catch (error) {
    console.error(
      `Failed to run workflow: ${
        error instanceof Error ? error.message : error
      }`
    );
    throw error;
  }
};

async function* proxyGenerator<Item>(
  apiKey: string,
  baseURL: string,
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
    baseURL,
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

const trackRequest = async (
  baseURL: string,
  body: TrackRequest,
  throwOnError: boolean = true
) => {
  try {
    const response = await fetchWithRetry(`${baseURL}/track-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 200) {
      const errorMessage =
        data.message || data.error || "Failed to track request";
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

const openaiChatRequest = async (client: TypeOpenAI, kwargs: any) => {
  return await client.chat.completions.create(kwargs);
};

const openaiCompletionsRequest = async (client: TypeOpenAI, kwargs: any) => {
  return await client.completions.create(kwargs);
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

  const api_type = promptBlueprint.metadata?.model?.api_type;
  if (api_type === "chat-completions") {
    const requestToMake =
      MAP_TYPE_TO_OPENAI_FUNCTION[promptBlueprint.prompt_template.type];
    return await requestToMake(client, kwargs);
  } else {
    return await client.responses.create(kwargs);
  }
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

  const api_type = promptBlueprint.metadata?.model?.api_type;

  if (api_type === "chat-completions") {
    const requestToMake = MAP_TYPE_TO_OPENAI_FUNCTION[promptBlueprint.prompt_template.type];
    return await requestToMake(client, kwargs);
  } else {
    return await client.responses.create(kwargs);
  }
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
  baseURL: string,
  body: LogRequest,
  throwOnError: boolean = true
): Promise<RequestLog | null> => {
  try {
    const response = await fetchWithRetry(`${baseURL}/log-request`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status !== 201) {
      const errorMessage =
        data.message || data.error || "Failed to log request";
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

const configureProviderSettings = (
  promptBlueprint: any,
  customProvider: any,
  modelParameterOverrides: any = {},
  stream: boolean = false
) => {
  const provider_type =
    customProvider?.client ?? promptBlueprint.metadata?.model?.provider;
  const api_type = promptBlueprint.metadata?.model?.api_type;

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

  if (stream && STREAMING_PROVIDERS_WITH_USAGE.includes(provider_type as any) && api_type === "chat-completions") {
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

export const readEnv = (env: string): string | undefined => {
  if (typeof (globalThis as any).process !== "undefined")
    return (globalThis as any).process.env?.[env]?.trim() ?? undefined;

  if (typeof (globalThis as any).Deno !== "undefined")
    return (globalThis as any).Deno.env?.get?.(env)?.trim();
  return undefined;
};

export {
  amazonBedrockRequest,
  anthropicBedrockRequest,
  anthropicRequest,
  azureOpenAIRequest,
  configureProviderSettings,
  getAllPromptTemplates,
  getPromptTemplate,
  getProviderConfig,
  googleRequest,
  mistralRequest,
  openaiRequest,
  promptlayerApiHandler,
  promptLayerApiRequest,
  promptLayerCreateGroup,
  promptLayerTrackGroup,
  promptLayerTrackMetadata,
  promptLayerTrackPrompt,
  promptLayerTrackScore,
  publishPromptTemplate,
  trackRequest,
  utilLogRequest,
  vertexaiRequest,
};
