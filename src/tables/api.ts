import {
  AddTableRows,
  AddTraceImport,
  BatchRecalculateCells,
  ConfigureSheetScore,
  CreateColumn,
  CreateSheet,
  CreateSheetOperation,
  CreateSheetVersion,
  CreateTable,
  DeleteSheetRows,
  ListTablesParams,
  ResourceId,
  CellResponse,
  ColumnListResponse,
  ColumnResponse,
  Sheet,
  SheetListResponse,
  SheetResponse,
  SheetVersionListResponse,
  SheetVersionResponse,
  Table,
  TableListResponse,
  TableResponse,
  TableScoreResponse,
  UpdateCell,
  UpdateColumn,
  UpdateSheet,
  UpdateTable,
} from "@/types";
import {
  addTraceEndpoint,
  tableEndpoint,
  tableSheetCellEndpoint,
  tableSheetCellRecalculationEndpoint,
  tableSheetCellsRecalculationsEndpoint,
  tableSheetColumnEndpoint,
  tableSheetColumnsEndpoint,
  tableSheetEndpoint,
  tableSheetRowsEndpoint,
  tableSheetOperationEndpoint,
  tableSheetOperationsEndpoint,
  tableSheetScoreEndpoint,
  tableSheetScoreHistoryEndpoint,
  tableSheetScorecardEndpoint,
  tableSheetStatusCountsEndpoint,
  tableSheetVersionEndpoint,
  tableSheetVersionsEndpoint,
  tableSheetsEndpoint,
  tablesEndpoint,
} from "@/utils/endpoints";
import { fetchWithRetry, getCommonHeaders, warnOnBadResponse } from "@/utils/utils";
import {
  PromptLayerAPIError,
  PromptLayerAuthenticationError,
  PromptLayerConnectionError,
  PromptLayerNotFoundError,
  PromptLayerStatusError,
  PromptLayerTimeoutError,
  PromptLayerValidationError,
} from "@/errors";
import {
  buildAddRowsBody,
  buildAddTraceBody,
  buildBatchRecalculateBody,
  buildConfigureScoreBody,
  buildCreateColumnBody,
  buildCreateOperationBody,
  buildCreateSheetBody,
  buildCreateTableBody,
  buildCreateVersionBody,
  buildDeleteRowsBody,
  buildListTablesParams,
  buildUpdateCellBody,
  buildUpdateColumnBody,
  buildUpdateSheetBody,
  buildUpdateTableBody,
  emptyCsvSheetSource,
  extractSheets,
  extractTables,
  extractRows,
  parseResponseData,
} from "./helpers";

type RequestOptions = {
  method?: string;
  params?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  expectedStatuses?: number[];
  emptyOk?: boolean;
  emptyValue?: unknown;
  action: string;
};

const headers = (apiKey: string, json = false): Record<string, string> => ({
  "X-API-KEY": apiKey,
  ...getCommonHeaders(),
  ...(json ? { "Content-Type": "application/json" } : {}),
});

const request = async (
  apiKey: string,
  throwOnError: boolean,
  url: string,
  options: RequestOptions
): Promise<any> => {
  const {
    method = "GET",
    params,
    body,
    expectedStatuses = [200],
    emptyOk = false,
    emptyValue = null,
    action,
  } = options;

  const requestUrl = new URL(url);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        requestUrl.searchParams.append(key, String(value));
      }
    });
  }

  let response: Response;
  try {
    response = await fetchWithRetry(requestUrl, {
      method,
      headers: headers(apiKey, body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (throwOnError) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || /timed? ?out/i.test(error.message))
      ) {
        throw new PromptLayerTimeoutError(
          `PromptLayer timed out while ${action}.`,
          error
        );
      }
      throw new PromptLayerConnectionError(
        `Unable to reach PromptLayer while ${action}.`,
        error
      );
    }
    console.warn(`WARNING: Unable to reach PromptLayer while ${action}.`);
    return emptyValue;
  }

  if (!expectedStatuses.includes(response.status)) {
    const data = await parseResponseData(response);
    const rawMessage = data.message || data.error;
    const errorMessage =
      rawMessage == null
        ? `PromptLayer had an error while ${action}`
        : typeof rawMessage === "string"
          ? rawMessage
          : JSON.stringify(rawMessage);
    if (throwOnError) {
      if (response.status === 401 || response.status === 403) {
        throw new PromptLayerAuthenticationError(errorMessage, response.status);
      }
      if (response.status === 404) {
        throw new PromptLayerNotFoundError(errorMessage, response.status);
      }
      if (response.status === 400 || response.status === 422) {
        throw new PromptLayerValidationError(errorMessage);
      }
      throw new PromptLayerStatusError(errorMessage, response.status);
    }
    warnOnBadResponse(response, `WARNING: ${errorMessage}`);
    return emptyValue;
  }

  if (emptyOk) {
    if (emptyValue === true) return true;
    if (response.status === 204) {
      return emptyValue ?? { success: true };
    }
    const text = await response.text();
    if (!text) return emptyValue ?? { success: true };
    try {
      return JSON.parse(text);
    } catch {
      return emptyValue ?? { success: true };
    }
  }

  return parseResponseData(response);
};

