import type { Span } from "@opentelemetry/api";
import type {
  AwsSdkInstrumentationConfig,
  NormalizedRequest,
  NormalizedResponse,
} from "@opentelemetry/instrumentation-aws-sdk";
import { Buffer } from "node:buffer";

export const AWS_SDK_INSTRUMENTATION_SCOPE =
  "@opentelemetry/instrumentation-aws-sdk";

const isBedrockConverse = (request: NormalizedRequest): boolean =>
  request.serviceName === "BedrockRuntime" &&
  request.commandName === "Converse";

const isRecord = (
  value: unknown
): value is Record<string, any> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value);

const jsonSafe = (value: any): any => {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        jsonSafe(item),
      ])
    );
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    return value;
  }
  return String(value);
};

const normalizePart = (
  block: any
): Record<string, any> | null => {
  if (typeof block === "string") {
    return { type: "text", content: block };
  }
  if (block instanceof Uint8Array) {
    return { type: "generic", value: jsonSafe(block) };
  }
  if (!isRecord(block)) return null;
  if ("text" in block) {
    return { type: "text", content: String(block.text) };
  }
  if (isRecord(block.toolUse)) {
    return {
      type: "tool_call",
      id: block.toolUse.toolUseId ?? null,
      name: block.toolUse.name ?? "",
      arguments: jsonSafe(block.toolUse.input),
    };
  }
  if (isRecord(block.toolResult)) {
    return {
      type: "tool_call_response",
      id: block.toolResult.toolUseId ?? null,
      response: jsonSafe(block.toolResult.content),
    };
  }
  const reasoningText = block.reasoningContent?.reasoningText;
  if (isRecord(reasoningText) && reasoningText.text != null) {
    return {
      type: "reasoning",
      content: String(reasoningText.text),
    };
  }
  return { type: "generic", value: jsonSafe(block) };
};

const normalizeParts = (content: any): Array<Record<string, any>> => {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.flatMap((block) => {
    const part = normalizePart(block);
    return part ? [part] : [];
  });
};

const normalizeMessage = (
  message: any,
  defaultRole?: string
): Record<string, any> | null => {
  if (!isRecord(message)) return null;
  const role = message.role || defaultRole;
  const parts = normalizeParts(message.content);
  return role && parts.length > 0
    ? { role: String(role), parts }
    : null;
};

const setJsonAttribute = (
  span: Span,
  name: string,
  value: any
): void => {
  span.setAttribute(name, JSON.stringify(value));
};

const captureRequest = (
  span: Span,
  request: NormalizedRequest,
  captureContent: boolean
): void => {
  if (!isBedrockConverse(request)) return;
  try {
    span.setAttribute("gen_ai.provider.name", "aws.bedrock");
    span.setAttribute(
      "promptlayer.provider.type",
      "amazon.bedrock"
    );
    span.setAttribute("promptlayer.api.type", "converse");
    span.setAttribute("node_type", "LLM_CALL");
    if (!captureContent || !span.isRecording()) return;

    const messages = Array.isArray(request.commandInput.messages)
      ? request.commandInput.messages.flatMap((message) => {
          const normalized = normalizeMessage(message);
          return normalized ? [normalized] : [];
        })
      : [];
    if (messages.length > 0) {
      setJsonAttribute(span, "gen_ai.input.messages", messages);
    }
    const system = normalizeParts(request.commandInput.system);
    if (system.length > 0) {
      setJsonAttribute(span, "gen_ai.system_instructions", system);
    }
  } catch {
    // Provider instrumentation must never affect the AWS request.
  }
};

const captureResponse = (
  span: Span,
  response: NormalizedResponse,
  captureContent: boolean
): void => {
  if (
    !captureContent ||
    !isBedrockConverse(response.request) ||
    !span.isRecording()
  ) {
    return;
  }
  try {
    const message = normalizeMessage(
      response.data?.output?.message,
      "assistant"
    );
    if (!message) return;
    if (response.data?.stopReason != null) {
      message.finish_reason = String(response.data.stopReason);
    }
    setJsonAttribute(span, "gen_ai.output.messages", [message]);
  } catch {
    // Provider instrumentation must never affect the AWS response.
  }
};

export const createBedrockInstrumentationConfig = (
  captureContent: boolean
): AwsSdkInstrumentationConfig => ({
  preRequestHook: (span, { request }) =>
    captureRequest(span, request, captureContent),
  responseHook: (span, { response }) =>
    captureResponse(span, response, captureContent),
});
