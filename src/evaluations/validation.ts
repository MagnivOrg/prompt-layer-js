import {
  EvalDataset,
  EvalProcessingColumn,
  EvalScorerColumn,
  ResourceId,
  Column,
  ColumnDependency,
} from "@/types";
import { EvaluationFailedError } from "@/errors";
import { scorerFromFunction } from "./columns";
import { validationError } from "./errors";
import {
  collectFailedCellRowIndices,
  extractOverallScore,
} from "./scores";
import {
  RESERVED_EVAL_COLUMN_TITLES,
  findColumnByTitle,
} from "./utils";
import type { EvalResult } from "@/types";

const NAMED_SOURCE_KEYS = [
  "source",
  "chat_history_source",
  "user_persona_source",
  "conversation_completed_prompt_source",
  "prompt_source",
  "iterator_source",
  "value_source",
  "content_source",
  "diff_source",
  "trace_source",
  "expected_source",
] as const;

const MAPPING_SOURCE_KEYS = [
  "prompt_template_variable_mappings",
  "variable_mappings",
  "input_variables",
] as const;

type NormalizeColumnRules = {
  label: "scorer" | "column";
  allowFunctions: boolean;
  disallowText: boolean;
  preserveSdkDiagnosis: boolean;
  requireObjectConfig: boolean;
};

const normalizeColumnDefinition = (
  value: unknown,
  rules: NormalizeColumnRules
): EvalScorerColumn => {
  if (typeof value === "function") {
    if (!rules.allowFunctions) {
      throw validationError(
        "Eval columns must be explicit column definitions (e.g. column(...)); " +
          "callables are only supported in scorers."
      );
    }
    return scorerFromFunction(value as (...args: unknown[]) => unknown);
  }
  if (!value || typeof value !== "object") {
    throw validationError(
      rules.label === "scorer"
        ? "Eval scorers must be column objects (e.g. llmAssertionScorer(...)) or named functions."
        : "Eval columns must be column objects (e.g. column(...))."
    );
  }
  const record = value as Record<string, unknown>;
  const title = record.title;
  const columnType = record.type;
  if (typeof title !== "string" || !title.trim()) {
    throw validationError(
      rules.label === "scorer"
        ? "Eval scorer title must be a non-empty string."
        : "Eval column title must be a non-empty string."
    );
  }
  if (typeof columnType !== "string" || !columnType.trim()) {
    throw validationError(
      rules.label === "scorer"
        ? "Eval scorer type must be a non-empty string."
        : "Eval column type must be a non-empty string."
    );
  }
  if (rules.disallowText && columnType.toUpperCase() === "TEXT") {
    throw validationError(
      "Eval columns cannot be TEXT; use dataset fields or built-in input/expected/output columns."
    );
  }
  const normalized: EvalScorerColumn = {
    title: rules.label === "column" ? title.trim() : title,
    type: columnType,
  };
  if (record.config !== undefined) {
    if (
      rules.requireObjectConfig &&
      (!record.config ||
        typeof record.config !== "object" ||
        Array.isArray(record.config))
    ) {
      throw validationError(`Eval column '${title}' config must be an object.`);
    }
    normalized.config = record.config as Record<string, unknown>;
  }
  if (rules.preserveSdkDiagnosis) {
    const sdkDiagnosis = record._sdkDiagnosis ?? record._sdk_diagnosis;
    if (sdkDiagnosis !== undefined && sdkDiagnosis !== null) {
      normalized._sdkDiagnosis = String(sdkDiagnosis);
    }
  }
  if (record.weight !== undefined) {
    normalized.weight = Number(record.weight);
  }
  if (record.required !== undefined) {
    normalized.required = Boolean(record.required);
  }
  if (
    record.thresholds &&
    typeof record.thresholds === "object" &&
    !Array.isArray(record.thresholds)
  ) {
    normalized.thresholds = record.thresholds as {
      pass?: number;
      warn?: number;
    };
  }
  return normalized;
};