export const listTables = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  params?: ListTablesParams
): Promise<TableListResponse | null> =>
  request(apiKey, throwOnError, tablesEndpoint(baseURL), {
    action: "listing your tables",
    params: buildListTablesParams(params),
  });

export const createTable = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  body: CreateTable
): Promise<TableResponse | null> =>
  request(apiKey, throwOnError, tablesEndpoint(baseURL), {
    method: "POST",
    action: "creating your table",
    expectedStatuses: [200, 201],
    body: buildCreateTableBody(body),
  });

export const getTable = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId
): Promise<TableResponse | null> =>
  request(apiKey, throwOnError, tableEndpoint(baseURL, tableId), {
    action: "getting your table",
  });

export const updateTable = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  body: UpdateTable
): Promise<TableResponse | null> =>
  request(apiKey, throwOnError, tableEndpoint(baseURL, tableId), {
    method: "PATCH",
    action: "updating your table",
    body: buildUpdateTableBody(body),
  });

export const deleteTable = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId
): Promise<boolean> => {
  const result = await request(apiKey, throwOnError, tableEndpoint(baseURL, tableId), {
    method: "DELETE",
    action: "deleting your table",
    expectedStatuses: [200, 204],
    emptyOk: true,
    emptyValue: true,
  });
  return Boolean(result);
};

export const upsertTableByTitle = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  title: string,
  folderId?: number
): Promise<Table | null> => {
  const listResponse = await listTables(apiKey, baseURL, throwOnError, {
    name: title,
    folder_id: folderId,
    limit: 100,
  });
  if (!listResponse) return null;

  for (const table of extractTables(listResponse)) {
    if (table.title === title && !table.deleted_at) {
      return table;
    }
  }

  const createResponse = await createTable(apiKey, baseURL, throwOnError, {
    title,
    folder_id: folderId,
  });
  return createResponse?.table ?? null;
};

export const listSheets = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId
): Promise<SheetListResponse | null> =>
  request(apiKey, throwOnError, tableSheetsEndpoint(baseURL, tableId), {
    action: "listing your sheets",
  });

export const createSheet = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  body: CreateSheet = {}
): Promise<SheetResponse | null> =>
  request(apiKey, throwOnError, tableSheetsEndpoint(baseURL, tableId), {
    method: "POST",
    action: "creating your sheet",
    // Create-with-import returns 202 with the new sheet + operation.
    expectedStatuses: [200, 201, 202],
    body: buildCreateSheetBody(body),
  });

export const ensureDefaultSheet = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId
): Promise<Sheet | null> => {
  const listResponse = await listSheets(apiKey, baseURL, throwOnError, tableId);
  if (!listResponse) return null;

  const sheets = extractSheets(listResponse);
  if (sheets.length > 0) return sheets[0];

  const createResponse = await createSheet(apiKey, baseURL, throwOnError, tableId, {
    title: "Sheet 1",
    source: emptyCsvSheetSource("Sheet 1.csv"),
  });
  return createResponse?.sheet ?? null;
};

export const getSheet = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<SheetResponse | null> =>
  request(apiKey, throwOnError, tableSheetEndpoint(baseURL, tableId, sheetId), {
    action: "getting your sheet",
  });

export const updateSheet = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: UpdateSheet
): Promise<SheetResponse | null> =>
  request(apiKey, throwOnError, tableSheetEndpoint(baseURL, tableId, sheetId), {
    method: "PATCH",
    action: "updating your sheet",
    body: buildUpdateSheetBody(body),
  });

export const deleteSheet = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<boolean> => {
  const result = await request(
    apiKey,
    throwOnError,
    tableSheetEndpoint(baseURL, tableId, sheetId),
    {
      method: "DELETE",
      action: "deleting your sheet",
      expectedStatuses: [200, 204],
      emptyOk: true,
      emptyValue: true,
    }
  );
  return Boolean(result);
};

export const listSheetRows = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  params?: Record<string, string | number | boolean>
): Promise<Record<string, unknown> | null> =>
  request(apiKey, throwOnError, tableSheetRowsEndpoint(baseURL, tableId, sheetId), {
    action: "listing your sheet rows",
    params,
  });

