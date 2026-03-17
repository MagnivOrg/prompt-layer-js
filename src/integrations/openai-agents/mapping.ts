import { SDK_VERSION } from "@/utils/utils";
import type {
  Span as AgentsSpan,
  SpanData,
  Trace as AgentsTrace,
} from "@openai/agents";
import type { AttributeValue } from "@/integrations/openai-agents/types";

const SPAN_KIND_INTERNAL = 1;
const SPAN_KIND_CLIENT = 3;

type AttributeMap = Record<string, AttributeValue>;
type NormalizedMessage = Record<string, AttributeValue>;
type NormalizedToolCall = {
  id: string;
  type: "tool_call";
  name: string;
  arguments: AttributeValue;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isScalar = (value: unknown): value is string | number | boolean => {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
};

const sanitizeKey = (key: string): string => {
  return key.replace(/[^a-zA-Z0-9_.-]/g, "_");
};

const toJsonable = (value: unknown): AttributeValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonable(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonable(item)])
    );
  }

  return String(value);
};

const stableStringify = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => normalize(item));
    }

    if (isPlainObject(input)) {
      return Object.keys(input)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = normalize(input[key]);
          return acc;
        }, {});
    }

    return input;
  };

  return JSON.stringify(normalize(toJsonable(value)));
};

const setStringAttr = (attrs: AttributeMap, key: string, value: unknown) => {
  if (value !== undefined && value !== null && value !== "") {
    attrs[key] = String(value);
  }
};

const setNumberAttr = (attrs: AttributeMap, key: string, value: unknown) => {
  if (value !== undefined && value !== null && value !== "") {
    const numericValue = Number(value);
    if (!Number.isNaN(numericValue)) {
      attrs[key] = numericValue;
    }
  }
};

const setJsonAttr = (
  attrs: AttributeMap,
  key: string,
  value: unknown,
  includeRawPayloads: boolean
) => {
  if (includeRawPayloads && value !== undefined && value !== null) {
    attrs[key] = stableStringify(value);
  }
};

const flattenIndexedMessages = (
  prefix: string,
  messages: NormalizedMessage[],
  attrs: AttributeMap
) => {
  messages.forEach((message, index) => {
    Object.entries(message).forEach(([key, value]) => {
      attrs[`${prefix}.${index}.${key}`] = isScalar(value)
        ? value
        : stableStringify(value);
    });
  });
};

const normalizeToolCalls = (toolCalls: unknown): NormalizedToolCall[] => {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((call) => {
      if (!isPlainObject(call)) {
        return null;
      }

      const functionData = isPlainObject(call.function) ? call.function : null;
      const name = functionData?.name ?? call.name ?? "tool";
      let argumentsValue =
        functionData?.arguments ?? call.arguments ?? {};

      if (typeof argumentsValue === "string") {
        try {
          argumentsValue = JSON.parse(argumentsValue);
        } catch {
          argumentsValue = argumentsValue;
        }
      }

      return {
        id: String(call.id ?? ""),
        type: "tool_call",
        name: String(name),
        arguments: toJsonable(argumentsValue),
      };
    })
    .filter((call): call is NormalizedToolCall => call !== null);
};

const getCallId = (item: Record<string, unknown>): string | undefined => {
  const value = item.call_id ?? item.callId ?? item.id;
  return value !== undefined && value !== null ? String(value) : undefined;
};

const normalizeToolOutputContent = (output: unknown): string | undefined => {
  if (output === undefined || output === null) {
    return undefined;
  }

  if (typeof output === "string") {
    return output;
  }

  if (Array.isArray(output)) {
    const textContent = extractTextContent(output);
    return textContent ?? stableStringify(output);
  }

  if (isPlainObject(output)) {
    const textContent = extractTextContent([output]);
    return textContent ?? stableStringify(output);
  }

  const textContent = extractTextContent(output);
  if (textContent !== undefined) {
    return textContent;
  }

  return stableStringify(output);
};

const normalizeToolCallMessage = (
  item: Record<string, unknown>
): NormalizedMessage | null => {
  let argumentsValue = item.arguments ?? {};
  if (typeof argumentsValue === "string") {
    try {
      argumentsValue = JSON.parse(argumentsValue);
    } catch {
      argumentsValue = argumentsValue;
    }
  }

  return {
    role: "assistant",
    tool_calls: [
      {
        id: getCallId(item) ?? "",
        type: "tool_call",
        name: String(item.name ?? "tool"),
        arguments: toJsonable(argumentsValue),
      },
    ],
  };
};