export const normalizeScorer = (scorer: unknown): EvalScorerColumn =>
  normalizeColumnDefinition(scorer, {
    label: "scorer",
    allowFunctions: true,
    disallowText: false,
    preserveSdkDiagnosis: true,
    requireObjectConfig: false,
  });

export const validateEvalTarget = (args: {
  tableId?: ResourceId | null;
  sheetId?: ResourceId | null;
  folderId?: number | null;
}): void => {
  if (args.tableId != null && args.folderId != null) {
    throw validationError(
      "Eval folderId cannot be used together with tableId."
    );
  }
  if (
    args.folderId != null &&
    (typeof args.folderId !== "number" || !Number.isInteger(args.folderId))
  ) {
    throw validationError("Eval folderId must be an integer.");
  }
  if (args.sheetId != null) {
    throw validationError(
      "Eval sheetId is not supported. Evals require a dedicated experiment sheet."
    );
  }
};

export const normalizeProcessingColumn = (
  column: unknown
): EvalProcessingColumn =>
  normalizeColumnDefinition(column, {
    label: "column",
    allowFunctions: false,
    disallowText: true,
    preserveSdkDiagnosis: false,
    requireObjectConfig: true,
  });

/** True when JS/Python-ish code references a Table column title. */
export const codeReferencesColumnTitle = (
  code: string,
  title: string
): boolean =>
  code.includes(`data.get(${JSON.stringify(title)})`) ||
  code.includes(`data.get('${title}')`) ||
  code.includes(`data["${title}"]`) ||
  code.includes(`data['${title}']`) ||
  code.includes(`data.${title}`);

const assertUniqueColumnTitles = (
  processingColumns: EvalProcessingColumn[],
  scorers: EvalScorerColumn[]
): void => {
  const seen = new Map<string, string>();
  for (const column of processingColumns) {
    const title = column.title;
    if (RESERVED_EVAL_COLUMN_TITLES.has(title)) {
      throw validationError(
        `Eval column title '${title}' is reserved for built-in eval columns.`
      );
    }
    if (seen.has(title)) {
      throw validationError(`Duplicate eval column title '${title}'.`);
    }
    seen.set(title, "columns");
  }
  for (const scorer of scorers) {
    const title = scorer.title;
    if (RESERVED_EVAL_COLUMN_TITLES.has(title)) {
      throw validationError(
        `Eval scorer title '${title}' is reserved for built-in eval columns.`
      );
    }
    if (seen.has(title)) {
      throw validationError(
        `Eval scorer title '${title}' conflicts with a supporting column title.`
      );
    }
    seen.set(title, "scorers");
  }
};