const nextCursorFrom = (
  payload: Record<string, unknown> | null
): string | null => {
  if (!payload) return null;
  const pagination = payload.pagination;
  if (!pagination || typeof pagination !== "object" || Array.isArray(pagination)) {
    return null;
  }
  const cursor = (pagination as Record<string, unknown>).next_cursor;
  return cursor ? String(cursor) : null;
};

export const listAllSheetRows = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  params: Record<string, string | number | boolean> = {}
): Promise<Record<string, unknown> | null> => {
  const query: Record<string, string | number | boolean> = { ...params };
  const rawLimit = query.limit;
  const parsedLimit =
    typeof rawLimit === "number"
      ? rawLimit
      : typeof rawLimit === "string"
        ? Number.parseInt(rawLimit, 10)
        : 100;
  query.limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 100, 100));
  delete query.cursor;

  const first = await listSheetRows(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    query
  );
  if (!first) return null;

  const merged: Record<string, unknown> = { ...first };
  const rows = [...(extractRows(first) as Record<string, unknown>[])];
  let cursor = nextCursorFrom(first);
  const seenCursors = new Set<string>();
  while (cursor) {
    if (seenCursors.has(cursor)) {
      const message = "Table row pagination returned a repeated cursor.";
      if (throwOnError) {
        throw new PromptLayerAPIError(message);
      }
      console.warn(message);
      break;
    }
    seenCursors.add(cursor);
    const pageQuery: Record<string, string | number | boolean> = {
      ...query,
      cursor,
      include_columns: false,
    };
    const page = await listSheetRows(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      pageQuery
    );
    if (!page) break;
    rows.push(...(extractRows(page) as Record<string, unknown>[]));
    merged.pagination = page.pagination;
    cursor = nextCursorFrom(page);
  }
  merged.data = rows;
  return merged;
};

export const addSheetRows = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: AddTableRows
): Promise<Record<string, unknown> | null> =>
  request(apiKey, throwOnError, tableSheetRowsEndpoint(baseURL, tableId, sheetId), {
    method: "POST",
    action: "adding your sheet rows",
    expectedStatuses: [200, 201],
    body: buildAddRowsBody(body),
  });

export const deleteSheetRows = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: DeleteSheetRows
): Promise<Record<string, unknown> | null> =>
  request(apiKey, throwOnError, tableSheetRowsEndpoint(baseURL, tableId, sheetId), {
    method: "DELETE",
    action: "deleting your sheet rows",
    expectedStatuses: [200, 204],
    emptyOk: true,
    emptyValue: { success: true },
    body: buildDeleteRowsBody(body),
  });

export const listSheetColumns = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<ColumnListResponse | null> =>
  request(apiKey, throwOnError, tableSheetColumnsEndpoint(baseURL, tableId, sheetId), {
    action: "listing your sheet columns",
  });

export const createSheetColumn = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: CreateColumn
): Promise<ColumnResponse | null> =>
  request(apiKey, throwOnError, tableSheetColumnsEndpoint(baseURL, tableId, sheetId), {
    method: "POST",
    action: "creating your sheet column",
    expectedStatuses: [200, 201],
    body: buildCreateColumnBody(body),
  });

export const updateSheetColumn = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  columnId: ResourceId,
  body: UpdateColumn
): Promise<ColumnResponse | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetColumnEndpoint(baseURL, tableId, sheetId, columnId),
    {
      method: "PATCH",
      action: "updating your sheet column",
      body: buildUpdateColumnBody(body),
    }
  );

export const deleteSheetColumn = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  columnId: ResourceId
): Promise<boolean> => {
  const result = await request(
    apiKey,
    throwOnError,
    tableSheetColumnEndpoint(baseURL, tableId, sheetId, columnId),
    {
      method: "DELETE",
      action: "deleting your sheet column",
      expectedStatuses: [200, 204],
      emptyOk: true,
      emptyValue: true,
    }
  );
  return Boolean(result);
};

export const getSheetCell = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  cellId: ResourceId
): Promise<CellResponse | null> =>
  request(apiKey, throwOnError, tableSheetCellEndpoint(baseURL, tableId, sheetId, cellId), {
    action: "getting your sheet cell",
  });

export const updateSheetCell = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  cellId: ResourceId,
  body: UpdateCell
): Promise<CellResponse | null> =>
  request(apiKey, throwOnError, tableSheetCellEndpoint(baseURL, tableId, sheetId, cellId), {
    method: "PATCH",
    action: "updating your sheet cell",
    body: buildUpdateCellBody(body),
  });

