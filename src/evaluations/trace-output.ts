import { parseCellValue } from "./utils";
import { iterSpansChrono } from "./trace-tree";
import type { Column } from "@/types";

/** Return the last assistant message found in a Trace span tree. */
export const extractLastAssistantMessage = (trace: unknown): unknown | null => {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return null;
  }

  const candidates: unknown[] = [];
  for (const span of iterSpansChrono(trace as Record<string, unknown>)) {
    const message = assistantFromSpan(span);
    if (message !== null && message !== undefined) {
      candidates.push(message);
    }
  }
  return candidates.length ? candidates[candidates.length - 1] : null;
};

/** Use a non-null runner output; otherwise derive the assistant output from Trace. */
export const resolveOutputFromTraceRow = (
  row: Record<string, unknown> | null | undefined,
  columnsByTitleMap: Record<string, Column>,
  fallback: unknown = null
): unknown => {
  if (fallback !== null && fallback !== undefined) {
    return fallback;
  }
  const trace = traceCellValue(row, columnsByTitleMap);
  return extractLastAssistantMessage(trace);
};

const traceCellValue = (
  row: Record<string, unknown> | null | undefined,
  columnsByTitleMap: Record<string, Column>
): unknown => {
  if (!row) return null;
  const column = columnsByTitleMap.Trace;
  if (!column || column.id == null) return null;
  const cells = (row.cells as Record<string, unknown>) || {};
  const cell = cells[String(column.id)];
  return parseCellValue(
    cell && typeof cell === "object" ? (cell as Record<string, unknown>) : null
  );
};

const assistantFromSpan = (span: Record<string, unknown>): unknown | null => {
  const requestLog = span.request_log;
  if (!requestLog || typeof requestLog !== "object" || Array.isArray(requestLog)) {
    return null;
  }
  const log = requestLog as Record<string, unknown>;

  const fromResponse = assistantFromRequestResponse(log.request_response);
  if (fromResponse !== null && fromResponse !== undefined) {
    return fromResponse;
  }

  const kwargs = log.function_kwargs;
  if (kwargs && typeof kwargs === "object" && !Array.isArray(kwargs)) {
    const messages = (kwargs as Record<string, unknown>).messages;
    if (Array.isArray(messages)) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const msg = messages[index];
        if (
          msg &&
          typeof msg === "object" &&
          !Array.isArray(msg) &&
          (msg as Record<string, unknown>).role === "assistant"
        ) {
          return normalizeAssistantMessage(msg as Record<string, unknown>);
        }
      }
    }
  }
  return null;
};

const assistantFromRequestResponse = (response: unknown): unknown | null => {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null;
  }
  const record = response as Record<string, unknown>;

  const choices = record.choices;
  if (Array.isArray(choices) && choices.length) {
    const choice = choices[0];
    if (choice && typeof choice === "object" && !Array.isArray(choice)) {
      const message = (choice as Record<string, unknown>).message;
      if (message && typeof message === "object" && !Array.isArray(message)) {
        const msg = message as Record<string, unknown>;
        const role = msg.role ?? "assistant";
        if (role === "assistant") {
          return normalizeAssistantMessage(msg);
        }
      }
    }
  }

  // Anthropic Messages API. Backend-normalized responses intentionally omit
  // `type` and may omit `stop_reason`, so role + content is the stable shape.
  const role = record.role;
  if (
    (role === undefined || role === null || role === "assistant") &&
    (typeof record.content === "string" || Array.isArray(record.content))
  ) {
    return normalizeAnthropicResponse(record);
  }

  // Legacy Anthropic Completions API.
  if (typeof record.completion === "string") {
    return maybeParseJson(record.completion);
  }

  // Google Gemini / Vertex generate-content.
  const candidates = record.candidates;
  if (Array.isArray(candidates) && candidates.length) {
    const candidate = candidates[0];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const message = normalizeGoogleContent(
        (candidate as Record<string, unknown>).content
      );
      if (message !== null) return message;
    }
  }

  // OpenAI Responses API
  const outputList = record.output;
  if (Array.isArray(outputList)) {
    for (let index = outputList.length - 1; index >= 0; index -= 1) {
      const item = outputList[index];
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      if (
        entry.type === "message" &&
        (entry.role ?? "assistant") === "assistant"
      ) {
        return normalizeResponsesMessage(entry);
      }
      if (entry.type === "function_call") {
        return {
          content: null,
          tool_calls: [
            {
              id: entry.call_id ?? entry.id,
              type: "function",
              function: {
                name: entry.name,
                arguments: entry.arguments,
              },
            },
          ],
        };
      }
    }
  }

  // Amazon Bedrock Converse.
  if (outputList && typeof outputList === "object" && !Array.isArray(outputList)) {
    const message = (outputList as Record<string, unknown>).message;
    const normalized = normalizeBedrockMessage(message);
    if (normalized !== null) return normalized;
  }

  return null;
};