export const assertEvalArgs = (
  name: string,
  dataset: EvalDataset,
  runner: unknown,
  scorers: unknown[],
  options: {
    columns?: unknown[] | null;
    tableId?: ResourceId | null;
    sheetId?: ResourceId | null;
    folderId?: number | null;
    experimentName?: string;
    maxConcurrency?: number;
    passingScore?: number;
  } = {}
): { scorers: EvalScorerColumn[]; columns: EvalProcessingColumn[] } => {
  if (typeof name !== "string" || !name.trim()) {
    throw validationError("Eval name must be a non-empty string.");
  }
  if (typeof runner !== "function") {
    throw validationError("Eval runner must be a function.");
  }
  if (!Array.isArray(scorers) || !scorers.length) {
    throw validationError(
      "Eval scorers must be a non-empty list of column definitions or functions."
    );
  }
  if (options.columns != null && !Array.isArray(options.columns)) {
    throw validationError("Eval columns must be a list of column definitions.");
  }
  const normalizedScorers = scorers.map((scorer) => normalizeScorer(scorer));
  const normalizedColumns = (options.columns || []).map((column) =>
    normalizeProcessingColumn(column)
  );
  assertUniqueColumnTitles(normalizedColumns, normalizedScorers);

  validateEvalTarget({
    tableId: options.tableId,
    sheetId: options.sheetId,
    folderId: options.folderId,
  });
  if (
    options.experimentName != null &&
    (typeof options.experimentName !== "string" ||
      !options.experimentName.trim())
  ) {
    throw validationError("Eval experimentName must be a non-empty string.");
  }
  const maxConcurrency = options.maxConcurrency ?? 1;
  if (
    typeof maxConcurrency !== "number" ||
    !Number.isInteger(maxConcurrency) ||
    maxConcurrency < 1
  ) {
    throw validationError("Eval maxConcurrency must be a positive integer.");
  }
  if (options.passingScore !== undefined) {
    if (typeof options.passingScore === "boolean") {
      throw validationError("Eval passingScore must be a number.");
    }
    if (
      typeof options.passingScore !== "number" ||
      !Number.isFinite(options.passingScore)
    ) {
      throw validationError("Eval passingScore must be a number.");
    }
  }

  if (Array.isArray(dataset)) {
    if (!dataset.length) {
      throw validationError("Eval dataset list must not be empty.");
    }
    for (const caseItem of dataset) {
      if (!caseItem || typeof caseItem !== "object" || !("input" in caseItem)) {
        throw validationError(
          "Each inline eval case must be an object with an 'input' key."
        );
      }
      for (const key of Object.keys(caseItem)) {
        if (key === "input" || key === "expected" || key === "expectedTrace") {
          continue;
        }
        if (!key.trim() || RESERVED_EVAL_COLUMN_TITLES.has(key)) {
          throw validationError(
            `Eval dataset field '${key}' collides with a reserved eval column or alias.`
          );
        }
      }
    }
    return { scorers: normalizedScorers, columns: normalizedColumns };
  }
  if (dataset && typeof dataset === "object") {
    const ref = dataset as unknown as Record<string, unknown>;
    if (ref.tableId == null) {
      throw validationError(
        "Eval dataset table reference requires tableId."
      );
    }
    if ("table" in ref) {
      throw validationError(
        "Eval dataset no longer accepts 'table' titles; use tableId."
      );
    }
    return { scorers: normalizedScorers, columns: normalizedColumns };
  }
  throw validationError(
    "Eval dataset must be a list of cases or an object with tableId (and optional sheetId)."
  );
};

export const assertPassingScore = (
  score: unknown,
  passingScore: number | undefined,
  options: {
    result?: EvalResult | null;
    failingRowIndices?: number[] | null;
  } = {}
): void => {
  const result = options.result ?? null;
  const evalName = result?.name;
  const sheetUrl = result?.url;
  const failedCellRows = collectFailedCellRowIndices(result?.results || []);

  if (failedCellRows.length) {
    const header = evalName
      ? `Evaluation '${evalName}' failed: one or more scorecard evaluators failed to execute`
      : "Evaluation failed: one or more scorecard evaluators failed to execute";
    const failureLines = [header];
    if (sheetUrl) failureLines.push("", `Inspect the sheet: ${sheetUrl}`);
    throw new EvaluationFailedError(failureLines.join("\n"), {
      score,
      passingScore: passingScore ?? null,
      result,
      failingRowIndices: failedCellRows,
    });
  }

  if (passingScore === undefined) return;

  const threshold = Number(passingScore);
  const overall = extractOverallScore(score);
  if (overall !== null && overall >= threshold) return;

  const header =
    overall === null
      ? evalName
        ? `Evaluation '${evalName}' failed: overall score is missing (passing score ${threshold})`
        : `Evaluation failed: overall score is missing (passing score ${threshold})`
      : evalName
        ? `Evaluation '${evalName}' failed: overall score ${overall} is below passing score ${threshold}`
        : `Evaluation failed: overall score ${overall} is below passing score ${threshold}`;

  const failureLines = [header];
  if (sheetUrl) failureLines.push("", `Inspect the sheet: ${sheetUrl}`);

  throw new EvaluationFailedError(failureLines.join("\n"), {
    score,
    passingScore: threshold,
    result,
    failingRowIndices: options.failingRowIndices ?? undefined,
  });
};

export const dependencyItem = (
  columnId: unknown,
  configKey: string,
  configMeta?: Record<string, unknown>
): ColumnDependency => {
  const item: ColumnDependency = {
    column_id: String(columnId),
    reference_type: "value",
    config_key: configKey,
  };
  if (configMeta !== undefined) item.config_meta = configMeta;
  return item;
};

