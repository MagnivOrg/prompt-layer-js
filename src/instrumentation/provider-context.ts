import {
  context,
  createContextKey,
  INVALID_SPAN_CONTEXT,
  trace,
  type Context,
  type Span,
  type SpanOptions,
  type Tracer,
  type TracerProvider,
} from "@opentelemetry/api";
import {
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
  type InstrumentationConfig,
} from "@opentelemetry/instrumentation";
import { SDK_VERSION } from "@/utils/utils";

export const ANTHROPIC_INSTRUMENTATION_SCOPE =
  "@traceloop/instrumentation-anthropic";
export const GOOGLE_GENAI_INSTRUMENTATION_SCOPE =
  "@traceloop/instrumentation-google-generativeai";

type ProviderContextValue = {
  providerName?: string;
  suppressTracing?: boolean;
};

type PatchedMethod = {
  key: string;
  original: (...args: any[]) => any;
  target: Record<string, any>;
  wrapped: (...args: any[]) => any;
};

type ManualProviderInstrumentation = {
  manuallyInstrument(module: any): void;
};

const PROVIDER_CONTEXT_KEY = createContextKey(
  "promptlayer.provider_instrumentation"
);

const getProviderContext = (
  activeContext: Context
): ProviderContextValue | undefined =>
  activeContext.getValue(PROVIDER_CONTEXT_KEY) as
    | ProviderContextValue
    | undefined;

