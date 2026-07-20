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

/** Prefer Trace-derived last assistant message; else `fallback`. */
export const resolveOutputFromTraceRow = (
  row: Record<string, unknown> | null | undefined,
  columnsByTitleMap: Record<string, Column>,
  fallback: unknown = null
): unknown => {
  const trace = traceCellValue(row, columnsByTitleMap);
  const derived = extractLastAssistantMessage(trace);
  return derived === null ? fallback : derived;
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

  // Anthropic Messages API
  if (record.type === "message" || "stop_reason" in record) {
    const role = record.role;
    if (role === undefined || role === null || role === "assistant") {
      return normalizeAnthropicResponse(record);
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
