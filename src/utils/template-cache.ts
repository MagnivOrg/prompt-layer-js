import nunjucks from "nunjucks";

// ── constants ────────────────────────────────────────────────────────

const NON_RENDERABLE_TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
const MAX_COMPILED_TEMPLATES = 512;

// ── types ────────────────────────────────────────────────────────────

/**
 * Tuple: [promptName, version, label, provider, model]
 * Serialized to a JSON string for use as a Map key.
 */
type CacheKeyTuple = [
  string,
  number | null,
  string | null,
  string | null,
  string | null,
];

interface CacheEntry {
  response: Record<string, unknown>;
  /** `performance.now()` timestamp in ms */
  timestamp: number;
}

// ── PromptTemplateCache ──────────────────────────────────────────────

/**
 * In-memory TTL cache for prompt templates.
 *
 * Stores unrendered API responses keyed by (promptName, version, label,
 * provider, model). Supports stale-while-error: if the TTL has expired but
 * the API is unreachable, the stale entry can be re-rendered as a fallback.
 */
export class PromptTemplateCache {
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly nonRenderable = new Map<string, number>();

  constructor(ttlSeconds: number, maxSize: number = MAX_ENTRIES) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxSize = maxSize;
  }

  static makeKey(
    promptName: string,
    params?: Record<string, unknown> | null
  ): CacheKeyTuple {
    if (!params) return [promptName, null, null, null, null];
    return [
      promptName,
      (params["version"] as number) ?? null,
      (params["label"] as string) ?? null,
      (params["provider"] as string) ?? null,
      (params["model"] as string) ?? null,
    ];
  }

  private static serialize(key: CacheKeyTuple): string {
    return JSON.stringify(key);
  }

  /**
   * Returns `[deepClone | null, isFresh]`.
   * The returned object is safe to mutate.
   */
  get(key: CacheKeyTuple): [Record<string, unknown> | null, boolean] {
    const k = PromptTemplateCache.serialize(key);
    const entry = this.entries.get(k);
    if (!entry) return [null, false];
    const isFresh = performance.now() - entry.timestamp < this.ttlMs;
    return [structuredClone(entry.response), isFresh];
  }

  put(key: CacheKeyTuple, response: Record<string, unknown>): void {
    const k = PromptTemplateCache.serialize(key);
    if (this.entries.size >= this.maxSize && !this.entries.has(k)) {
      this.evictOldestEntry();
    }
    this.entries.set(k, {
      response: structuredClone(response),
      timestamp: performance.now(),
    });
  }

  isNonRenderable(key: CacheKeyTuple): boolean {
    const k = PromptTemplateCache.serialize(key);
    const ts = this.nonRenderable.get(k);
    if (ts === undefined) return false;
    if (performance.now() - ts >= NON_RENDERABLE_TTL_MS) {
      this.nonRenderable.delete(k);
      return false;
    }
    return true;
  }

  markNonRenderable(key: CacheKeyTuple): void {
    const k = PromptTemplateCache.serialize(key);
    if (
      this.nonRenderable.size >= MAX_ENTRIES &&
      !this.nonRenderable.has(k)
    ) {
      this.evictOldestNonRenderable();
    }
    this.nonRenderable.set(k, performance.now());
  }

  clear(): void {
    this.entries.clear();
    this.nonRenderable.clear();
  }

  /** Remove all entries whose cache key starts with `promptName`. */
  invalidate(promptName: string): void {
    for (const k of this.entries.keys()) {
      if ((JSON.parse(k) as CacheKeyTuple)[0] === promptName) {
        this.entries.delete(k);
      }
    }
    for (const k of this.nonRenderable.keys()) {
      if ((JSON.parse(k) as CacheKeyTuple)[0] === promptName) {
        this.nonRenderable.delete(k);
      }
    }
  }

  private evictOldestEntry(): void {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, entry] of this.entries) {
      if (entry.timestamp < oldestTs) {
        oldestTs = entry.timestamp;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) this.entries.delete(oldestKey);
  }

  private evictOldestNonRenderable(): void {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, ts] of this.nonRenderable) {
      if (ts < oldestTs) {
        oldestTs = ts;
        oldestKey = k;
      }
    }
    if (oldestKey !== null) this.nonRenderable.delete(oldestKey);
  }
}

// ── public helpers ───────────────────────────────────────────────────

/** Return true when request params make caching inappropriate. */
export function shouldSkipCache(
  params?: Record<string, unknown> | null
): boolean {
  if (!params) return false;
  return !!(params["metadata_filters"] || params["model_parameter_overrides"]);
}

/**
 * Check whether the template can be rendered client-side.
 *
 * Rejects templates with placeholder messages or variable-type tools,
 * which require server-side logic.
 */
