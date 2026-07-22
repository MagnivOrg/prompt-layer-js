import { EvalCaseResult, EvalScoreCard } from "@/types";

export const unwrapNestedValue = (value: unknown): unknown => {
  let current = value;
  while (
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    Object.keys(current as object).length === 1 &&
    "value" in (current as object)
  ) {
    const nested = (current as Record<string, unknown>).value;
    if (nested === current) break;
    current = nested;
  }
  return current;
};

const assertionExplanation = (
  detail: Record<string, unknown>
): string | null => {
  for (const key of ["reasoning", "explanation"]) {
    const text = detail[key];
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
};

const LLM_ASSERTION_DETAIL_KEYS = new Set([
  "value",
  "reasoning",
  "explanation",
  "citation",
]);

export const iterLlmAssertionDetails = (
  value: unknown
): Array<[string, unknown, string | null]> => {
  const unwrapped = unwrapNestedValue(value);
  if (typeof unwrapped === "boolean") {
    return [["Assertion", unwrapped, null]];
  }
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    return [];
  }

  const record = unwrapped as Record<string, unknown>;
  if (
    "value" in record &&
    Object.keys(record).every((key) => LLM_ASSERTION_DETAIL_KEYS.has(key))
  ) {
    return [["Assertion", record.value, assertionExplanation(record)]];
  }

  const details: Array<[string, unknown, string | null]> = [];
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "boolean") {
      details.push([key, entry, null]);
    } else if (entry && typeof entry === "object" && "value" in entry) {
      details.push([
        key,
        (entry as Record<string, unknown>).value,
        assertionExplanation(entry as Record<string, unknown>),
      ]);
    }
  }
  return details;
};

/** Aggregate nested LLM assertion payload into a single boolean verdict. */
export const llmAssertionVerdict = (value: unknown): boolean | null => {
  const unwrapped = unwrapNestedValue(value);
  if (typeof unwrapped === "boolean") return unwrapped;
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
    return null;
  }

  const record = unwrapped as Record<string, unknown>;
  if (record.status === "FAILED") return null;

  if (
    "value" in record &&
    Object.keys(record).every((key) => LLM_ASSERTION_DETAIL_KEYS.has(key))
  ) {
    return typeof record.value === "boolean" ? record.value : null;
  }

  const verdicts: boolean[] = [];
  for (const detail of Object.values(record)) {
    if (typeof detail === "boolean") {
      verdicts.push(detail);
    } else if (
      detail &&
      typeof detail === "object" &&
      !Array.isArray(detail) &&
      typeof (detail as Record<string, unknown>).value === "boolean"
    ) {
      verdicts.push((detail as Record<string, unknown>).value as boolean);
    } else {
      return null;
    }
  }
  return verdicts.length ? verdicts.every(Boolean) : null;
};

export const scorerValueFailed = (value: unknown): boolean => {
  if (value === false || value === 0) return true;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.status === "FAILED") return true;
    if (typeof record.comparison_result === "boolean") {
      return record.comparison_result === false;
    }
    const assertions = iterLlmAssertionDetails(value);
    if (assertions.length) {
      return assertions.some(([, passed]) => passed === false);
    }
  }
  return false;
};

export const caseHasFailedScorer = (caseResult: EvalCaseResult): boolean =>
  Object.values(caseResult.scores || {}).some(scorerValueFailed);

export const collectFailingRowIndices = (
  caseResults: EvalCaseResult[]
): number[] => {
  const indices: number[] = [];
  for (const caseResult of caseResults) {
    if (!caseHasFailedScorer(caseResult)) continue;
    if (caseResult.rowIndex == null) continue;
    indices.push(Number(caseResult.rowIndex));
  }
  return indices;
};

export const collectFailedCellRowIndices = (
  caseResults: EvalCaseResult[]
): number[] => {
  const indices: number[] = [];
  for (const caseResult of caseResults) {
    const hasFailedCell = Object.values(caseResult.scores || {}).some(
      (value) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).status === "FAILED"
    );
    if (!hasFailedCell || caseResult.rowIndex == null) continue;
    indices.push(Number(caseResult.rowIndex));
  }
  return indices;
};

export const scorerPassRates = (
  caseResults: EvalCaseResult[]
): EvalScoreCard[] => {
  const totals: Record<string, number> = {};
  const passedCounts: Record<string, number> = {};
  const order: string[] = [];

  for (const caseResult of caseResults) {
    for (const [title, value] of Object.entries(caseResult.scores || {})) {
      if (!(title in totals)) {
        order.push(title);
        totals[title] = 0;
        passedCounts[title] = 0;
      }
      totals[title] += 1;
      if (!scorerValueFailed(value)) passedCounts[title] += 1;
    }
  }

  return order.map((title) => ({
    scorer: title,
    passed: passedCounts[title],
    total: totals[title],
    passRate: totals[title] ? passedCounts[title] / totals[title] : 0,
  }));
};

export const extractBooleanScoreCounts = (
  score: unknown
): [number, number] | null => {
  if (!score || typeof score !== "object" || Array.isArray(score)) return null;
  const aggregate = (score as Record<string, unknown>).aggregate;
  if (!aggregate || typeof aggregate !== "object" || Array.isArray(aggregate)) {
    return null;
  }
  const record = aggregate as Record<string, unknown>;
  const successCount = record.success_count;
  const totalCount = record.total_count;
  if (
    typeof successCount === "number" &&
    typeof totalCount === "number" &&
    Number.isFinite(successCount) &&
    Number.isFinite(totalCount) &&
    totalCount > 0
  ) {
    return [Math.trunc(successCount), Math.trunc(totalCount)];
  }
  return null;
};

export const extractOverallScore = (score: unknown): number | null => {
  if (score === null || score === undefined) return null;
  if (typeof score === "number" && Number.isFinite(score)) return score;
  if (typeof score === "boolean" || typeof score !== "object" || Array.isArray(score)) {
    return null;
  }

  const record = score as Record<string, unknown>;
  for (const key of ["aggregate_score", "overall_score"]) {
    if (key in record) {
      const extracted = extractOverallScore(record[key]);
      if (extracted !== null) return extracted;
    }
  }

  const aggregate = record.aggregate;
  if (aggregate && typeof aggregate === "object" && !Array.isArray(aggregate)) {
    const aggregateRecord = aggregate as Record<string, unknown>;
    if ("value" in aggregateRecord) {
      const extracted = extractOverallScore(aggregateRecord.value);
      if (extracted !== null) return extracted;
    }
    const counts = extractBooleanScoreCounts(score);
    if (counts) return counts[0] / counts[1];
  }

  const columns = record.columns;
  if (Array.isArray(columns) && columns.length) {
    const values = columns
      .map((column) =>
        column && typeof column === "object"
          ? extractOverallScore((column as Record<string, unknown>).score)
          : null
      )
      .filter((value): value is number => value !== null);
    if (values.length) {
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }

  const nested = record.score;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedRecord = nested as Record<string, unknown>;
    if ("score" in nestedRecord) return extractOverallScore(nestedRecord.score);
    if ("value" in nestedRecord) return extractOverallScore(nestedRecord.value);
    return extractOverallScore(nested);
  }
  if ("score" in record) return extractOverallScore(record.score);
  return null;
};