const normalizeAssistantMessage = (message: Record<string, unknown>): unknown => {
  const content = message.content;
  const toolCalls = message.tool_calls;
  const functionCall = message.function_call;
  const text = contentAsText(content);

  if (toolCalls) {
    return {
      content: text !== null && text !== undefined ? text : content,
      tool_calls: toolCalls,
    };
  }
  if (functionCall) {
    return {
      content: text !== null && text !== undefined ? text : content,
      function_call: functionCall,
    };
  }
  return maybeParseJson(text !== null && text !== undefined ? text : content);
};

const normalizeAnthropicResponse = (
  response: Record<string, unknown>
): unknown | null => {
  const content = response.content;
  const textParts: string[] = [];
  const toolCalls: Record<string, unknown>[] = [];

  if (typeof content === "string") {
    return maybeParseJson(content);
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const record = block as Record<string, unknown>;
      const blockType = record.type;
      if (blockType === "text" && typeof record.text === "string") {
        textParts.push(record.text);
      } else if (blockType === "tool_use") {
        toolCalls.push({
          id: record.id,
          type: "function",
          function: {
            name: record.name,
            arguments: JSON.stringify(record.input ?? {}),
          },
        });
      }
    }
  }

  const text = textParts.length ? textParts.join("\n") : null;
  if (toolCalls.length) {
    return { content: text, tool_calls: toolCalls };
  }
  if (text !== null) {
    return maybeParseJson(text);
  }
  return null;
};

const normalizeGoogleContent = (content: unknown): unknown | null => {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return null;
  }
  const contentRecord = content as Record<string, unknown>;
  if (contentRecord.role !== "model") return null;
  const parts = contentRecord.parts;
  if (!Array.isArray(parts)) return null;

  const textParts: string[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string" && !record.thought) {
      textParts.push(record.text);
    }
    const functionCall = record.function_call;
    if (
      functionCall &&
      typeof functionCall === "object" &&
      !Array.isArray(functionCall)
    ) {
      const call = functionCall as Record<string, unknown>;
      const args = call.args ?? {};
      toolCalls.push({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: typeof args === "string" ? args : JSON.stringify(args),
        },
      });
    }
  }

  const text = textParts.length ? textParts.join("\n") : null;
  if (toolCalls.length) return { content: text, tool_calls: toolCalls };
  return text !== null ? maybeParseJson(text) : null;
};

const normalizeBedrockMessage = (message: unknown): unknown | null => {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const record = message as Record<string, unknown>;
  if ((record.role ?? "assistant") !== "assistant" || !Array.isArray(record.content)) {
    return null;
  }

  const textParts: string[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  for (const block of record.content) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const entry = block as Record<string, unknown>;
    if (typeof entry.text === "string") textParts.push(entry.text);
    const toolUse = entry.toolUse;
    if (toolUse && typeof toolUse === "object" && !Array.isArray(toolUse)) {
      const tool = toolUse as Record<string, unknown>;
      toolCalls.push({
        id: tool.toolUseId,
        type: "function",
        function: {
          name: tool.name,
          arguments: JSON.stringify(tool.input ?? {}),
        },
      });
    }
  }

  const text = textParts.length ? textParts.join("\n") : null;
  if (toolCalls.length) return { content: text, tool_calls: toolCalls };
  return text !== null ? maybeParseJson(text) : null;
};

const normalizeResponsesMessage = (
  item: Record<string, unknown>
): unknown | null => {
  const content = item.content;
  const textParts: string[] = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      const record = block as Record<string, unknown>;
      if (
        (record.type === "output_text" || record.type === "text") &&
        typeof record.text === "string"
      ) {
        textParts.push(record.text);
      }
    }
  } else if (typeof content === "string") {
    textParts.push(content);
  }
  const text = textParts.length ? textParts.join("\n") : null;
  return text !== null ? maybeParseJson(text) : null;
};

const contentAsText = (content: unknown): string | null => {
  if (content === null || content === undefined) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
      } else if (block && typeof block === "object" && !Array.isArray(block)) {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.length ? parts.join("\n") : null;
  }
  return null;
};

const maybeParseJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const stripped = value.trim();
  if (!stripped || (stripped[0] !== "{" && stripped[0] !== "[")) {
    return value;
  }
  try {
    return JSON.parse(stripped);
  } catch {
    return value;
  }
};
