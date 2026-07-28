import {
  EvalScorerColumn,
  ResourceId,
  Column,
} from "@/types";
import * as tablesApi from "@/tables/api";
import { apiError, timeoutError } from "./errors";
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SCORE_WAIT_TIMEOUT_MS,
  columnsByTitle,
  sleep,
  stripSdkOnlyConfig,
} from "./utils";
import {
  codeReferencesColumnTitle,
  resolveConfigSourcesToColumnIds,
  scorerDependenciesFromConfig,
} from "./validation";

const DEFAULT_AGGREGATION = {
  method: "weighted_mean",
  required_step_failure_behavior: "fail",
  pass_threshold: 0.8,
  warn_threshold: 0.6,
};

const ACTIVE_CALCULATION_STATUSES = new Set(["queued", "running"]);
const TERMINAL_CALCULATION_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const inferCodeExecutionSourceIds = (
  code: unknown,
  columnsByTitleMap: Record<string, Column>
): string[] => {
  if (typeof code !== "string" || !code.trim()) {
    return Object.values(columnsByTitleMap).map((column) => String(column.id));
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [title, column] of Object.entries(columnsByTitleMap)) {
    if (codeReferencesColumnTitle(code, title)) {
      const id = String(column.id);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  if (ids.length) return ids;
  return Object.values(columnsByTitleMap).map((column) => String(column.id));
};

export const buildScorecardStepsFromScorers = (
  scorers: EvalScorerColumn[],
  columns: Column[]
): Array<Record<string, unknown>> => {
  const byTitle = columnsByTitle(columns);
  return scorers.map((scorer, index) => {
    const primitiveType = String(scorer.type).toUpperCase();
    const authorConfig = stripSdkOnlyConfig(scorer.config) ?? {};
    const dependencies = scorerDependenciesFromConfig(
      scorer.config,
      byTitle
    );
    let sourceColumnIds = dependencies.map((dependency) =>
      String(dependency.column_id)
    );
    if (primitiveType === "CODE_EXECUTION" && !sourceColumnIds.length) {
      sourceColumnIds = inferCodeExecutionSourceIds(
        authorConfig.code,
        byTitle
      );
    }
    // Persist column IDs (not titles) so the Scorecard UI can resolve sources.
    const primitiveConfig = resolveConfigSourcesToColumnIds(
      authorConfig,
      byTitle
    );

    const step: Record<string, unknown> = {
      title: scorer.title,
      primitive_type: primitiveType,
      primitive_config: primitiveConfig,
      order_index: index,
      weight: scorer.weight !== undefined ? Number(scorer.weight) : 1,
      required: Boolean(scorer.required),
    };
    if (scorer.thresholds) {
      step.thresholds = { ...scorer.thresholds };
    }
    if (sourceColumnIds.length) {
      step.source_column_ids = sourceColumnIds;
    }
    return step;
  });
};

export const configureScorecardFromScorers = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  columns: Column[],
  scorers: EvalScorerColumn[],
  name: string
): Promise<Record<string, unknown>> => {
  const steps = buildScorecardStepsFromScorers(scorers, columns);
  const response = await tablesApi.configureSheetScorecard(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    {
      name: name || "Evaluation",
      evaluated_column_ids: [],
      aggregation: { ...DEFAULT_AGGREGATION },
      steps,
    }
  );
  if (!response?.scorecard) {
    throw apiError("Failed to configure scorecard evaluators for this eval.");
  }
  return response;
};

const isTerminalScorecardResponse = (
  payload: Record<string, unknown> | null
): boolean => {
  if (!payload) return false;
  const latest =
    payload.latest_calculation &&
    typeof payload.latest_calculation === "object"
      ? (payload.latest_calculation as Record<string, unknown>)
      : null;
  const latestStatus =
    latest?.status != null ? String(latest.status).toLowerCase() : null;
  if (latestStatus && ACTIVE_CALCULATION_STATUSES.has(latestStatus)) {
    return false;
  }
  if (latestStatus && TERMINAL_CALCULATION_STATUSES.has(latestStatus)) {
    return true;
  }
  const scorecard =
    payload.scorecard && typeof payload.scorecard === "object"
      ? (payload.scorecard as Record<string, unknown>)
      : null;
  const status =
    scorecard?.status != null ? String(scorecard.status).toLowerCase() : null;
  return (
    status === "completed" ||
    status === "failed" ||
    status === "stale" ||
    status === "ready"
  );
};

export type ScorecardProgressReporter = (
  completed: number,
  total: number,
  failed?: number
) => void;

export const recalculateAndWaitScorecard = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  options: {
    timeoutMs?: number;
    pollIntervalMs?: number;
    onProgress?: ScorecardProgressReporter;
  } = {}
): Promise<Record<string, unknown>> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCORE_WAIT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const recalculate = await tablesApi.recalculateSheetScorecard(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    {}
  );
  if (!recalculate?.calculation_id) {
    throw apiError("Failed to start scorecard recalculation for this eval.");
  }
  const calculationId = String(recalculate.calculation_id);

  const startedAt = performance.now();
  let payload: Record<string, unknown> | null = null;
  while (true) {
    payload = await tablesApi.getSheetScorecard(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId
    );
    const progress =
      payload?.progress && typeof payload.progress === "object"
        ? (payload.progress as Record<string, unknown>)
        : null;
    if (
      progress &&
      typeof progress.scored_rows === "number" &&
      typeof progress.total_rows === "number"
    ) {
      options.onProgress?.(progress.scored_rows, progress.total_rows, 0);
    }

    const latest =
      payload?.latest_calculation &&
      typeof payload.latest_calculation === "object"
        ? (payload.latest_calculation as Record<string, unknown>)
        : null;
    if (
      latest?.id != null &&
      String(latest.id) !== calculationId &&
      !isTerminalScorecardResponse(payload)
    ) {
      // Wait until the calculation we started is visible.
    } else if (isTerminalScorecardResponse(payload)) {
      if (!payload) {
        throw apiError("Scorecard calculation returned an empty response.");
      }
      return payload;
    }

    if (performance.now() - startedAt >= timeoutMs) {
      throw timeoutError(
        "Timed out waiting for scorecard calculation to finish."
      );
    }
    await sleep(pollIntervalMs);
  }
};

