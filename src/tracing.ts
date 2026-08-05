import * as opentelemetry from "@opentelemetry/api";
import {
  logs,
  type LoggerProvider as ApiLoggerProvider,
} from "@opentelemetry/api-logs";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { AwsInstrumentation } from "@opentelemetry/instrumentation-aws-sdk";
import { OpenAIInstrumentation } from "@opentelemetry/instrumentation-openai";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
import { AnthropicInstrumentation } from "@traceloop/instrumentation-anthropic";
import { GenAIInstrumentation as GoogleGenAIInstrumentation } from "@traceloop/instrumentation-google-generativeai";
import {
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  createOpenAILoggerProviders,
  OpenAIMessageContentBridge,
} from "@/openai-message-content";
import {
  AWS_SDK_INSTRUMENTATION_SCOPE,
  createBedrockInstrumentationConfig,
} from "@/instrumentation/bedrock";
import {
  AnthropicProviderContextInstrumentation,
  ANTHROPIC_INSTRUMENTATION_SCOPE,
  createProviderAwareTracerProvider,
  GoogleProviderContextInstrumentation,
  GOOGLE_GENAI_INSTRUMENTATION_SCOPE,
} from "@/instrumentation/provider-context";
import { resolveActiveTracer } from "@/tracing-context";
import { getCommonHeaders } from "@/utils/utils";

export type TracingProvider = "openai" | "anthropic" | "google" | "bedrock";
/** @deprecated Use TracingProvider. */
export type OpenAITracingProvider = "openai";

export {
  ANTHROPIC_INSTRUMENTATION_SCOPE,
  AWS_SDK_INSTRUMENTATION_SCOPE,
  GOOGLE_GENAI_INSTRUMENTATION_SCOPE,
};

export interface FlushableTracerProvider
  extends opentelemetry.TracerProvider {
  forceFlush?: () => Promise<boolean | void>;
  shutdown?: () => Promise<void>;
}

export interface ConfigureTracingOptions {
  apiKey?: string;
  baseURL?: string;
  captureContent?: boolean;
  loggerProvider?: ApiLoggerProvider;
  providers?: readonly TracingProvider[];
  serviceName?: string;
  tracerProvider?: FlushableTracerProvider;
}

