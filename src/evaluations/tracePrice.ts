import * as tablesApi from "@/tables/api";
import { sleep } from "./utils";

const TRACE_PRICE_MAX_WAIT_MS = 5000;
const TRACE_PRICE_DELAYS_MS = [1000, 2000, 2000] as const;

const isNumericPrice = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const requestLogIdsFromTracePayload = (payload: unknown): number[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const spans = (payload as { spans?: unknown }).spans;
  if (!Array.isArray(spans)) {
    return [];
  }
  const requestLogIds: number[] = [];
  for (const span of spans) {
    if (!span || typeof span !== "object") {
      continue;
    }
    const requestLogId = (span as { request_log_id?: unknown }).request_log_id;
    if (typeof requestLogId === "boolean" || requestLogId == null) {
      continue;
    }
    const parsed = Number(requestLogId);
    if (!Number.isInteger(parsed) || requestLogIds.includes(parsed)) {
      continue;
    }
    requestLogIds.push(parsed);
  }
  return requestLogIds;
};

const traceHasRequestPrice = async (
  apiKey: string,
  baseURL: string,
  traceId: string
): Promise<boolean> => {
  if (!traceId) {
    return false;
  }
  const tracePayload = await tablesApi.getTrace(apiKey, baseURL, false, traceId);
  const requestLogIds = requestLogIdsFromTracePayload(tracePayload);
  if (requestLogIds.length === 0) {
    return false;
  }
  for (const requestLogId of requestLogIds) {
    const requestPayload = await tablesApi.getRequest(
      apiKey,
      baseURL,
      false,
      requestLogId
    );
    if (
      requestPayload &&
      typeof requestPayload === "object" &&
      isNumericPrice((requestPayload as { price?: unknown }).price)
    ) {
      return true;
    }
  }
  return false;
};

export const waitForTraceRequestPrice = async (
  apiKey: string,
  baseURL: string,
  traceId: string,
  options?: {
    maxWaitMs?: number;
    delaysMs?: readonly number[];
  }
): Promise<void> => {
  const maxWaitMs = options?.maxWaitMs ?? TRACE_PRICE_MAX_WAIT_MS;
  const delaysMs = options?.delaysMs ?? TRACE_PRICE_DELAYS_MS;
  const deadline = Date.now() + maxWaitMs;
  for (const delay of delaysMs) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(delay, remaining));
    if (await traceHasRequestPrice(apiKey, baseURL, traceId)) {
      return;
    }
  }
};