export function isLocallyRenderable(
  response: Record<string, unknown>
): boolean {
  const pt = response["prompt_template"] as Record<string, unknown> | undefined;
  if (!pt) return false;

  if (pt["type"] === "chat") {
    const messages = (pt["messages"] as Array<Record<string, unknown>>) ?? [];
    for (const msg of messages) {
      if (msg["role"] === "placeholder") return false;
    }
  }

  const tools = (pt["tools"] as Array<Record<string, unknown>>) ?? [];
  for (const tool of tools) {
    if (tool["type"] === "variable") return false;
  }

  return true;
}

/**
 * Build API request params for fetching a cacheable (unrendered) template.
 * Strips input_variables, metadata_filters, model_parameter_overrides and
 * sets skip_input_variable_rendering=true.
 */
export function makeCacheParams(
  params?: Record<string, unknown> | null
): Record<string, unknown> {
  const STRIP = new Set([
    "input_variables",
    "metadata_filters",
    "model_parameter_overrides",
  ]);
  const result: Record<string, unknown> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (!STRIP.has(k)) result[k] = v;
    }
  }
  result["skip_input_variable_rendering"] = true;
  return result;
}

// ── Nunjucks (Jinja2) setup ──────────────────────────────────────────

/**
 * Shared Nunjucks environment — no file loader, no HTML auto-escaping.
 * Mirrors Python's `SandboxedEnvironment(undefined=ChainableUndefined)`:
 * undefined variables render as empty string.
 */
const _nunjucksEnv = new nunjucks.Environment(null as any, {
  autoescape: false,
});

/** Compiled-template cache (mirrors Python's @lru_cache(maxsize=512)). */
const _compiledTemplates = new Map<string, nunjucks.Template>();

function _getCompiledTemplate(template: string): nunjucks.Template {
  let compiled = _compiledTemplates.get(template);
  if (!compiled) {
    if (_compiledTemplates.size >= MAX_COMPILED_TEMPLATES) {
      // FIFO eviction — remove the first (oldest inserted) entry
      const firstKey = _compiledTemplates.keys().next().value;
      if (firstKey !== undefined) _compiledTemplates.delete(firstKey);
    }
    compiled = nunjucks.compile(template, _nunjucksEnv);
    _compiledTemplates.set(template, compiled);
  }
  return compiled;
}

function _jinja2Render(
  template: string,
  variables: Record<string, unknown>
): string {
  return _getCompiledTemplate(template).render(variables);
}

/**
 * Match server-side fstring_formatter behaviour.
 * Replaces `{key}` and `{key:spec}` / `{key!conv}` patterns;
 * missing or null/undefined variables become empty string.
 */
function _fstringRender(
  template: string,
  variables: Record<string, unknown>
): string {
  return template.replace(/\{(\w+)(?:[!:][^}]*)?\}/g, (_, key: string) => {
    if (key in variables) {
      const val = variables[key];
      return val !== null && val !== undefined ? String(val) : "";
    }
    return "";
  });
}

function _renderText(
  text: string,
  templateFormat: string,
  variables: Record<string, unknown>
): string {
  try {
    if (templateFormat === "jinja2") return _jinja2Render(text, variables);
    return _fstringRender(text, variables);
  } catch {
    return text;
  }
}

// ── response rendering ───────────────────────────────────────────────

function _getMessageFormats(promptTemplate: Record<string, unknown>): string[] {
  if (promptTemplate["type"] === "chat") {
    const messages =
      (promptTemplate["messages"] as Array<Record<string, unknown>>) ?? [];
    return messages.map(
      (msg) => (msg["template_format"] as string) ?? "f-string"
    );
  }
  if (promptTemplate["type"] === "completion") {
    return [(promptTemplate["template_format"] as string) ?? "f-string"];
  }
  return ["f-string"];
}

function _renderPromptTemplate(
  promptTemplate: Record<string, unknown>,
  variables: Record<string, unknown>
): void {
  if (promptTemplate["type"] === "chat") {
    const messages =
      (promptTemplate["messages"] as Array<Record<string, unknown>>) ?? [];
    for (const message of messages) {
      const fmt = (message["template_format"] as string) ?? "f-string";
      const content =
        (message["content"] as Array<Record<string, unknown>>) ?? [];
      for (const block of content) {
        if (
          block &&
          block["type"] === "text" &&
          typeof block["text"] === "string"
        ) {
          block["text"] = _renderText(block["text"], fmt, variables);
        }
      }
    }
  } else if (promptTemplate["type"] === "completion") {
    const fmt = (promptTemplate["template_format"] as string) ?? "f-string";
    const content =
      (promptTemplate["content"] as Array<Record<string, unknown>>) ?? [];
    for (const block of content) {
      if (
        block &&
        block["type"] === "text" &&
        typeof block["text"] === "string"
      ) {
        block["text"] = _renderText(block["text"], fmt, variables);
      }
    }
  }
}

const TEXT_CONTENT_TYPES = new Set(["text", "input_text"]);

