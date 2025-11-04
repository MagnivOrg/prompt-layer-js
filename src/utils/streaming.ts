import {
  Completion as AnthropicCompletion,
  Message,
} from "@anthropic-ai/sdk/resources";
import { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
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
  buildPromptBlueprintFromOpenAIResponsesEvent,
} from "./blueprint-builder";

export const STREAMING_PROVIDERS_WITH_USAGE = ["openai", "openai.azure"] as const;


export const openaiResponsesStreamChat = (results: any[]) => {
  const response_data: any = {
    id: null,
    object: "response",
    created_at: null,
    status: null,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model: null,
    output: [],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: {},
    store: true,
    temperature: 1,
    text: undefined,
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    truncation: "disabled",
    usage: null,
    user: null,
    metadata: {},
  };

  const current_items: Record<string, any> = {};

  for (const chunk of results as any[]) {
    const event_type = chunk?.type;

    if (event_type === "response.created") {
      const response = chunk.response || {};
      response_data.id = response.id ?? response_data.id;
      response_data.created_at = response.created_at ?? response_data.created_at;
      response_data.model = response.model ?? response_data.model;
      response_data.status = response.status ?? response_data.status;
      response_data.parallel_tool_calls =
        response.parallel_tool_calls ?? response_data.parallel_tool_calls;
      response_data.temperature =
        response.temperature ?? response_data.temperature;
      response_data.tool_choice = response.tool_choice ?? response_data.tool_choice;
      response_data.tools = response.tools ?? response_data.tools;
      response_data.top_p = response.top_p ?? response_data.top_p;
      response_data.truncation = response.truncation ?? response_data.truncation;
      response_data.max_output_tokens =
        response.max_output_tokens ?? response_data.max_output_tokens;
      response_data.previous_response_id =
        response.previous_response_id ?? response_data.previous_response_id;
      response_data.store = response.store ?? response_data.store;
      response_data.user = response.user ?? response_data.user;
      response_data.metadata = response.metadata ?? response_data.metadata;

      const text_config = response.text;
      if (text_config) {
        response_data.text = text_config;
      }
      const reasoning = response.reasoning;
      if (reasoning) {
        response_data.reasoning = reasoning;
      }
      continue;
    }

    if (event_type === "response.in_progress") {
      const response = chunk.response || {};
      response_data.status = response.status ?? response_data.status;
      continue;
    }

    if (event_type === "response.output_item.added") {
      const item = chunk.item || {};
      const item_id = item.id;
      const item_type = item.type;

      if (item_type === "reasoning") {
        current_items[item_id] = {
          type: "reasoning",
          id: item_id,
          summary: [],
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "function_call") {
        current_items[item_id] = {
          type: "function_call",
          id: item_id,
          call_id: item.call_id,
          name: item.name,
          arguments: "",
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "message") {
        current_items[item_id] = {
          type: "message",
          id: item_id,
          role: item.role ?? "assistant",
          content: [],
          status: item.status ?? "in_progress",
        };
      }
      continue;
    }

    if (event_type === "response.reasoning_summary_part.added") {
      const item_id = chunk.item_id;
      const part = chunk.part || {};
      if (item_id in current_items && current_items[item_id].type === "reasoning") {
        const summary_part = {
          type: part.type ?? "summary_text",
          text: part.text ?? "",
        };
        current_items[item_id].summary.push(summary_part);
      }
      continue;
    }

    if (event_type === "response.reasoning_summary_text.delta") {
      const item_id = chunk.item_id;
      const delta = chunk.delta ?? "";
      const summary_index = chunk.summary_index ?? 0;

      if (item_id in current_items && current_items[item_id].type === "reasoning") {
        while ((current_items[item_id].summary as any[]).length <= summary_index) {
          current_items[item_id].summary.push({ type: "summary_text", text: "" });
        }
        current_items[item_id].summary[summary_index].text += delta;
      }
      continue;
    }

    if (event_type === "response.reasoning_summary_text.done") {
      const item_id = chunk.item_id;
      const final_text = chunk.text ?? "";
      const summary_index = chunk.summary_index ?? 0;

      if (item_id in current_items && current_items[item_id].type === "reasoning") {
        while ((current_items[item_id].summary as any[]).length <= summary_index) {
          current_items[item_id].summary.push({ type: "summary_text", text: "" });
        }
        current_items[item_id].summary[summary_index].text = final_text;
      }
      continue;
    }

    if (event_type === "response.reasoning_summary_part.done") {
      const item_id = chunk.item_id;
      const part = chunk.part || {};
      if (item_id in current_items && current_items[item_id].type === "reasoning") {
        const summary_index = chunk.summary_index ?? 0;
        if (summary_index < current_items[item_id].summary.length) {
          current_items[item_id].summary[summary_index] = {
            type: part.type ?? "summary_text",
            text: part.text ?? "",
          };
        }
      }
      continue;
    }

    if (event_type === "response.function_call_arguments.delta") {
      const item_id = chunk.item_id;
      const delta = chunk.delta ?? "";
      if (item_id in current_items) {
        current_items[item_id].arguments = `${
          current_items[item_id].arguments || ""
        }${delta}`;
      }
      continue;
    }

    if (event_type === "response.function_call_arguments.done") {
      const item_id = chunk.item_id;
      const final_arguments = chunk.arguments ?? "";
      if (item_id in current_items) {
        current_items[item_id].arguments = final_arguments;
      }
      continue;
    }

    if (event_type === "response.content_part.added") {
      const part = chunk.part || {};
      const messageItem = Object.values(current_items).find(
        (it: any) => it.type === "message"
      ) as any;
      if (messageItem) {
        const content_part = {
          type: part.type ?? "output_text",
          text: part.text ?? "",
          annotations: part.annotations ?? [],
        };
        messageItem.content.push(content_part);
      }
      continue;
    }

    if (event_type === "response.output_text.delta") {
      const delta_text = chunk.delta ?? "";
      for (const item of Object.values(current_items) as any[]) {
        if (item.type === "message" && item.content && item.content.length) {
          const last = item.content[item.content.length - 1];
          if (last && last.type === "output_text") {
            last.text = `${last.text || ""}${delta_text}`;
          }
          break;
        }
      }
      continue;
    }

    if (event_type === "response.output_text.done") {
      const final_text = chunk.text ?? "";
      for (const item of Object.values(current_items) as any[]) {
        if (item.type === "message" && item.content && item.content.length) {
          const last = item.content[item.content.length - 1];
          if (last && last.type === "output_text") {
            last.text = final_text;
          }
          break;
        }
      }
      continue;
    }

    if (event_type === "response.output_item.done") {
      const item = chunk.item || {};
      const item_id = item.id;
      if (item_id in current_items) {
        current_items[item_id].status = item.status ?? "completed";
        if (item.type === "reasoning") {
          current_items[item_id].summary =
            item.summary ?? current_items[item_id].summary;
        } else if (item.type === "function_call") {
          current_items[item_id].arguments =
            item.arguments ?? current_items[item_id].arguments;
          current_items[item_id].call_id =
            item.call_id ?? current_items[item_id].call_id;
          current_items[item_id].name = item.name ?? current_items[item_id].name;
        } else if (item.type === "message") {
          current_items[item_id].content =
            item.content ?? current_items[item_id].content;
          current_items[item_id].role = item.role ?? current_items[item_id].role;
        }
        response_data.output.push(current_items[item_id]);
      }
      continue;
    }

    if (event_type === "response.completed") {
      const response = chunk.response || {};
      response_data.status = response.status ?? response_data.status ?? "completed";
      response_data.usage = response.usage ?? response_data.usage;
      response_data.output = response.output ?? response_data.output;
      if (response.reasoning) {
        response_data.reasoning = response.reasoning;
      }
      continue;
    }
  }

  return response_data;
}

export const openaiStreamChat = (results: ChatCompletionChunk[]): ChatCompletion => {
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
  let toolCalls: any[] | undefined = undefined;
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
      (lastToolCall as any).function.name = `${(lastToolCall as any).function.name}${
        toolCall.function?.name || ""
      }`;
      (lastToolCall as any).function.arguments = `${(lastToolCall as any).function.arguments}${
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

export const openaiStreamCompletion = (results: Completion[]) => {
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

export const anthropicStreamMessage = (results: MessageStreamEvent[]): Message => {
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

export const anthropicStreamCompletion = (results: AnthropicCompletion[]) => {
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

export const mistralStreamChat = (results: any[]) => {
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
  let toolCalls: any[] | undefined = undefined;

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
      (lastToolCall as any).function.name = `${(lastToolCall as any).function.name}${
        toolCall.function?.name || ""
      }`;
      (lastToolCall as any).function.arguments = `${(lastToolCall as any).function.arguments}${
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

export const bedrockStreamMessage = (results: any[]) => {
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

export const googleStreamChat = (results: any[]) => {
  return googleStreamResponse(results);
};

export const googleStreamCompletion = (results: any[]) => {
  return googleStreamResponse(results);
};

export const cleaned_result = (
  results: any[],
  function_name = "openai.chat.completions.create"
) => {
  // Handle OpenAI Responses API streaming events
  if ( function_name === "openai.responses.create" || function_name === "openai.AzureOpenAI.responses.create") {
    return openaiResponsesStreamChat(results);
  }

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


const buildStreamBlueprint = (result: any, metadata: any) => {
  const provider = metadata.model.provider;
  const model = metadata.model.name;

  if (provider === "anthropic" || provider === "anthropic.bedrock" || (provider === "vertexai" && model.startsWith("claude"))) {
    return buildPromptBlueprintFromAnthropicEvent(result, metadata);
  }

  if (provider === "google" || (provider === "vertexai" && model.startsWith("gemini"))) {
    return buildPromptBlueprintFromGoogleEvent(result, metadata);
  }

  if (provider === "amazon.bedrock") {
    return buildPromptBlueprintFromBedrockEvent(result, metadata);
  }

  if (provider === "mistral") {
    return buildPromptBlueprintFromOpenAIEvent(result.data, metadata);
  }

  if (provider === "openai" || provider === "openai.azure") {
    const api_type = metadata.model.api_type || "chat-completions";
    if (api_type === "responses") {
      return buildPromptBlueprintFromOpenAIResponsesEvent(result, metadata);
    }
    return buildPromptBlueprintFromOpenAIEvent(result, metadata);
  }

  return null;
}

export async function* streamResponse<Item>(
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
    data.prompt_blueprint = buildStreamBlueprint(result, metadata);

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

export const MAP_PROVIDER_TO_FUNCTION_NAME = {
  "openai:chat-completions": {
    chat: {
      function_name: "openai.chat.completions.create",
      stream_function: openaiStreamChat,
    },
    completion: {
      function_name: "openai.completions.create",
      stream_function: openaiStreamCompletion,
    },
  },
  "openai:responses": {
    chat: {
      function_name: "openai.responses.create",
      stream_function: openaiResponsesStreamChat,
    },
    completion: {
      function_name: "openai.responses.create",
      stream_function: openaiResponsesStreamChat,
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
  "openai.azure:chat-completions": {
    chat: {
      function_name: "openai.AzureOpenAI.chat.completions.create",
      stream_function: openaiStreamChat,
    },
    completion: {
      function_name: "openai.AzureOpenAI.completions.create",
      stream_function: openaiStreamCompletion,
    },
  },
  "openai.azure:responses": {
    chat: {
      function_name: "openai.AzureOpenAI.responses.create",
      stream_function: openaiResponsesStreamChat,
    },
    completion: {
      function_name: "openai.AzureOpenAI.responses.create",
      stream_function: openaiResponsesStreamChat,
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