const normalizeToolResultMessage = (
  item: Record<string, unknown>,
  outputOverride?: unknown
): NormalizedMessage | null => {
  const toolCallId = getCallId(item);
  const content = normalizeToolOutputContent(
    outputOverride ?? item.output ?? item.content
  );

  if (!toolCallId && !content) {
    return null;
  }

  const message: NormalizedMessage = {
    role: "tool",
  };

  if (toolCallId) {
    message.tool_call_id = toolCallId;
  }

  if (content !== undefined) {
    message.content = content;
  }

  return message;
};

function extractTextContent(content: unknown): string | undefined {
  if (content === undefined || content === null) {
    return undefined;
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (!isPlainObject(part)) {
          return null;
        }

        const partType = part.type;
        if (
          partType === "text" ||
          partType === "input_text" ||
          partType === "output_text"
        ) {
          const text = part.text ?? part.content;
          return text !== undefined && text !== null ? String(text) : null;
        }

        return null;
      })
      .filter((part): part is string => part !== null);

    return textParts.length > 0 ? textParts.join("\n") : undefined;
  }

  return String(content);
}

export const normalizeMessages = (items: unknown): NormalizedMessage[] => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (!isPlainObject(item)) {
        return null;
      }

      const normalized: NormalizedMessage = {};
      if (item.role !== undefined) {
        normalized.role = String(item.role);
      }

      const content = extractTextContent(item.content);
      if (content) {
        normalized.content = content;
      }

      const toolCalls = normalizeToolCalls(item.tool_calls);
      if (toolCalls.length > 0) {
        normalized.tool_calls = toolCalls;
      }

      if (item.tool_call_id) {
        normalized.tool_call_id = String(item.tool_call_id);
      }

      return Object.keys(normalized).length > 0 ? normalized : null;
    })
    .filter((message): message is NormalizedMessage => message !== null);
};

const normalizeResponseMessage = (
  item: Record<string, unknown>
): NormalizedMessage | null => {
  const message: NormalizedMessage = {};
  const role = item.role;
  const content = extractTextContent(item.content);
  const toolCalls = normalizeToolCalls(item.tool_calls);

  if (role !== undefined && role !== null) {
    message.role = String(role);
  } else if (content || toolCalls.length > 0) {
    message.role = "assistant";
  }

  if (content) {
    message.content = content;
  }

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  if (item.tool_call_id) {
    message.tool_call_id = String(item.tool_call_id);
  }

  return Object.keys(message).length > 0 ? message : null;
};

const RAW_TOOL_CALL_ITEM_TYPES = new Set([
  "function_call",
  "computer_call",
  "shell_call",
  "apply_patch_call",
  "custom_tool_call",
  "mcp_call",
]);

const RAW_TOOL_RESULT_ITEM_TYPES = new Set([
  "function_call_output",
  "function_call_result",
  "computer_call_output",
  "computer_call_result",
  "shell_call_output",
  "apply_patch_call_output",
  "custom_tool_call_output",
]);

export const normalizeResponseItems = (items: unknown): NormalizedMessage[] => {
  if (typeof items === "string") {
    return [{ role: "user", content: items }];
  }

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .flatMap((item) => {
      if (!isPlainObject(item)) {
        return [];
      }

      if (item.type === "message_output_item" && isPlainObject(item.rawItem)) {
        const message = normalizeResponseMessage(item.rawItem);
        return message ? [message] : [];
      }

      if (item.type === "tool_call_item" && isPlainObject(item.rawItem)) {
        const message = normalizeToolCallMessage(item.rawItem);
        return message ? [message] : [];
      }

      if (item.type === "tool_call_output_item" && isPlainObject(item.rawItem)) {
        const message = normalizeToolResultMessage(item.rawItem, item.output);
        return message ? [message] : [];
      }

      if (typeof item.type === "string" && RAW_TOOL_CALL_ITEM_TYPES.has(item.type)) {
        const message = normalizeToolCallMessage(item);
        return message ? [message] : [];
      }

      if (
        typeof item.type === "string" &&
        RAW_TOOL_RESULT_ITEM_TYPES.has(item.type)
      ) {
        const message = normalizeToolResultMessage(item);
        return message ? [message] : [];
      }

      const message = normalizeResponseMessage(item);
      return message ? [message] : [];
    })
    .filter((message): message is NormalizedMessage => message !== null);
};

