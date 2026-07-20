import { describe, it, expect, beforeEach } from "vitest";
import * as opentelemetry from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  resolveActiveTracer,
  withActiveEvalTracer,
} from "@/tracing-context";
import { runCaseInSpan } from "@/evaluations/tracing";
import { getTracer } from "@/tracing";
import { wrapWithSpan } from "@/span-wrapper";

describe("active eval tracer nesting", () => {
  let provider: NodeTracerProvider;
  let exporter: InMemorySpanExporter;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    provider.register();
    exporter.reset();
  });

  it("resolveActiveTracer prefers the active tracer", () => {
    const fallback = opentelemetry.trace.getTracer("fallback");
    const active = opentelemetry.trace.getTracer("active");

    expect(resolveActiveTracer(fallback)).toBe(fallback);

    withActiveEvalTracer(active, () => {
      expect(resolveActiveTracer(fallback)).toBe(active);
    });

    expect(resolveActiveTracer(fallback)).toBe(fallback);
  });

  it("getTracer resolves active eval tracer at call time", () => {
    const active = provider.getTracer("eval-active");

    withActiveEvalTracer(active, () => {
      expect(getTracer()).toBe(active);
    });

    expect(getTracer()).not.toBe(active);
  });

  it("runCaseInSpan publishes tracer and nests child spans", async () => {
    exporter.reset();
    const evalTracer = provider.getTracer("promptlayer.evals");
    let seenActive: opentelemetry.Tracer | undefined;

    const runner = (_input: unknown) => {
      seenActive = resolveActiveTracer(opentelemetry.trace.getTracer("unused"));
      const clientTracer = getTracer();
      return clientTracer.startActiveSpan("wrangler-turn", (child) => {
        child.end();
        return "ok";
      });
    };

    const [output, traceId, spanId] = await runCaseInSpan(
      "demo",
      runner,
      { q: "hi" },
      evalTracer
    );

    expect(output).toBe("ok");
    expect(traceId).toBeTruthy();
    expect(spanId).toBeTruthy();
    expect(seenActive).toBe(evalTracer);

    // Active tracer cleared after case finishes
    expect(resolveActiveTracer(opentelemetry.trace.getTracer("fallback"))).not.toBe(
      evalTracer
    );

    const spans = exporter.getFinishedSpans();
    const byName = Object.fromEntries(spans.map((s) => [s.name, s]));
    expect(byName["Eval: demo"]).toBeDefined();
    expect(byName["wrangler-turn"]).toBeDefined();
    const evalSpan = byName["Eval: demo"];
    const child = byName["wrangler-turn"];
    expect(child.parentSpanContext?.spanId).toBe(evalSpan.spanContext().spanId);
    expect(child.spanContext().traceId).toBe(evalSpan.spanContext().traceId);
  });

  it("wrapWithSpan uses active eval tracer at call time", async () => {
    exporter.reset();
    const evalTracer = provider.getTracer("promptlayer.evals");

    const work = wrapWithSpan("customer-op", () => 1);

    await runCaseInSpan("demo-traceable", () => work(), {}, evalTracer);

    const spans = exporter.getFinishedSpans();
    const names = new Set(spans.map((s) => s.name));
    expect(names.has("Eval: demo-traceable")).toBe(true);
    expect(names.has("customer-op")).toBe(true);
    const evalSpan = spans.find((s) => s.name === "Eval: demo-traceable")!;
    const child = spans.find((s) => s.name === "customer-op")!;
    expect(child.parentSpanContext?.spanId).toBe(evalSpan.spanContext().spanId);
  });
});
