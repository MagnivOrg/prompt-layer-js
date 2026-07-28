import {
  AddTableRows,
  AddTraceImport,
  BatchRecalculateCells,
  ConfigureSheetScore,
  CreateColumn,
  CreateSheet,
  CreateSheetFileSource,
  CreateSheetVersion,
  CreateTable,
  DeleteSheetRows,
  ListTablesParams,
  Column,
  Sheet,
  Table,
  UpdateCell,
  UpdateColumn,
  UpdateSheet,
  UpdateTable,
} from "@/types";

export const omitUndefined = <T extends Record<string, unknown>>(
  obj: T
): Partial<T> =>
  Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
  ) as Partial<T>;

export const extractTables = (data: Record<string, unknown> | null | undefined): Table[] =>
  listFromPayload(data, ["data", "tables", "items"]) as Table[];

export const extractSheets = (data: Record<string, unknown> | null | undefined): Sheet[] =>
  listFromPayload(data, ["data", "sheets", "items"]) as Sheet[];

export const extractColumns = (
  data: Record<string, unknown> | null | undefined
): Column[] =>
  listFromPayload(data, ["data", "columns", "items"]) as Column[];

export const extractRows = (
  data: Record<string, unknown> | null | undefined
): Record<string, unknown>[] =>
  listFromPayload(data, ["data", "rows", "items"]) as Record<string, unknown>[];

const listFromPayload = (
  data: Record<string, unknown> | null | undefined,
  keys: string[]
): unknown[] => {
  if (!data) return [];
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
  }
  return [];
};

export const buildListTablesParams = (
  params?: ListTablesParams
): Record<string, string | number> => {
  if (!params) return {};
  return omitUndefined({
    cursor: params.cursor,
    limit: params.limit,
    name: params.name,
    folder_id: params.folder_id,
    page: params.page,
    per_page: params.per_page,
  }) as Record<string, string | number>;
};

export const buildCreateTableBody = (body: CreateTable) =>
  omitUndefined({
    title: body.title,
    folder_id: body.folder_id,
  });

export const buildUpdateTableBody = (body: UpdateTable) =>
  omitUndefined({
    title: body.title,
    folder_id: body.folder_id,
  });

export const buildCreateSheetBody = (body: CreateSheet = {}) =>
  omitUndefined({
    title: body.title,
    index: body.index,
    operation_id: body.operation_id,
    source: body.source,
  });

/** Minimal file source used to create an empty experiment sheet. */
export const emptyCsvSheetSource = (
  fileName = "empty.csv"
): CreateSheetFileSource => {
  // Header-only CSV so the import succeeds without seeding eval rows.
  const content = Buffer.from("input\n", "utf8").toString("base64");
  const safeName =
    fileName.endsWith(".csv") || fileName.endsWith(".json")
      ? fileName
      : `${fileName}.csv`;
  return {
    type: "file",
    file_name: safeName,
    file_content_base64: content,
  };
};

/** Ensure a create-sheet body has a source (required by the public API). */
export const withDefaultEmptySheetSource = (
  body: CreateSheet = {}
): CreateSheet => {
  const payload: CreateSheet = { ...body };
  if (payload.source == null) {
    const title = payload.title || "Sheet 1";
    payload.source = emptyCsvSheetSource(`${title}.csv`);
  }
  return payload;
};

export const emptySheetCreateBody = (title: string): CreateSheet =>
  withDefaultEmptySheetSource({ title });

export const buildUpdateSheetBody = (body: UpdateSheet) =>
  omitUndefined({ title: body.title });

export const buildAddRowsBody = (body: AddTableRows) =>
  omitUndefined({
    count: body.count,
    values: body.values,
  });

export const buildDeleteRowsBody = (body: DeleteSheetRows) =>
  omitUndefined({ row_indices: body.row_indices });

export const buildCreateColumnBody = (body: CreateColumn) =>
  omitUndefined({
    title: body.title,
    type: body.type,
    config: body.config,
    dependencies: body.dependencies,
    is_output_column: body.is_output_column,
  });

export const buildUpdateColumnBody = (body: UpdateColumn) =>
  omitUndefined({
    title: body.title,
    type: body.type,
    config: body.config,
    dependencies: body.dependencies,
    is_output_column: body.is_output_column,
  });

export const buildUpdateCellBody = (body: UpdateCell) =>
  omitUndefined({
    display_value: body.display_value,
    value: body.value,
  });

export const buildCreateVersionBody = (body: CreateSheetVersion = {}) =>
  omitUndefined({ name: body.name });

export const buildBatchRecalculateBody = (body: BatchRecalculateCells) =>
  omitUndefined({
    cell_ids: body.cell_ids,
    column_ids: body.column_ids,
    row_indices: body.row_indices,
  });

export const buildCreateOperationBody = (body: {
  operation?: string;
  column_ids?: Array<string | number>;
  row_ids?: number[];
  statuses?: string[];
}) =>
  omitUndefined({
    operation: body.operation || "recalculate",
    column_ids: body.column_ids?.map((columnId) => String(columnId)),
    row_ids: body.row_ids,
    statuses: body.statuses,
  });

export const buildAddTraceBody = (body: AddTraceImport) => {
  const tableId = body.smart_table_id ?? body.table_id;
  return omitUndefined({
    trace_id: body.trace_id,
    sheet_id: body.sheet_id,
    smart_table_id: tableId,
    span_id: body.span_id,
    metadata: body.metadata,
  });
};

export const buildConfigureScoreBody = (body: ConfigureSheetScore) =>
  omitUndefined({ ...body });

export const parseResponseData = async (response: Response): Promise<any> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};