const callWithProviderContext = <T>(
  value: ProviderContextValue,
  callback: () => T
): T => {
  let callbackStarted = false;
  let callbackReturned = false;
  let result: T;

  try {
    const providerContext = context
      .active()
      .setValue(PROVIDER_CONTEXT_KEY, value);
    return context.with(providerContext, () => {
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

const providerContextForAnthropic = (
  resource: any
): ProviderContextValue => {
  const clientName = resource?._client?.constructor?.name;
  if (clientName === "AnthropicBedrock") {
    return { suppressTracing: true };
  }
  if (clientName === "AnthropicVertex") {
    return { providerName: "gcp.vertex_ai" };
  }
  return { providerName: "anthropic" };
};

const setFunction = (
  target: Record<string, any>,
  key: string,
  value: (...args: any[]) => any
): boolean => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      target,
      key
    );
    Object.defineProperty(target, key, {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? true,
      writable: descriptor?.writable ?? true,
      value,
    });
    return target[key] === value;
  } catch {
    try {
      target[key] = value;
      return target[key] === value;
    } catch {
      return false;
    }
  }
};

abstract class ProviderContextInstrumentationBase extends InstrumentationBase<InstrumentationConfig> {
  private readonly patchedMethods: PatchedMethod[] = [];

  protected replaceFunction(
    target: Record<string, any> | undefined,
    key: string,
    wrapped: (...args: any[]) => any
  ): void {
    if (!target || typeof target[key] !== "function") return;
    if (
      this.patchedMethods.some(
        (patch) => patch.target === target && patch.key === key
      )
    ) {
      return;
    }

    const original = target[key] as (...args: any[]) => any;
    if (setFunction(target, key, wrapped)) {
      this.patchedMethods.push({
        key,
        original,
        target,
        wrapped,
      });
    }
  }

  protected patchMethod(
    target: Record<string, any> | undefined,
    key: string,
    resolveContext: (receiver: any) => ProviderContextValue
  ): void {
    if (!target || typeof target[key] !== "function") return;

    const original = target[key] as (...args: any[]) => any;
    const wrapped = function (
      this: any,
      ...args: any[]
    ): any {
      let providerContext: ProviderContextValue;
      try {
        providerContext = resolveContext(this);
      } catch {
        return original.apply(this, args);
      }
      if (providerContext.suppressTracing) {
        const uninstrumentedOriginal = (
          original as typeof original & {
            __original?: typeof original;
          }
        ).__original;
        if (typeof uninstrumentedOriginal === "function") {
          return uninstrumentedOriginal.apply(this, args);
        }
      }
      return callWithProviderContext(providerContext, () =>
        original.apply(this, args)
      );
    };

    this.replaceFunction(target, key, wrapped);
  }

  protected restorePatches(): void {
    for (const patch of this.patchedMethods.splice(0).reverse()) {
      if (patch.target[patch.key] === patch.wrapped) {
        setFunction(
          patch.target,
          patch.key,
          patch.original
        );
      }
    }
  }
}

const getAnthropicClass = (module: any): any => {
  if (module?.[Symbol.toStringTag] === "Module") {
    return module.default;
  }
  return module?.default ?? module?.Anthropic ?? module;
};

const unwrapFunction = (
  target: Record<string, any> | undefined,
  key: string
): void => {
  const wrapped = target?.[key] as
    | {
        __original?: (...args: any[]) => any;
        __unwrap?: () => void;
      }
    | undefined;
  if (typeof wrapped?.__unwrap === "function") {
    wrapped.__unwrap();
    return;
  }
  if (typeof wrapped?.__original === "function") {
    setFunction(target!, key, wrapped.__original);
  }
};

export class AnthropicProviderContextInstrumentation extends ProviderContextInstrumentationBase {
  constructor(
    private readonly upstream: ManualProviderInstrumentation,
    config: InstrumentationConfig = {}
  ) {
    super(
      "promptlayer/instrumentation-anthropic-context",
      SDK_VERSION,
      config
    );
  }

  protected init(): InstrumentationNodeModuleDefinition {
    return new InstrumentationNodeModuleDefinition(
      "@anthropic-ai/sdk",
      [">=0.50.0 <1"],
      (module) => {
        try {
          this.upstream.manuallyInstrument(module);
          const Anthropic = getAnthropicClass(module);
          this.patchMethod(
            Anthropic?.Messages?.prototype,
            "create",
            providerContextForAnthropic
          );
          this.patchMethod(
            Anthropic?.Completions?.prototype,
            "create",
            providerContextForAnthropic
          );
          this.patchMethod(
            Anthropic?.Beta?.Messages?.prototype,
            "create",
            providerContextForAnthropic
          );
        } catch {
          // Provider instrumentation is always best-effort.
        }
        return module;
      },
      (module) => {
        try {
          this.restorePatches();
          const Anthropic = getAnthropicClass(module);
          unwrapFunction(
            Anthropic?.Messages?.prototype,
            "create"
          );
          unwrapFunction(
            Anthropic?.Completions?.prototype,
            "create"
          );
          unwrapFunction(
            Anthropic?.Beta?.Messages?.prototype,
            "create"
          );
        } catch {
          // Provider instrumentation is always best-effort.
        }
        return module;
      }
    );
  }
}

const patchGoogleModels = (
  instance: any,
  providerName: string
): void => {
  const models = instance?.models;
  for (const key of [
    "generateContent",
    "generateContentStream",
  ]) {
    if (!models || typeof models[key] !== "function") continue;
    const original = models[key];
    const wrapped = function (
      this: any,
      ...args: any[]
    ): any {
      return callWithProviderContext({ providerName }, () =>
        original.apply(this, args)
      );
    };
    setFunction(models, key, wrapped);
  }
};

export class GoogleProviderContextInstrumentation extends ProviderContextInstrumentationBase {
  constructor(
    private readonly upstream: ManualProviderInstrumentation,
    config: InstrumentationConfig = {}
  ) {
    super(
      "promptlayer/instrumentation-google-context",
      SDK_VERSION,
      config
    );
  }

  protected init(): InstrumentationNodeModuleDefinition {
    return new InstrumentationNodeModuleDefinition(
      "@google/genai",
      [">=1.0.0 <2"],
      (module) => {
        try {
          this.upstream.manuallyInstrument(module);
          const OriginalGoogleGenAI = module?.GoogleGenAI;
          if (typeof OriginalGoogleGenAI !== "function") {
            return module;
          }
          const PatchedGoogleGenAI = function (
            this: any,
            options: any
          ): any {
            const instance = Reflect.construct(
              OriginalGoogleGenAI,
              [options],
              new.target ?? OriginalGoogleGenAI
            );
            patchGoogleModels(
              instance,
              options?.vertexai
                ? "gcp.vertex_ai"
                : "gcp.gen_ai"
            );
            return instance;
          };
          Object.setPrototypeOf(
            PatchedGoogleGenAI,
            OriginalGoogleGenAI
          );
          PatchedGoogleGenAI.prototype =
            OriginalGoogleGenAI.prototype;
          this.replaceFunction(
            module,
            "GoogleGenAI",
            PatchedGoogleGenAI
          );
        } catch {
          // Provider instrumentation is always best-effort.
        }
        return module;
      },
      (module) => {
        try {
          this.restorePatches();
          unwrapFunction(module, "GoogleGenAI");
        } catch {
          // Provider instrumentation is always best-effort.
        }
        return module;
      }
    );
  }
}

export const createProviderAwareTracerProvider = (
  tracerProvider: TracerProvider
): TracerProvider => ({
  getTracer(name, version, options): Tracer {
    const tracer = tracerProvider.getTracer(
      name,
      version,
      options
    );
    return {
      startActiveSpan: tracer.startActiveSpan.bind(tracer),
      startSpan(
        spanName: string,
        spanOptions?: SpanOptions,
        spanContext?: Context
      ): Span {
        try {
          const providerContext = getProviderContext(
            spanContext ?? context.active()
          );
          if (providerContext?.suppressTracing) {
            return trace.wrapSpanContext(
              INVALID_SPAN_CONTEXT
            );
          }
          if (providerContext?.providerName) {
            return tracer.startSpan(
              spanName,
              {
                ...spanOptions,
                attributes: {
                  ...spanOptions?.attributes,
                  "gen_ai.provider.name":
                    providerContext.providerName,
                },
              },
              spanContext
            );
          }
          return tracer.startSpan(
            spanName,
            spanOptions,
            spanContext
          );
        } catch {
          // Tracing failures must never prevent the provider request.
          return trace.wrapSpanContext(INVALID_SPAN_CONTEXT);
        }
      },
    };
  },
});