const applyUsageAttributes = (attrs: AttributeMap, usage: unknown) => {
  if (!isPlainObject(usage)) {
    return;
  }

  setNumberAttr(
    attrs,
    "gen_ai.usage.input_tokens",
    usage.input_tokens ?? usage.prompt_tokens
  );
  setNumberAttr(
    attrs,
    "gen_ai.usage.output_tokens",
    usage.output_tokens ?? usage.completion_tokens
  );
};

const generationAttributes = (
  spanData: Extract<SpanData, { type: "generation" }>,
  includeRawPayloads: boolean
): AttributeMap => {
  const attrs: AttributeMap = {
    "gen_ai.provider.name": "openai.responses",
  };

  setStringAttr(attrs, "gen_ai.request.model", spanData.model);
  applyUsageAttributes(attrs, spanData.usage);
  flattenIndexedMessages("gen_ai.prompt", normalizeMessages(spanData.input), attrs);
  flattenIndexedMessages(
    "gen_ai.completion",
    normalizeMessages(spanData.output),
    attrs
  );
  setJsonAttr(
    attrs,
    "openai_agents.model_config_json",
    spanData.model_config,
    includeRawPayloads
  );
  setJsonAttr(
    attrs,
    "openai_agents.generation.raw_input_json",
    spanData.input,
    includeRawPayloads
  );
  setJsonAttr(
    attrs,
    "openai_agents.generation.raw_output_json",
    spanData.output,
    includeRawPayloads
  );

  return attrs;
};

const responseAttributes = (
  spanData: Extract<SpanData, { type: "response" }>,
  includeRawPayloads: boolean
): AttributeMap => {
  const attrs: AttributeMap = {
    "gen_ai.provider.name": "openai.responses",
  };
  const responseObject = isPlainObject(spanData._response) ? spanData._response : {};
  const usage =
    isPlainObject(responseObject.usage) ? responseObject.usage : undefined;

  setStringAttr(
    attrs,
    "gen_ai.request.model",
    responseObject.model
  );
  setStringAttr(
    attrs,
    "gen_ai.response.model",
    responseObject.model
  );
  setStringAttr(
    attrs,
    "gen_ai.response.id",
    spanData.response_id ?? responseObject.id ?? responseObject.response_id
  );
  applyUsageAttributes(attrs, usage);
  flattenIndexedMessages(
    "gen_ai.prompt",
    normalizeResponseItems(spanData._input ?? responseObject.input),
    attrs
  );
  flattenIndexedMessages(
    "gen_ai.completion",
    normalizeResponseItems(responseObject.output),
    attrs
  );
  setJsonAttr(
    attrs,
    "openai_agents.response.raw_json",
    responseObject,
    includeRawPayloads
  );
  setStringAttr(
    attrs,
    "openai_agents.response.object",
    responseObject.object
  );

  return attrs;
};

const functionAttributes = (
  spanData: Extract<SpanData, { type: "function" }>,
  includeRawPayloads: boolean
): AttributeMap => {
  const attrs: AttributeMap = {
    node_type: "CODE_EXECUTION",
    tool_name: spanData.name,
    "openai_agents.function.name": spanData.name,
  };

  setStringAttr(attrs, "function_input", spanData.input);
  setStringAttr(attrs, "function_output", spanData.output);
  setStringAttr(attrs, "openai_agents.function.input", spanData.input);
  setStringAttr(attrs, "openai_agents.function.output", spanData.output);
  setJsonAttr(
    attrs,
    "openai_agents.function.mcp_data_json",
    spanData.mcp_data,
    includeRawPayloads
  );

  return attrs;
};

const agentAttributes = (
  spanData: Extract<SpanData, { type: "agent" }>,
  includeRawPayloads: boolean
): AttributeMap => {
  const attrs: AttributeMap = {
    "openai_agents.agent.name": spanData.name,
  };

  setStringAttr(attrs, "openai_agents.agent.output_type", spanData.output_type);
  setJsonAttr(
    attrs,
    "openai_agents.agent.handoffs_json",
    spanData.handoffs,
    includeRawPayloads
  );
  setJsonAttr(
    attrs,
    "openai_agents.agent.tools_json",
    spanData.tools,
    includeRawPayloads
  );

  return attrs;
};