function _renderContentField(
  value: unknown,
  templateFormat: string,
  variables: Record<string, unknown>
): unknown {
  if (typeof value === "string") {
    return _renderText(value, templateFormat, variables);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (
        item &&
        typeof item === "object" &&
        "text" in item &&
        typeof (item as Record<string, unknown>)["text"] === "string"
      ) {
        const typed = item as Record<string, unknown>;
        const itemType = (typed["type"] as string) ?? "text";
        if (TEXT_CONTENT_TYPES.has(itemType)) {
          typed["text"] = _renderText(
            typed["text"] as string,
            templateFormat,
            variables
          );
        }
      }
    }
    return value;
  }
  return value;
}

function _renderParts(
  parts: Array<Record<string, unknown>>,
  fmt: string,
  variables: Record<string, unknown>
): void {
  for (const part of parts) {
    if (part && typeof part["text"] === "string") {
      part["text"] = _renderText(part["text"], fmt, variables);
    }
  }
}

function _findSystemInstruction(
  llmKwargs: Record<string, unknown>
): unknown {
  if ("system_instruction" in llmKwargs) return llmKwargs["system_instruction"];
  const gc = llmKwargs["generation_config"];
  if (gc && typeof gc === "object" && !Array.isArray(gc)) {
    return (gc as Record<string, unknown>)["system_instruction"];
  }
  return undefined;
}

function _renderLlmKwargs(
  llmKwargs: Record<string, unknown>,
  messageFormats: string[],
  variables: Record<string, unknown>
): void {
  const fmt = messageFormats.length > 0 ? messageFormats[0] : "f-string";

  // messages — OpenAI Chat Completions / Anthropic / Mistral / Bedrock
  const messages =
    (llmKwargs["messages"] as Array<Record<string, unknown>>) ?? [];
  for (const msg of messages) {
    if ("content" in msg) {
      msg["content"] = _renderContentField(msg["content"], fmt, variables);
    }
  }

  // input — OpenAI Responses API
  const input = (llmKwargs["input"] as Array<unknown>) ?? [];
  for (const msg of input) {
    if (msg && typeof msg === "object" && "content" in msg) {
      const m = msg as Record<string, unknown>;
      m["content"] = _renderContentField(m["content"], fmt, variables);
    }
  }

  // system — Anthropic / Bedrock top-level
  if ("system" in llmKwargs) {
    llmKwargs["system"] = _renderContentField(
      llmKwargs["system"],
      fmt,
      variables
    );
  }

  // contents — Google (completion)
  const contents =
    (llmKwargs["contents"] as Array<Record<string, unknown>>) ?? [];
  for (const item of contents) {
    if (item && typeof item === "object") {
      _renderParts(
        (item["parts"] as Array<Record<string, unknown>>) ?? [],
        fmt,
        variables
      );
    }
  }

  // history — Google (chat)
  const history =
    (llmKwargs["history"] as Array<Record<string, unknown>>) ?? [];
  for (const item of history) {
    if (item && typeof item === "object") {
      _renderParts(
        (item["parts"] as Array<Record<string, unknown>>) ?? [],
        fmt,
        variables
      );
    }
  }

  // system_instruction — Google (top-level or inside generation_config)
  const si = _findSystemInstruction(llmKwargs);
  if (si && typeof si === "object" && !Array.isArray(si)) {
    _renderParts(
      ((si as Record<string, unknown>)["parts"] as Array<
        Record<string, unknown>
      >) ?? [],
      fmt,
      variables
    );
  } else if (Array.isArray(si)) {
    _renderParts(si as Array<Record<string, unknown>>, fmt, variables);
  }

  // prompt — completion-type models
  if (typeof llmKwargs["prompt"] === "string") {
    llmKwargs["prompt"] = _renderText(llmKwargs["prompt"], fmt, variables);
  }
}

/**
 * Render input variables in a response dict.
 *
 * Mutates `response` in-place and returns it. Callers that need to preserve
 * the original must pass a clone (e.g. the one returned by
 * `PromptTemplateCache.get`).
 */
export function renderResponse(
  response: Record<string, unknown>,
  inputVariables?: Record<string, unknown> | null
): Record<string, unknown> {
  const hasLlmKwargs =
    response["llm_kwargs"] !== null && response["llm_kwargs"] !== undefined;

  let variables: Record<string, unknown>;
  if (hasLlmKwargs) {
    variables = inputVariables ?? {};
  } else {
    if (!inputVariables) return response;
    variables = inputVariables;
  }

  const pt = response["prompt_template"] as
    | Record<string, unknown>
    | undefined;
  if (pt) {
    _renderPromptTemplate(pt, variables);
    const messageFormats = _getMessageFormats(pt);
    if (response["llm_kwargs"]) {
      _renderLlmKwargs(
        response["llm_kwargs"] as Record<string, unknown>,
        messageFormats,
        variables
      );
    }
  }

  return response;
}