export const recalculateSheetCell = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  cellId: ResourceId
): Promise<CellResponse | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetCellRecalculationEndpoint(baseURL, tableId, sheetId, cellId),
    {
      method: "POST",
      action: "recalculating your sheet cell",
      expectedStatuses: [200, 202],
      body: {},
    }
  );

export const batchRecalculateSheetCells = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: BatchRecalculateCells
): Promise<Record<string, unknown> | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetCellsRecalculationsEndpoint(baseURL, tableId, sheetId),
    {
      method: "POST",
      action: "batch recalculating your sheet cells",
      expectedStatuses: [200, 201, 202],
      body: buildBatchRecalculateBody(body),
    }
  );

export const listSheetVersions = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<SheetVersionListResponse | null> =>
  request(apiKey, throwOnError, tableSheetVersionsEndpoint(baseURL, tableId, sheetId), {
    action: "listing your sheet versions",
  });

export const createSheetVersion = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: CreateSheetVersion = {}
): Promise<SheetVersionResponse | null> =>
  request(apiKey, throwOnError, tableSheetVersionsEndpoint(baseURL, tableId, sheetId), {
    method: "POST",
    action: "creating your sheet version",
    expectedStatuses: [200, 201],
    body: buildCreateVersionBody(body),
  });

export const getSheetVersion = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  versionId: ResourceId
): Promise<SheetVersionResponse | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetVersionEndpoint(baseURL, tableId, sheetId, versionId),
    {
      action: "getting your sheet version",
    }
  );

export const getSheetScoreHistory = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<Record<string, unknown> | null> =>
  request(apiKey, throwOnError, tableSheetScoreHistoryEndpoint(baseURL, tableId, sheetId), {
    action: "getting your sheet score history",
  });

export const getSheetScore = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<TableScoreResponse | null> =>
  request(apiKey, throwOnError, tableSheetScoreEndpoint(baseURL, tableId, sheetId), {
    action: "getting your sheet score",
  });

export const getSheetStatusCounts = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<Record<string, unknown> | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetStatusCountsEndpoint(baseURL, tableId, sheetId),
    { action: "getting your sheet status counts" }
  );

export const createSheetOperation = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: CreateSheetOperation
): Promise<Record<string, unknown> | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetOperationsEndpoint(baseURL, tableId, sheetId),
    {
      method: "POST",
      action: "starting a sheet operation",
      expectedStatuses: [200, 202],
      body: buildCreateOperationBody(body),
    }
  );

export const getSheetOperation = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  operationId: ResourceId
): Promise<Record<string, unknown> | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetOperationEndpoint(baseURL, tableId, sheetId, operationId),
    { action: "getting your sheet operation status" }
  );

export const configureSheetScore = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: ConfigureSheetScore
): Promise<TableScoreResponse | null> =>
  request(apiKey, throwOnError, tableSheetScoreEndpoint(baseURL, tableId, sheetId), {
    method: "PATCH",
    action: "configuring your sheet score",
    body: buildConfigureScoreBody(body),
  });

export const recalculateSheetScore = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<TableScoreResponse | null> =>
  request(apiKey, throwOnError, tableSheetScoreEndpoint(baseURL, tableId, sheetId), {
    method: "POST",
    action: "recalculating your sheet score",
    expectedStatuses: [200, 202],
    body: {},
  });

export const getSheetScorecard = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<Record<string, unknown> | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetScorecardEndpoint(baseURL, tableId, sheetId),
    { action: "fetching your sheet scorecard" }
  );

export const configureSheetScorecard = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: Record<string, unknown>
): Promise<Record<string, unknown> | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetScorecardEndpoint(baseURL, tableId, sheetId),
    {
      method: "PATCH",
      action: "configuring your sheet scorecard",
      body,
    }
  );

export const recalculateSheetScorecard = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  body: Record<string, unknown> = {}
): Promise<Record<string, unknown> | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetScorecardEndpoint(baseURL, tableId, sheetId, "recalculate"),
    {
      method: "POST",
      action: "recalculating your sheet scorecard",
      expectedStatuses: [200, 202],
      body,
    }
  );

export const getSheetScorecardRow = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  rowIndex: number,
  params: Record<string, string | number | boolean> = {}
): Promise<Record<string, unknown> | null> =>
  request(
    apiKey,
    throwOnError,
    tableSheetScorecardEndpoint(baseURL, tableId, sheetId, "rows", rowIndex),
    {
      action: "fetching your sheet scorecard row",
      params,
    }
  );

export const addTraceImport = (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  body: AddTraceImport
): Promise<Record<string, unknown> | null> =>
  request(apiKey, throwOnError, addTraceEndpoint(baseURL), {
    method: "POST",
    action: "importing a trace into your sheet",
    expectedStatuses: [200, 201],
    body: buildAddTraceBody(body),
  });