export type ScorerSource = [
  unknown,
  string,
  Record<string, unknown> | null,
];

export const iterScorerSources = (
  config: Record<string, unknown> | null | undefined
): ScorerSource[] => {
  if (!config || typeof config !== "object") return [];
  const sources: ScorerSource[] = [];
  for (const key of NAMED_SOURCE_KEYS) {
    sources.push([config[key], key, null]);
  }
  if (Array.isArray(config.sources)) {
    config.sources.forEach((title, position) => {
      sources.push([title, "sources", { position }]);
    });
  }
  for (const key of MAPPING_SOURCE_KEYS) {
    const mapping = config[key];
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      continue;
    }
    for (const [variableName, title] of Object.entries(
      mapping as Record<string, unknown>
    )) {
      sources.push([title, key, { variable_name: String(variableName) }]);
    }
  }
  return sources;
};

export const scorerDependenciesFromConfig = (
  config: Record<string, unknown> | null | undefined,
  columnsByTitleMap: Record<string, Column>,
  label = "scorer"
): ColumnDependency[] => {
  if (!config || typeof config !== "object") return [];

  const dependencies: ColumnDependency[] = [];
  const missing: string[] = [];

  const requireColumn = (title: unknown): Column | null => {
    if (typeof title !== "string" || !title.trim()) return null;
    const column = findColumnByTitle(columnsByTitleMap, title);
    if (!column) {
      missing.push(title);
      return null;
    }
    return column;
  };

  for (const [sourceTitle, key, configMeta] of iterScorerSources(config)) {
    const column = requireColumn(sourceTitle);
    if (column) {
      dependencies.push(
        dependencyItem(column.id, key, configMeta ?? undefined)
      );
    }
  }

  if (missing.length) {
    const uniqueMissing = [...new Set(missing)].sort().join(", ");
    throw validationError(
      `Eval ${label} source column(s) not found: ${uniqueMissing}. ` +
        "Use exact column titles (e.g. 'Output' or 'Trace'), or declare " +
        "supporting columns before they are referenced."
    );
  }
  return dependencies;
};

/**
 * Return a copy of config with source column titles rewritten to column IDs.
 *
 * Authoring APIs keep human-readable titles (e.g. `source: "Output"`). The
 * scorecard UI and backing-column dependency wiring expect UUIDs in
 * `primitive_config`, so rewrite titles once columns exist.
 */
export const resolveConfigSourcesToColumnIds = (
  config: Record<string, unknown> | null | undefined,
  columnsByTitleMap: Record<string, Column>
): Record<string, unknown> => {
  if (!config || typeof config !== "object") return {};

  const byId = new Map<string, Column>();
  for (const column of Object.values(columnsByTitleMap)) {
    byId.set(String(column.id), column);
  }

  const resolveRef = (reference: unknown): unknown => {
    if (typeof reference !== "string" || !reference.trim()) {
      return reference;
    }
    const column =
      findColumnByTitle(columnsByTitleMap, reference) ?? byId.get(reference);
    if (!column) return reference;
    return String(column.id);
  };

  const resolved: Record<string, unknown> = { ...config };
  for (const key of NAMED_SOURCE_KEYS) {
    if (key in resolved) {
      resolved[key] = resolveRef(resolved[key]);
    }
  }

  // Used by COLUMN_AGGREGATE; not in dependency iteration but still UI-bound.
  if ("label_source" in resolved) {
    resolved.label_source = resolveRef(resolved.label_source);
  }

  if (Array.isArray(resolved.sources)) {
    resolved.sources = resolved.sources.map((item) => resolveRef(item));
  }

  for (const key of MAPPING_SOURCE_KEYS) {
    const mapping = resolved[key];
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      continue;
    }
    resolved[key] = Object.fromEntries(
      Object.entries(mapping as Record<string, unknown>).map(
        ([variableName, sourceRef]) => [variableName, resolveRef(sourceRef)]
      )
    );
  }
  return resolved;
};
