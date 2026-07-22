/** Depth-first traversal of a Trace span tree. */
export function* walkSpans(
  node: unknown
): Generator<Record<string, unknown>> {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  yield record;
  const children = record.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      yield* walkSpans(child);
    }
  }
}

export const spanSortKey = (
  span: Record<string, unknown>
): [string, string] => {
  const start = span.start != null ? String(span.start) : "";
  const spanId = span.span_id != null ? String(span.span_id) : "";
  return [start, spanId];
};

/** Return spans sorted by start time, then span_id. */
export const iterSpansChrono = (
  root: Record<string, unknown>
): Record<string, unknown>[] => {
  const spans = [...walkSpans(root)];
  spans.sort((a, b) => {
    const aKey = spanSortKey(a);
    const bKey = spanSortKey(b);
    if (aKey[0] !== bKey[0]) return aKey[0] < bKey[0] ? -1 : 1;
    if (aKey[1] !== bKey[1]) return aKey[1] < bKey[1] ? -1 : 1;
    return 0;
  });
  return spans;
};

export type ToolSpan = {
  tool: string;
  output: unknown;
  span: Record<string, unknown>;
};

const TOOL_PREFIXES = ["Tool: ", "Tool:"] as const;

const toolNameFromSpan = (span: Record<string, unknown>): string | null => {
  const name = span.name;
  if (typeof name !== "string") return null;
  for (const prefix of TOOL_PREFIXES) {
    if (name.startsWith(prefix)) {
      return name.slice(prefix.length).trim();
    }
  }
  return null;
};

/** Collect Tool: spans in chronological order. */
export const collectToolSpans = (trace: unknown): ToolSpan[] => {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) return [];
  const tools: ToolSpan[] = [];
  for (const span of iterSpansChrono(trace as Record<string, unknown>)) {
    const tool = toolNameFromSpan(span);
    if (tool == null) continue;
    tools.push({ tool, output: span.output, span });
  }
  return tools;
};

export const extractToolNames = (trace: unknown): string[] =>
  collectToolSpans(trace).map((entry) => entry.tool);
