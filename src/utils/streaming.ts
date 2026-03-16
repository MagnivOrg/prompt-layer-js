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
  buildPromptBlueprintFromOpenAIImagesEvent,
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
  const output_index_to_item_id: Record<number, string> = {};

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
      const output_index = chunk.output_index;
      if (output_index != null && item_id) {
        output_index_to_item_id[output_index] = item_id;
      }

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
      } else if (item_type === "code_interpreter_call") {
        current_items[item_id] = {
          type: "code_interpreter_call",
          id: item_id,
          container_id: item.container_id,
          code: item.code ?? "",
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "image_generation_call") {
        current_items[item_id] = {
          type: "image_generation_call",
          id: item_id,
          status: item.status ?? "in_progress",
          revised_prompt: item.revised_prompt ?? "",
          result: item.result ?? "",
          background: item.background,
          size: item.size,
          quality: item.quality,
          output_format: item.output_format,
        };
      } else if (item_type === "web_search_call") {
        current_items[item_id] = {
          type: "web_search_call",
          id: item_id,
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "file_search_call") {
        current_items[item_id] = {
          type: "file_search_call",
          id: item_id,
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "mcp_list_tools") {
        current_items[item_id] = {
          type: "mcp_list_tools",
          id: item_id,
          server_label: item.server_label ?? "",
          tools: item.tools ?? [],
          error: item.error ?? null,
        };
      } else if (item_type === "mcp_call") {
        current_items[item_id] = {
          type: "mcp_call",
          id: item_id,
          name: item.name ?? "",
          server_label: item.server_label ?? "",
          arguments: item.arguments ?? "",
          output: item.output ?? null,
          error: item.error ?? null,
          approval_request_id: item.approval_request_id ?? null,
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "mcp_approval_request") {
        current_items[item_id] = {
          type: "mcp_approval_request",
          id: item_id,
          name: item.name ?? "",
          arguments: item.arguments ?? "",
          server_label: item.server_label ?? "",
        };
      } else if (item_type === "shell_call") {
        current_items[item_id] = {
          type: "shell_call",
          id: item_id,
          call_id: item.call_id ?? "",
          action: item.action ?? {},
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "shell_call_output") {
        current_items[item_id] = {
          type: "shell_call_output",
          id: item_id,
          call_id: item.call_id ?? "",
          output: item.output ?? [],
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "apply_patch_call") {
        current_items[item_id] = {
          type: "apply_patch_call",
          id: item_id,
          call_id: item.call_id ?? "",
          operation: item.operation ?? {},
          status: item.status ?? "in_progress",
        };
      } else if (item_type === "apply_patch_call_output") {
        current_items[item_id] = {
          type: "apply_patch_call_output",
          id: item_id,
          call_id: item.call_id ?? "",
          output: item.output ?? "",
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
        } else if (item.type === "image_generation_call") {
          current_items[item_id].result =
            item.result ?? current_items[item_id].result;
          current_items[item_id].revised_prompt =
            item.revised_prompt ?? current_items[item_id].revised_prompt;
          current_items[item_id].background =
            item.background ?? current_items[item_id].background;
          current_items[item_id].size =
            item.size ?? current_items[item_id].size;
          current_items[item_id].quality =
            item.quality ?? current_items[item_id].quality;
          current_items[item_id].output_format =
            item.output_format ?? current_items[item_id].output_format;
        } else if (item.type === "code_interpreter_call") {
          current_items[item_id].code =
            item.code ?? current_items[item_id].code;
          current_items[item_id].container_id =
            item.container_id ?? current_items[item_id].container_id;
        } else if (item.type === "mcp_list_tools") {
          current_items[item_id].tools =
            item.tools ?? current_items[item_id].tools;
          current_items[item_id].error =
            item.error ?? current_items[item_id].error;
        } else if (item.type === "mcp_call") {
          current_items[item_id].name =
            item.name ?? current_items[item_id].name;
          current_items[item_id].arguments =
            item.arguments ?? current_items[item_id].arguments;
          current_items[item_id].output =
            item.output ?? current_items[item_id].output;
          current_items[item_id].error =
            item.error ?? current_items[item_id].error;
          current_items[item_id].server_label =
            item.server_label ?? current_items[item_id].server_label;
        } else if (item.type === "mcp_approval_request") {
          current_items[item_id].name =
            item.name ?? current_items[item_id].name;
          current_items[item_id].arguments =
            item.arguments ?? current_items[item_id].arguments;
          current_items[item_id].server_label =
            item.server_label ?? current_items[item_id].server_label;
        } else if (item.type === "shell_call") {
          current_items[item_id].action =
            item.action ?? current_items[item_id].action;
          current_items[item_id].call_id =
            item.call_id ?? current_items[item_id].call_id;
        } else if (item.type === "shell_call_output") {
          current_items[item_id].output =
            item.output ?? current_items[item_id].output;
          current_items[item_id].call_id =
            item.call_id ?? current_items[item_id].call_id;
        } else if (item.type === "apply_patch_call") {
          current_items[item_id].operation =
            item.operation ?? current_items[item_id].operation;
          current_items[item_id].call_id =
            item.call_id ?? current_items[item_id].call_id;
        } else if (item.type === "apply_patch_call_output") {
          current_items[item_id].output =
            item.output ?? current_items[item_id].output;
          current_items[item_id].call_id =
            item.call_id ?? current_items[item_id].call_id;
        } else if (item.type === "web_search_call") {
          current_items[item_id].action = item.action;
        } else if (item.type === "file_search_call") {
          current_items[item_id].action = item.action;
        }
        response_data.output.push(current_items[item_id]);
      }
      continue;
    }

    if (event_type === "response.image_generation_call.in_progress") {
      const item_id = chunk.item_id;
      if (item_id in current_items) {
        current_items[item_id].status = "in_progress";
      }
      continue;
    }

    if (event_type === "response.image_generation_call.generating") {
      const item_id = chunk.item_id;
      if (item_id in current_items) {
        current_items[item_id].status = "generating";
      }
      continue;
    }

    if (event_type === "response.image_generation_call.partial_image") {
      const item_id = chunk.item_id;
      if (item_id in current_items) {
        current_items[item_id].result = chunk.partial_image_b64 ?? current_items[item_id].result;
        current_items[item_id].background = chunk.background ?? current_items[item_id].background;
        current_items[item_id].size = chunk.size ?? current_items[item_id].size;
        current_items[item_id].quality = chunk.quality ?? current_items[item_id].quality;
        current_items[item_id].output_format = chunk.output_format ?? current_items[item_id].output_format;
      }
      continue;
    }

    if (event_type === "response.shell_call_command.added") {
      const item_id = output_index_to_item_id[chunk.output_index];
      if (item_id && item_id in current_items) {
        const action = current_items[item_id].action || { commands: [] };
        if (!action.commands) action.commands = [];
        action.commands[chunk.command_index] = chunk.command ?? "";
        current_items[item_id].action = action;
      }
      continue;
    }

    if (event_type === "response.shell_call_command.delta") {
      const item_id = output_index_to_item_id[chunk.output_index];
      if (item_id && item_id in current_items) {
        const action = current_items[item_id].action || { commands: [] };
        if (!action.commands) action.commands = [];
        const idx = chunk.command_index ?? 0;
        action.commands[idx] = (action.commands[idx] ?? "") + (chunk.delta ?? "");
        current_items[item_id].action = action;
      }
      continue;
    }

    if (event_type === "response.shell_call_command.done") {
      const item_id = output_index_to_item_id[chunk.output_index];
      if (item_id && item_id in current_items) {
        const action = current_items[item_id].action || { commands: [] };
        if (!action.commands) action.commands = [];
        action.commands[chunk.command_index] = chunk.command ?? "";
        current_items[item_id].action = action;
      }
      continue;
    }

    if (event_type === "response.shell_call_output_content.delta") {
      const item_id = chunk.item_id;
      if (item_id && item_id in current_items) {
        if (!current_items[item_id].output) current_items[item_id].output = [];
        const idx = chunk.command_index ?? 0;
        const existing = current_items[item_id].output[idx] ?? { stdout: "", stderr: "" };
        const delta = chunk.delta ?? {};
        if (delta.stdout) existing.stdout = (existing.stdout ?? "") + delta.stdout;
        if (delta.stderr) existing.stderr = (existing.stderr ?? "") + delta.stderr;
        current_items[item_id].output[idx] = existing;
      }
      continue;
    }

    if (event_type === "response.shell_call_output_content.done") {
      const item_id = chunk.item_id;
      if (item_id && item_id in current_items) {
        current_items[item_id].output = chunk.output ?? current_items[item_id].output;
      }
      continue;
    }

    if (event_type === "response.apply_patch_call_operation_diff.delta") {
      const item_id = chunk.item_id;
      if (item_id && item_id in current_items) {
        const operation = current_items[item_id].operation || {};
        operation.diff = (operation.diff ?? "") + (chunk.delta ?? "");
        current_items[item_id].operation = operation;
      }
      continue;
    }

    if (event_type === "response.apply_patch_call_operation_diff.done") {
      const item_id = chunk.item_id;
      if (item_id && item_id in current_items) {
        const operation = current_items[item_id].operation || {};
        operation.diff = chunk.diff ?? operation.diff;
        current_items[item_id].operation = operation;
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
  let currentBlockIndex: number | null = null;
  let currentSignature = "";
  let currentThinking = "";
  let currentText = "";
  let currentToolInputJson = "";
  const citationsByBlockIndex: Record<number, any[]> = {};

  for (const event of results) {
    if (event.type === "message_start") {
      response = { ...event.message };
    } else if (event.type === "content_block_start") {
      currentBlock = { ...event.content_block };
      currentBlockIndex = "index" in event && typeof event.index === "number" ? event.index : null;
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
    } else if (event.type === "content_block_delta") {
      const delta = event.delta as unknown as Record<string, unknown> | undefined;
      const eventIndex = "index" in event && typeof event.index === "number" ? event.index : null;

      if (delta?.type === "citations_delta") {
        const citation = delta.citation as Record<string, unknown> | undefined;
        if (
          citation &&
          typeof citation === "object" &&
          citation.type === "web_search_result_location" &&
          eventIndex !== null
        ) {
          const annotation = {
            type: "url_citation",
            url: citation.url ?? "",
            title: citation.title ?? "",
            start_index: citation.start_index ?? 0,
            end_index: citation.end_index ?? 0,
            ...(citation.cited_text != null ? { cited_text: citation.cited_text } : {}),
            ...(citation.encrypted_index != null ? { encrypted_index: citation.encrypted_index } : {}),
          };
          if (!citationsByBlockIndex[eventIndex]) citationsByBlockIndex[eventIndex] = [];
          citationsByBlockIndex[eventIndex].push(annotation);
        }
      } else if (currentBlock !== null) {
        if (currentBlock.type === "thinking") {
          if (delta && "signature" in delta) {
            currentSignature = (delta.signature as string) || "";
          }
          if (delta && "thinking" in delta) {
            currentThinking += (delta.thinking as string) || "";
          }
        } else if (currentBlock.type === "text") {
          if (delta && "text" in delta) {
            currentText += (delta.text as string) || "";
          }
        } else if (
          currentBlock.type === "tool_use" ||
          currentBlock.type === "server_tool_use"
        ) {
          if (delta?.type === "input_json_delta") {
            const inputJsonDelta = delta as { partial_json?: string };
            currentToolInputJson += inputJsonDelta.partial_json || "";
          }
        }
      }
    } else if (event.type === "content_block_stop" && currentBlock !== null) {
      if (currentBlock.type === "thinking") {
        currentBlock.signature = currentSignature;
        currentBlock.thinking = currentThinking;
      } else if (currentBlock.type === "text") {
        currentBlock.text = currentText;
        currentBlock.citations = null;
        if (currentBlockIndex !== null && citationsByBlockIndex[currentBlockIndex]?.length) {
          currentBlock.annotations = citationsByBlockIndex[currentBlockIndex];
        }
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
      currentBlockIndex = null;
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
  inlineDataParts: any[],
  executableCodeParts: any[],
  codeExecutionResultParts: any[],
  lastResult: any,
  lastThoughtSignature: string | null,
  lastRegularThoughtSignature: string | null
) => {
  const response = { ...lastResult };
  const finalParts: any[] = [];

  if (thoughtContent) {
    const part: any = { text: thoughtContent, thought: true };
    if (lastThoughtSignature) part.thoughtSignature = lastThoughtSignature;
    finalParts.push(part);
  }

  if (regularContent) {
    const part: any = { text: regularContent, thought: null };
    if (lastRegularThoughtSignature) part.thoughtSignature = lastRegularThoughtSignature;
    finalParts.push(part);
  }

  for (const executableCode of executableCodeParts) {
    finalParts.push({ executableCode });
  }

  for (const codeExecutionResult of codeExecutionResultParts) {
    finalParts.push({ codeExecutionResult });
  }

  for (const inlineData of inlineDataParts) {
    finalParts.push({ inlineData });
  }

  for (const functionCall of functionCalls) {
    finalParts.push({ functionCall });
  }

  if (finalParts.length > 0 && response.candidates?.[0]?.content) {
    response.candidates[0].content.parts = finalParts;
  }

  const lastCandidate = lastResult?.candidates?.[0];
  if (lastCandidate) {
    if (!response.candidates) response.candidates = [];
    if (!response.candidates[0]) response.candidates[0] = { content: { parts: [] } };
    if (lastCandidate.groundingMetadata != null) {
      response.candidates[0].groundingMetadata = lastCandidate.groundingMetadata;
    }
    if (lastCandidate.urlContextMetadata != null) {
      response.candidates[0].urlContextMetadata = lastCandidate.urlContextMetadata;
    }
    if (lastCandidate.citationMetadata != null) {
      response.candidates[0].citationMetadata = lastCandidate.citationMetadata;
    }
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
  const inlineDataParts: any[] = [];
  const executableCodeParts: any[] = [];
  const codeExecutionResultParts: any[] = [];
  let lastThoughtSignature: string | null = null;
  let lastRegularThoughtSignature: string | null = null;

  for (const result of results) {
    if (result.candidates && result.candidates[0]?.content?.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.text != null) {
          if (part.thought === true) {
            thoughtContent += part.text;
            if (part.thoughtSignature) lastThoughtSignature = part.thoughtSignature;
          } else {
            regularContent += part.text;
            if (part.thoughtSignature) lastRegularThoughtSignature = part.thoughtSignature;
          }
        } else if (part.functionCall) {
          functionCalls.push(part.functionCall);
        } else if (part.inlineData) {
          const raw = part.inlineData;
          inlineDataParts.push({
            data: raw.data ?? "",
            mimeType: raw.mimeType ?? "image/png",
          });
        } else if (part.executableCode) {
          executableCodeParts.push({
            code: part.executableCode.code ?? "",
            language: part.executableCode.language,
          });
        } else if (part.codeExecutionResult) {
          codeExecutionResultParts.push({
            output: part.codeExecutionResult.output ?? "",
            outcome: part.codeExecutionResult.outcome ?? "OUTCOME_OK",
          });
        }
      }
    }
  }

  return buildGoogleResponseFromParts(
    thoughtContent,
    regularContent,
    functionCalls,
    inlineDataParts,
    executableCodeParts,
    codeExecutionResultParts,
    results[results.length - 1],
    lastThoughtSignature,
    lastRegularThoughtSignature
  );
};

export const googleStreamChat = (results: any[]) => {
  return googleStreamResponse(results);
};

export const googleStreamCompletion = (results: any[]) => {
  return googleStreamResponse(results);
};

const _RESPONSE_METADATA_KEYS = ["size", "quality", "background", "output_format"] as const;

export const openaiImagesStream = (results: any[]) => {
  const response_data: any = {
    created: null,
    data: [],
    usage: null,
  };

  const partial_images_by_index: Record<number, string> = {};
  let output_format = "png";

  for (const chunk of results as any[]) {
    const event_type = chunk?.type ?? "";

    if (event_type === "image_generation.partial_image") {
      const b64 = chunk.b64_json;
      if (b64 != null) {
        const idx = chunk.partial_image_index ?? 0;
        partial_images_by_index[idx] = b64;
      }
    } else if (event_type === "image_generation.completed") {
      const b64 = chunk.b64_json;
      if (b64 != null) {
        const idx = chunk.partial_image_index ?? 0;
        partial_images_by_index[idx] = b64;
      }
      response_data.created = chunk.created_at ?? response_data.created;
      response_data.usage = chunk.usage ?? response_data.usage;
      for (const key of _RESPONSE_METADATA_KEYS) {
        if (chunk[key] != null) response_data[key] = chunk[key];
      }
      if (chunk.output_format) output_format = chunk.output_format;
    }
  }

  if (!response_data.output_format) {
    response_data.output_format = output_format;
  }

  const indices = Object.keys(partial_images_by_index)
    .map(Number)
    .sort((a, b) => a - b);
  if (indices.length > 0) {
    response_data.data = indices.map((idx) => ({
      b64_json: partial_images_by_index[idx],
    }));
  }

  return response_data;
};

export const cleaned_result = (
  results: any[],
  function_name = "openai.chat.completions.create"
) => {
  if (
    function_name === "openai.responses.create" ||
    function_name === "openai.AzureOpenAI.responses.create"
  ) {
    return openaiResponsesStreamChat(results);
  }

  if (
    function_name === "openai.images.generate" ||
    function_name === "openai.AzureOpenAI.images.generate"
  ) {
    return openaiImagesStream(results);
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


const buildStreamBlueprint = (
  result: any,
  metadata: any,
  streamContext?: { anthropicBlockTypeByIndex?: Record<number, string> }
) => {
  const provider = metadata.model.provider;
  const model = metadata.model.name;

  if (provider === "anthropic" || provider === "anthropic.bedrock" || (provider === "vertexai" && model.startsWith("claude"))) {
    return buildPromptBlueprintFromAnthropicEvent(result, metadata, streamContext?.anthropicBlockTypeByIndex);
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
    if (api_type === "images") {
      return buildPromptBlueprintFromOpenAIImagesEvent(result, metadata);
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
  const isAnthropic = provider === "anthropic" || provider === "anthropic.bedrock" || (provider === "vertexai" && metadata.model?.name?.startsWith?.("claude"));
  const anthropicBlockTypeByIndex: Record<number, string> = {};
  for await (const result of generator) {
    results.push(result);
    if (isAnthropic && result?.type === "content_block_start" && result.content_block) {
      anthropicBlockTypeByIndex[result.index] = result.content_block.type;
    }
    data.raw_response = result;
    data.prompt_blueprint = buildStreamBlueprint(result, metadata, { anthropicBlockTypeByIndex });

    yield data;
  }
  const request_response = mapResults(results);
  if (provider === "amazon.bedrock") {
    request_response.ResponseMetadata = response_metadata;
  }
  data.raw_response = request_response;
  data.prompt_blueprint = buildStreamBlueprint(request_response, metadata);
  yield data;
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
  },
  "openai:images": {
    completion: {
      function_name: "openai.images.generate",
      stream_function: openaiImagesStream,
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
  "openai.azure:images": {
    completion: {
      function_name: "openai.AzureOpenAI.images.generate",
      stream_function: openaiImagesStream,
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