const handoffAttributes = (
  spanData: Extract<SpanData, { type: "handoff" }>
): AttributeMap => {
  const attrs: AttributeMap = {};
  setStringAttr(attrs, "openai_agents.handoff.from_agent", spanData.from_agent);
  setStringAttr(attrs, "openai_agents.handoff.to_agent", spanData.to_agent);
  return attrs;
};

const guardrailAttributes = (
  spanData: Extract<SpanData, { type: "guardrail" }>
): AttributeMap => {
  return {
    "openai_agents.guardrail.name": spanData.name,
    "openai_agents.guardrail.triggered": spanData.triggered,
  };
};

const customAttributes = (
  spanData: Extract<SpanData, { type: "custom" }>,
  includeRawPayloads: boolean
): AttributeMap => {
  const attrs: AttributeMap = {
    "openai_agents.custom.name": spanData.name,
  };
  setJsonAttr(
    attrs,
    "openai_agents.custom.data_json",
    spanData.data,
    includeRawPayloads
  );
  return attrs;
};

const rawSpanDataAttributes = (
  spanData: SpanData,
  includeRawPayloads: boolean
): AttributeMap => {
  if (!includeRawPayloads) {
    return {};
  }

  return {
    "openai_agents.raw_json": stableStringify(spanData),
  };
};

export const telemetrySourceVersion = (): string => {
  return SDK_VERSION;
};

export const spanKindFor = (span: Pick<AgentsSpan<any>, "spanData">): number => {
  return span.spanData.type === "generation" || span.spanData.type === "response"
    ? SPAN_KIND_CLIENT
    : SPAN_KIND_INTERNAL;
};

export const spanNameFor = (span: Pick<AgentsSpan<any>, "spanData">): string => {
  switch (span.spanData.type) {
    case "function":
      return `Function: ${span.spanData.name}`;
    case "agent":
      return `Agent: ${span.spanData.name}`;
    case "guardrail":
      return `Guardrail: ${span.spanData.name}`;
    case "custom":
      return String(span.spanData.name);
    default:
      return span.spanData.type
        .split("_")
        .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
};

export const baseTraceAttributes = (
  trace: Pick<AgentsTrace, "traceId" | "name" | "groupId" | "metadata">,
  includeRawPayloads: boolean
): AttributeMap => {
  const attrs: AttributeMap = {
    "promptlayer.telemetry.source": "openai-agents-js",
    "promptlayer.telemetry.source_version": telemetrySourceVersion(),
    "openai_agents.trace_id_original": trace.traceId,
    "openai_agents.workflow_name": trace.name,
  };

  if (trace.groupId) {
    attrs["openai_agents.group_id"] = trace.groupId;
  }

  if (isPlainObject(trace.metadata)) {
    Object.entries(trace.metadata).forEach(([key, value]) => {
      if (isScalar(value)) {
        attrs[`openai_agents.metadata.${sanitizeKey(key)}`] = value;
      }
    });
    setJsonAttr(
      attrs,
      "openai_agents.metadata_json",
      trace.metadata,
      includeRawPayloads
    );
  }

  return attrs;
};

export const baseSpanAttributes = (
  span: Pick<AgentsSpan<any>, "spanId" | "parentId" | "spanData">
): AttributeMap => {
  const attrs: AttributeMap = {
    "promptlayer.telemetry.source": "openai-agents-js",
    "promptlayer.telemetry.source_version": telemetrySourceVersion(),
    "openai_agents.span_id_original": span.spanId,
    "openai_agents.span_type": span.spanData.type,
  };

  if (span.parentId) {
    attrs["openai_agents.parent_id_original"] = span.parentId;
  }

  return attrs;
};

export const spanDataAttributes = (
  spanData: SpanData,
  includeRawPayloads: boolean
): AttributeMap => {
  switch (spanData.type) {
    case "generation":
      return generationAttributes(spanData, includeRawPayloads);
    case "response":
      return responseAttributes(spanData, includeRawPayloads);
    case "function":
      return functionAttributes(spanData, includeRawPayloads);
    case "agent":
      return agentAttributes(spanData, includeRawPayloads);
    case "handoff":
      return handoffAttributes(spanData);
    case "guardrail":
      return guardrailAttributes(spanData);
    case "custom":
      return customAttributes(spanData, includeRawPayloads);
    default:
      return rawSpanDataAttributes(spanData, includeRawPayloads);
  }
};

export const OTLP_STATUS_CODE_UNSET = 0;
export const OTLP_STATUS_CODE_OK = 1;
export const OTLP_STATUS_CODE_ERROR = 2;
