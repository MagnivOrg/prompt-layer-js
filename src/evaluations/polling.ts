import {
  ResourceId,
  Column,
} from "@/types";
import * as tablesApi from "@/tables/api";
import {
  DEFAULT_CELL_WAIT_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  serializeCellValue,
  sleep,
} from "./utils";
import { apiError, timeoutError } from "./errors";

export type CellProgressReporter = (
  completed: number,
  total: number,
  failed?: number,
  status?: string | null
) => void;

export const fillRowCells = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  row: Record<string, unknown>,
  columnsByTitleMap: Record<string, Column>,
  valuesByTitle: Record<string, unknown>
): Promise<void> => {
  const cells = (row.cells as Record<string, unknown>) || {};
  for (const [title, value] of Object.entries(valuesByTitle)) {
    const column = columnsByTitleMap[title];
    if (!column) continue;
    const cell = cells[String(column.id)];
    const cellId =
      cell && typeof cell === "object"
        ? (cell as Record<string, unknown>).id
        : null;
    if (cellId == null) continue;
    const serialized = serializeCellValue(
      value !== null && value !== undefined ? value : ""
    );
    await tablesApi.updateSheetCell(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      cellId as ResourceId,
      { value: serialized, display_value: String(serialized) }
    );
  }
};

const TERMINAL_OPERATION_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const nonNegativeInt = (value: unknown): number | null => {
  if (typeof value === "boolean") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.trunc(parsed);
};

const statusCount = (
  counts: Record<string, unknown>,
  status: string
): number | null => {
  const value = counts[status] ?? counts[status.toLowerCase()];
  return nonNegativeInt(value ?? 0);
};

/**
 * Unwrap GET /operations/:id which returns `{ success: true, operation: {...} }`.
 * CREATE responses keep a string `operation` field (`"recalculate"`).
 */
export const normalizeOperationStatusPayload = (
  payload: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined => {
  if (!payload || typeof payload !== "object") return payload;
  const nested = payload.operation;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return payload;
};

export const operationIsTerminal = (
  payload: Record<string, unknown> | null | undefined
): boolean => {
  const normalized = normalizeOperationStatusPayload(payload);
  if (!normalized || typeof normalized !== "object") return false;
  const status =
    typeof normalized.status === "string" ? normalized.status.toLowerCase() : null;
  if (status && TERMINAL_OPERATION_STATUSES.has(status)) {
    return true;
  }
  const pending = nonNegativeInt(normalized.pending_count);
  const completed = nonNegativeInt(normalized.completed_count);
  const failed = nonNegativeInt(normalized.failed_count);
  const cellCount = nonNegativeInt(normalized.cell_count);
  if (
    pending === null ||
    completed === null ||
    failed === null ||
    cellCount === null
  ) {
    return false;
  }
  if (pending > 0) return false;
  return completed + failed >= cellCount;
};

const operationIdsFromCreateResponse = (
  payload: Record<string, unknown> | null | undefined
): string[] => {
  if (!payload || typeof payload !== "object") return [];
  const ids: string[] = [];
  const executionIds = payload.execution_ids;
  if (Array.isArray(executionIds)) {
    for (const item of executionIds) {
      if (item != null && String(item).trim()) ids.push(String(item));
    }
  }
  for (const key of ["operation_id", "execution_id"] as const) {
    const value = payload[key];
    if (value != null && String(value).trim()) ids.push(String(value));
  }
  return [...new Set(ids)];
};

const reportOperationCellProgress = (
  payload: Record<string, unknown> | null | undefined,
  onProgress?: CellProgressReporter
): void => {
  if (!onProgress) return;
  const normalized = normalizeOperationStatusPayload(payload);
  if (!normalized || typeof normalized !== "object") return;

  let completed = nonNegativeInt(normalized.completed_count);
  let failed = nonNegativeInt(normalized.failed_count);
  let total = nonNegativeInt(normalized.cell_count);
  const counts =
    (normalized.status_counts as Record<string, unknown> | undefined) ??
    (normalized.counts as Record<string, unknown> | undefined);

  if (counts && typeof counts === "object") {
    const completedFromCounts = statusCount(counts, "COMPLETED");
    const failedFromCounts = statusCount(counts, "FAILED");
    if (completed === null && completedFromCounts !== null) {
      completed = completedFromCounts;
    }
    if (failed === null && failedFromCounts !== null) {
      failed = failedFromCounts;
    }
    if (total === null) {
      const present = Object.values(counts)
        .map((value) => nonNegativeInt(value))
        .filter((value): value is number => value !== null);
      if (present.length) total = present.reduce((sum, value) => sum + value, 0);
    }
  }

  const pending = nonNegativeInt(normalized.pending_count);
  if (
    total === null &&
    completed !== null &&
    failed !== null &&
    pending !== null
  ) {
    total = completed + failed + pending;
  }

  const status =
    typeof normalized.status === "string" && normalized.status.trim()
      ? normalized.status
      : null;
  if (total === null && completed === null && !status) return;
  onProgress((completed ?? 0) + (failed ?? 0), total ?? 0, failed ?? 0, status);
};

export const waitForSheetOperations = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  args: {
    columnIds: string[];
    rowIds?: number[] | null;
    timeoutMs?: number;
    pollIntervalMs?: number;
    onProgress?: CellProgressReporter;
  }
): Promise<Record<string, unknown> | null> => {
  if (!args.columnIds.length) return null;
  const createResponse = await tablesApi.createSheetOperation(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    {
      operation: "recalculate",
      column_ids: args.columnIds,
      row_ids: args.rowIds ?? undefined,
    }
  );
  reportOperationCellProgress(createResponse, args.onProgress);
  const operationIds = operationIdsFromCreateResponse(createResponse);
  if (!operationIds.length) {
    const cellCount = nonNegativeInt(createResponse?.cell_count) ?? 0;
    args.onProgress?.(cellCount, cellCount, 0, "completed");
    return createResponse;
  }

  const timeoutMs = args.timeoutMs ?? DEFAULT_CELL_WAIT_TIMEOUT_MS;
  let last: Record<string, unknown> | null = null;
  for (const operationId of operationIds) {
    const startedAt = performance.now();
    let delay = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    while (true) {
      const raw = await tablesApi.getSheetOperation(
        apiKey,
        baseURL,
        throwOnError,
        tableId,
        sheetId,
        operationId
      );
      last = normalizeOperationStatusPayload(raw) ?? null;
      reportOperationCellProgress(last, args.onProgress);
      if (operationIsTerminal(last)) break;
      if (performance.now() - startedAt >= timeoutMs) {
        throw timeoutError(
          "Timed out waiting for supporting column computation to finish."
        );
      }
      await sleep(delay);
      delay = Math.min(2_000, delay * 1.5);
    }

    const status =
      typeof last?.status === "string" ? last.status.toLowerCase() : "";
    if (status === "failed") {
      throw apiError(
        `Supporting column operation ${operationId} failed while computing preprocessing columns.`
      );
    }
    if (status === "cancelled") {
      throw apiError(
        `Supporting column operation ${operationId} was cancelled while computing preprocessing columns.`
      );
    }
  }
  return last;
};
