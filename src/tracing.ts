import * as opentelemetry from "@opentelemetry/api";
import {
  logs,
  type LoggerProvider as ApiLoggerProvider,
} from "@opentelemetry/api-logs";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { OpenAIInstrumentation } from "@opentelemetry/instrumentation-openai";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";
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
import { resolveActiveTracer } from "@/tracing-context";
import { getCommonHeaders } from "@/utils/utils";

export type OpenAITracingProvider = "openai";

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
  providers?: readonly OpenAITracingProvider[];
  serviceName?: string;
  tracerProvider?: FlushableTracerProvider;
}

export interface TracingHandle {
  readonly ownsTracerProvider: boolean;
  readonly tracerProvider: FlushableTracerProvider;
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

interface PromptLayerOpenAIRequestContext {
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
  instrumentation: OpenAIInstrumentation | null;
  messageContentBridge: OpenAIMessageContentBridge;
  promptLayerLoggerProvider: LoggerProvider;
  provider: FlushableTracerProvider;
  shutdownPromise: Promise<void> | null;
};

const OPENAI_INSTRUMENTATION_SCOPE =
  "@opentelemetry/instrumentation-openai";
const OPENAI_REQUEST_CONTEXT_KEY = opentelemetry.createContextKey(
  "promptlayer.openai_request"
);
const openAIRequestContexts = new WeakMap<
  object,
  PromptLayerOpenAIRequestContext
>();
const openAIMessageContentBridge =
  new OpenAIMessageContentBridge();

let activeTracingState: ActiveTracingState | null = null;

const getOpenAIRequestContext = (
  context: opentelemetry.Context
): PromptLayerOpenAIRequestContext | undefined =>
  context.getValue(OPENAI_REQUEST_CONTEXT_KEY) as
    | PromptLayerOpenAIRequestContext
    | undefined;

export const withPromptLayerOpenAIRequestContext = <T>(
  value: PromptLayerOpenAIRequestContext,
  callback: () => T
): T =>
  opentelemetry.context.with(
    opentelemetry.context
      .active()
      .setValue(OPENAI_REQUEST_CONTEXT_KEY, value),
    callback
  );

const addPromptLayerAttributes = (
  span: ReadableSpan
): ReadableSpan => {
  if (
    span.instrumentationScope.name !== OPENAI_INSTRUMENTATION_SCOPE
  ) {
    return span;
  }

  const requestContext = openAIRequestContexts.get(span);
  const messageContent =
    openAIMessageContentBridge.takeSpanAttributes(span);
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
    const [span, parentContext] = args;
    const requestContext = getOpenAIRequestContext(parentContext);
    if (requestContext) {
      openAIRequestContexts.set(span, requestContext);
    }
    this.processor.onStart(...args);
  }

  onEnd(span: ReadableSpan): void {
    try {
      this.processor.onEnd(addPromptLayerAttributes(span));
    } finally {
      openAIRequestContexts.delete(span);
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
      activeTracingState.instrumentation?.setConfig({
        captureMessageContent: captureContent,
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

  const instrumentation = (
    options.providers ?? (["openai"] as const)
  ).includes("openai")
    ? new OpenAIInstrumentation({
        captureMessageContent: captureContent,
      })
    : null;
  openAIMessageContentBridge.setCaptureContent(captureContent);
  const {
    loggerProvider,
    promptLayerLoggerProvider,
  } = createOpenAILoggerProviders(
    openAIMessageContentBridge,
    options.loggerProvider ?? logs.getLoggerProvider()
  );
  const cleanupInstrumentations = registerInstrumentations({
    instrumentations: instrumentation ? [instrumentation] : [],
    loggerProvider,
    tracerProvider,
  });

  const state: ActiveTracingState = {
    cleanupInstrumentations,
    instrumentation,
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
    providers: ["openai"],
  }).tracerProvider as NodeTracerProvider;
};