const mapStepResultToScoreValue = (
  result: Record<string, unknown> | null | undefined
): unknown => {
  if (!result) return null;
  const verdict =
    result.verdict != null ? String(result.verdict).toLowerCase() : null;
  if (verdict === "error") {
    return {
      status: "FAILED",
      error: result.error_message || result.evidence || result.raw_value || result,
    };
  }
  if (result.raw_value !== undefined && result.raw_value !== null) {
    return result.raw_value;
  }
  if (typeof result.score === "number") {
    return result.score;
  }
  if (verdict === "pass") return true;
  if (verdict === "fail" || verdict === "warn") return false;
  return result;
};

export const extractScorecardScorerOutputs = (
  rowPayload: Record<string, unknown> | null | undefined,
  steps: Array<Record<string, unknown>>
): Record<string, unknown> => {
  const outputs: Record<string, unknown> = {};
  const stepResults =
    rowPayload?.step_results && typeof rowPayload.step_results === "object"
      ? (rowPayload.step_results as Record<string, Record<string, unknown>>)
      : {};
  const byId = new Map(
    steps
      .filter((step) => step.id != null && step.title != null)
      .map((step) => [String(step.id), String(step.title)])
  );

  for (const [stepId, title] of byId.entries()) {
    outputs[title] = mapStepResultToScoreValue(stepResults[stepId]);
  }

  // Fall back to title-keyed step results if the API ever returns them that way.
  for (const step of steps) {
    const title = step.title != null ? String(step.title) : null;
    if (!title || title in outputs) continue;
    if (stepResults[title]) {
      outputs[title] = mapStepResultToScoreValue(stepResults[title]);
    }
  }
  return outputs;
};

export const fetchScorecardRowScores = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  rowIndices: Array<number | null>,
  scorecardPayload: Record<string, unknown>
): Promise<Record<number, Record<string, unknown>>> => {
  const scorecard =
    scorecardPayload.scorecard && typeof scorecardPayload.scorecard === "object"
      ? (scorecardPayload.scorecard as Record<string, unknown>)
      : {};
  const steps = Array.isArray(scorecard.steps)
    ? (scorecard.steps as Array<Record<string, unknown>>)
    : [];
  const latest =
    scorecardPayload.latest_calculation &&
    typeof scorecardPayload.latest_calculation === "object"
      ? (scorecardPayload.latest_calculation as Record<string, unknown>)
      : null;
  const calculationId =
    latest?.id != null ? String(latest.id) : undefined;

  const scoresByRow: Record<number, Record<string, unknown>> = {};
  for (const rowIndex of rowIndices) {
    if (rowIndex == null) continue;
    const rowPayload = await tablesApi.getSheetScorecardRow(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      rowIndex,
      calculationId ? { calculation_id: calculationId } : {}
    );
    scoresByRow[rowIndex] = extractScorecardScorerOutputs(rowPayload, steps);
  }
  return scoresByRow;
};

export const extractScorecardOverallScore = (
  scorecardPayload: Record<string, unknown> | null | undefined
): number | null => {
  if (!scorecardPayload) return null;
  const latest =
    scorecardPayload.latest_calculation &&
    typeof scorecardPayload.latest_calculation === "object"
      ? (scorecardPayload.latest_calculation as Record<string, unknown>)
      : null;
  if (typeof latest?.aggregate_score === "number") {
    return latest.aggregate_score;
  }
  const progress =
    scorecardPayload.progress && typeof scorecardPayload.progress === "object"
      ? (scorecardPayload.progress as Record<string, unknown>)
      : null;
  if (typeof progress?.partial_score === "number") {
    return progress.partial_score;
  }
  return null;
};