export interface TracingHandle {
  readonly ownsTracerProvider: boolean;
  readonly tracerProvider: FlushableTracerProvider;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface PromptLayerProviderRequestContext {
  promptAttributes: opentelemetry.Attributes;
  requestLogSpanId: string;
}

export interface PromptLayerSpanProcessorOptions {
  apiKey?: string;
  baseURL?: string;
  exporter?: SpanExporter;
}

type ActiveTracingState = {
  cleanupInstrumentations: () => void;
  handle: TracingHandle;
  instrumentations: {
    anthropic: AnthropicInstrumentation | null;
    bedrock: AwsInstrumentation | null;
    google: GoogleGenAIInstrumentation | null;
    openai: OpenAIInstrumentation | null;
  };
  messageContentBridge: OpenAIMessageContentBridge;
  promptLayerLoggerProvider: LoggerProvider;
  provider: FlushableTracerProvider;
  shutdownPromise: Promise<void> | null;
};

const OPENAI_INSTRUMENTATION_SCOPE =
  "@opentelemetry/instrumentation-openai";
const PROVIDER_INSTRUMENTATION_SCOPES = new Set([
  OPENAI_INSTRUMENTATION_SCOPE,
  ANTHROPIC_INSTRUMENTATION_SCOPE,
  AWS_SDK_INSTRUMENTATION_SCOPE,
  GOOGLE_GENAI_INSTRUMENTATION_SCOPE,
]);
const PROVIDER_REQUEST_CONTEXT_KEY = opentelemetry.createContextKey(
  "promptlayer.provider_request"
);
const providerRequestContexts = new WeakMap<
  object,
  PromptLayerProviderRequestContext
>();
const openAIMessageContentBridge =
  new OpenAIMessageContentBridge();

let activeTracingState: ActiveTracingState | null = null;

const getProviderRequestContext = (
  context: opentelemetry.Context
): PromptLayerProviderRequestContext | undefined =>
  context.getValue(PROVIDER_REQUEST_CONTEXT_KEY) as
    | PromptLayerProviderRequestContext
    | undefined;

export const withPromptLayerProviderRequestContext = <T>(
  value: PromptLayerProviderRequestContext,
  callback: () => T
): T => {
  let callbackStarted = false;
  let callbackReturned = false;
  let result: T;

  try {
    const providerContext = opentelemetry.context
      .active()
      .setValue(PROVIDER_REQUEST_CONTEXT_KEY, value);
    return opentelemetry.context.with(providerContext, () => {
      callbackStarted = true;
      result = callback();
      callbackReturned = true;
      return result;
    });
  } catch (error) {
    if (!callbackStarted) {
      return callback();
    }
    if (callbackReturned) {
      return result!;
    }
    throw error;
  }
};

/** @deprecated Use withPromptLayerProviderRequestContext. */
export const withPromptLayerOpenAIRequestContext =
  withPromptLayerProviderRequestContext;

const addPromptLayerAttributes = (
  span: ReadableSpan
): ReadableSpan => {
  if (
    !PROVIDER_INSTRUMENTATION_SCOPES.has(
      span.instrumentationScope.name
    )
  ) {
    return span;
  }
  if (
    span.instrumentationScope.name ===
      AWS_SDK_INSTRUMENTATION_SCOPE &&
    ((span.attributes["gen_ai.system"] !== "aws.bedrock" &&
      span.attributes["gen_ai.provider.name"] !== "aws.bedrock") ||
      span.attributes["rpc.method"] !== "Converse")
  ) {
    return span;
  }

  const requestContext = providerRequestContexts.get(span);
  const messageContent =
    span.instrumentationScope.name ===
    OPENAI_INSTRUMENTATION_SCOPE
      ? openAIMessageContentBridge.takeSpanAttributes(span)
      : {};
  if (
    !requestContext &&
    Object.keys(messageContent).length === 0
  ) {
    return span;
  }

  const attributes: opentelemetry.Attributes = {
    ...span.attributes,
    ...messageContent,
  };
  if (requestContext) {
    Object.assign(attributes, requestContext.promptAttributes, {
      node_type: "LLM_CALL",
      "promptlayer.request_log.managed": true,
      "promptlayer.request_log.span_id":
        requestContext.requestLogSpanId,
    });
  }

  return new Proxy(span, {
    get(target, property) {
      if (property === "attributes") return attributes;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

class PromptLayerSpanProcessor implements SpanProcessor {
  private readonly processor: SimpleSpanProcessor;

  constructor(exporter: SpanExporter) {
    this.processor = new SimpleSpanProcessor(exporter);
  }

  onStart(
    ...args: Parameters<SpanProcessor["onStart"]>
  ): void {
    try {
      const [span, parentContext] = args;
      const requestContext =
        getProviderRequestContext(parentContext);
      if (requestContext) {
        providerRequestContexts.set(span, requestContext);
      }
      this.processor.onStart(...args);
    } catch {
      // Telemetry must never change provider SDK behavior.
    }
  }

  onEnd(span: ReadableSpan): void {
    try {
      this.processor.onEnd(addPromptLayerAttributes(span));
    } catch {
      // Telemetry must never change provider SDK behavior.
    } finally {
      providerRequestContexts.delete(span);
    }
  }

  forceFlush(): Promise<void> {
    return this.processor.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.processor.shutdown();
  }
}

export const getTracer = (name: string = "promptlayer-tracer") => {
  const fallback =
    activeTracingState?.provider.getTracer(name) ??
    opentelemetry.trace.getTracer(name);
  return resolveActiveTracer(fallback);
};

export const resolveOtlpTracesEndpoint = (baseURL: string): string => {
  const envEndpoint = process.env.PROMPTLAYER_OTLP_TRACES_ENDPOINT?.trim();
  if (envEndpoint) {
    return envEndpoint;
  }
  return `${baseURL.replace(/\/$/, "")}/v1/traces`;
};

export const createPromptLayerSpanProcessor = ({
  apiKey,
  baseURL = "https://api.promptlayer.com",
  exporter,
}: PromptLayerSpanProcessorOptions): SpanProcessor => {
  if (!exporter && !apiKey) {
    throw new Error(
      "PromptLayer tracing requires an API key to create its OTLP exporter."
    );
  }
  const resolvedExporter =
    exporter ??
    new OTLPTraceExporter({
      url: resolveOtlpTracesEndpoint(baseURL),
      headers: {
        "X-API-KEY": apiKey ?? "",
        ...getCommonHeaders(),
      },
    });
  return new PromptLayerSpanProcessor(resolvedExporter);
};

const createTracerProvider = (
  apiKey: string,
  baseURL: string,
  serviceName: string
): NodeTracerProvider => {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
    }),
    spanProcessors: [
      createPromptLayerSpanProcessor({ apiKey, baseURL }),
    ],
  });
  provider.register();
  return provider;
};

export const resolveCaptureContent = (
  configured?: boolean
): boolean => {
  if (configured !== undefined) return configured;
  const value = process.env
    .OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
  if (value === undefined) return false;
  return [
    "1",
    "true",
    "yes",
    "on",
    "span",
    "span_and_event",
  ].includes(value.trim().toLowerCase());
};

const forceFlushProvider = async (
  provider: FlushableTracerProvider
): Promise<void> => {
  const result = await provider.forceFlush?.();
  if (result === false) {
    throw new Error("Tracer provider did not flush before the deadline.");
  }
};

/**
 * Configure provider auto-instrumentation and OTLP export to PromptLayer.
 *
 * Prefer this over inspecting bundled internals when enabling tracing.
 *
 * @see https://docs.promptlayer.com/features/observability/traces/auto-instrumentation/overview
 */
export const configureTracing = (
  options: ConfigureTracingOptions = {}
): TracingHandle => {
  const requestedProvider = options.tracerProvider;
  const captureContent = resolveCaptureContent(
    options.captureContent
  );

  if (activeTracingState) {
    if (
      requestedProvider &&
      requestedProvider !== activeTracingState.provider
    ) {
      throw new Error(
        "PromptLayer tracing is already configured with a different tracer provider."
      );
    }
    if (options.captureContent !== undefined) {
      activeTracingState.messageContentBridge.setCaptureContent(
        captureContent
      );
      activeTracingState.instrumentations.openai?.setConfig({
        captureMessageContent: captureContent,
      });
      activeTracingState.instrumentations.anthropic?.setConfig({
        traceContent: captureContent,
      });
      activeTracingState.instrumentations.bedrock?.setConfig(
        createBedrockInstrumentationConfig(captureContent)
      );
      activeTracingState.instrumentations.google?.setConfig({
        traceContent: captureContent,
      });
    }
    return activeTracingState.handle;
  }

  const ownsTracerProvider = requestedProvider === undefined;
  let tracerProvider: FlushableTracerProvider;
  if (requestedProvider) {
    tracerProvider = requestedProvider;
  } else {
    const apiKey =
      options.apiKey ?? process.env.PROMPTLAYER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "PromptLayer tracing requires an API key. Set PROMPTLAYER_API_KEY or pass apiKey."
      );
    }
    const baseURL =
      options.baseURL ??
      process.env.PROMPTLAYER_BASE_URL ??
      "https://api.promptlayer.com";
    tracerProvider = createTracerProvider(
      apiKey,
      baseURL,
      options.serviceName ?? "prompt-layer-js"
    );
  }

  const providers =
    options.providers ??
    (["openai", "anthropic", "google", "bedrock"] as const);
  const instrumentations = {
    anthropic: providers.includes("anthropic")
      ? new AnthropicInstrumentation({
          enabled: false,
          exceptionLogger: () => undefined,
          traceContent: captureContent,
        })
      : null,
    bedrock: providers.includes("bedrock")
      ? new AwsInstrumentation(
          createBedrockInstrumentationConfig(captureContent)
        )
      : null,
    google: providers.includes("google")
      ? new GoogleGenAIInstrumentation({
          enabled: false,
          exceptionLogger: () => undefined,
          traceContent: captureContent,
        })
      : null,
    openai: providers.includes("openai")
      ? new OpenAIInstrumentation({
          captureMessageContent: captureContent,
        })
      : null,
  };
  openAIMessageContentBridge.setCaptureContent(captureContent);
  const {
    loggerProvider,
    promptLayerLoggerProvider,
  } = createOpenAILoggerProviders(
    openAIMessageContentBridge,
    options.loggerProvider ?? logs.getLoggerProvider()
  );
  const cleanupCallbacks: Array<() => void> = [];
  if (instrumentations.openai) {
    cleanupCallbacks.push(
      registerInstrumentations({
        instrumentations: [instrumentations.openai],
        loggerProvider,
        tracerProvider,
      })
    );
  }
  if (instrumentations.bedrock) {
    cleanupCallbacks.push(
      registerInstrumentations({
        instrumentations: [instrumentations.bedrock],
        loggerProvider,
        tracerProvider,
      })
    );
  }
  if (instrumentations.anthropic) {
    instrumentations.anthropic.setTracerProvider(
      createProviderAwareTracerProvider(tracerProvider)
    );
    instrumentations.anthropic.setLoggerProvider(
      loggerProvider
    );
    const providerContextInstrumentation =
      new AnthropicProviderContextInstrumentation(
        instrumentations.anthropic
      );
    cleanupCallbacks.push(
      registerInstrumentations({
        instrumentations: [providerContextInstrumentation],
        loggerProvider,
        tracerProvider,
      })
    );
  }
  if (instrumentations.google) {
    instrumentations.google.setTracerProvider(
      createProviderAwareTracerProvider(tracerProvider)
    );
    instrumentations.google.setLoggerProvider(loggerProvider);
    const providerContextInstrumentation =
      new GoogleProviderContextInstrumentation(
        instrumentations.google
      );
    cleanupCallbacks.push(
      registerInstrumentations({
        instrumentations: [providerContextInstrumentation],
        loggerProvider,
        tracerProvider,
      })
    );
  }
  const cleanupInstrumentations = (): void => {
    for (const cleanup of cleanupCallbacks.reverse()) {
      try {
        cleanup();
      } catch {
        // Provider instrumentation is always best-effort.
      }
    }
  };

  const state: ActiveTracingState = {
    cleanupInstrumentations,
    instrumentations,
    messageContentBridge: openAIMessageContentBridge,
    promptLayerLoggerProvider,
    provider: tracerProvider,
    shutdownPromise: null,
    handle: undefined as unknown as TracingHandle,
  };
  const handle: TracingHandle = {
    ownsTracerProvider,
    tracerProvider,
    forceFlush: async () => {
      await promptLayerLoggerProvider.forceFlush();
      await forceFlushProvider(tracerProvider);
    },
    shutdown: () => {
      if (!state.shutdownPromise) {
        state.shutdownPromise = (async () => {
          state.cleanupInstrumentations();
          try {
            await promptLayerLoggerProvider.forceFlush();
            await forceFlushProvider(tracerProvider);
          } finally {
            try {
              await promptLayerLoggerProvider.shutdown();
            } finally {
              try {
                if (ownsTracerProvider) {
                  await tracerProvider.shutdown?.();
                }
              } finally {
                if (activeTracingState === state) {
                  activeTracingState = null;
                }
              }
            }
          }
        })();
      }
      return state.shutdownPromise;
    },
  };
  state.handle = handle;
  activeTracingState = state;
  return handle;
};

export const forceFlushTracing = async (): Promise<void> => {
  await activeTracingState?.handle.forceFlush();
};

export const shutdownTracing = async (): Promise<void> => {
  await activeTracingState?.handle.shutdown();
};

export const setupTracing = (
  enableTracing: boolean,
  apiKey: string,
  baseURL: string
): NodeTracerProvider => {
  if (!enableTracing) {
    throw new Error("setupTracing requires enableTracing=true");
  }

  return configureTracing({
    apiKey,
    baseURL,
    providers: ["openai", "anthropic", "google", "bedrock"],
  }).tracerProvider as NodeTracerProvider;
};
