import {
  EvalCase,
  EvalDataset,
  EvalScorerColumn,
  ResourceId,
  Column,
  Sheet,
  Table,
} from "@/types";
import * as tablesApi from "@/tables/api";
import {
  emptySheetCreateBody,
  extractColumns,
  extractSheets,
} from "@/tables/helpers";
import {
  BASE_TEXT_COLUMNS,
  DATASET_TEXT_COLUMNS,
  EXPECTED_TRACE_COLUMN,
  LEGACY_COLUMN_TITLES,
  TRACE_TEXT_COLUMNS,
  blankRowIndices,
  buildScorerColumnBody,
  casesFromRows,
  columnsByTitle,
  findScaffoldColumn,
  mergeColumn,
} from "./utils";
import { apiError, notFoundError } from "./errors";
import { scorerDependenciesFromConfig } from "./validation";

export const clearBlankScaffoldRows = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId
): Promise<void> => {
  const rowsPayload = await tablesApi.listSheetRows(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    { order: "asc", limit: 20, include_columns: false }
  );
  const blankIndices = blankRowIndices(rowsPayload);
  if (!blankIndices.length) return;
  await tablesApi.deleteSheetRows(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    { row_indices: blankIndices }
  );
};

const repurposeScaffoldColumn = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  existing: Column[],
  desiredTitle: string
): Promise<Column | null> => {
  const byTitle = columnsByTitle(existing);
  if (desiredTitle in byTitle) return byTitle[desiredTitle];
  const scaffold = findScaffoldColumn(existing);
  if (!scaffold) return null;
  const updateResponse = await tablesApi.updateSheetColumn(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    scaffold.id,
    { title: desiredTitle }
  );
  const updated = updateResponse?.column || scaffold;
  return { ...updated, title: desiredTitle };
};

export const ensureNamedTextColumns = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  existing: Column[],
  titles: readonly string[]
): Promise<Column[]> => {
  let byTitle = columnsByTitle(existing);
  let columns = [...existing];
  for (const title of titles) {
    if (title in byTitle) continue;
    const legacyTitle = LEGACY_COLUMN_TITLES[title];
    if (legacyTitle && legacyTitle in byTitle) {
      byTitle[title] = byTitle[legacyTitle];
      continue;
    }
    const repurposed = await repurposeScaffoldColumn(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      columns,
      title
    );
    if (repurposed) {
      columns = mergeColumn(columns, repurposed);
      byTitle = columnsByTitle(columns);
      continue;
    }
    const createResponse = await tablesApi.createSheetColumn(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      {
        title,
        type: "TEXT",
      }
    );
    if (!createResponse?.column) {
      throw apiError(`Failed to create eval column '${title}'.`);
    }
    columns.push(createResponse.column);
    byTitle[title] = createResponse.column;
  }
  return columns;
};

export const ensureTextColumns = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  existing: Column[],
  includeTraceColumns = false
): Promise<Column[]> => {
  const titles = [
    ...BASE_TEXT_COLUMNS,
    ...(includeTraceColumns ? TRACE_TEXT_COLUMNS : []),
  ];
  return ensureNamedTextColumns(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    existing,
    titles
  );
};

export const ensureCustomTextColumns = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  existing: Column[],
  titles: readonly string[]
): Promise<Column[]> => {
  const byTitle = columnsByTitle(existing);
  for (const title of titles) {
    const column = byTitle[title];
    if (
      column &&
      (column.type !== "TEXT" || Boolean(column.is_output_column))
    ) {
      throw apiError(
        `Eval dataset field '${title}' conflicts with an existing non-TEXT or generated column.`
      );
    }
  }
  return ensureNamedTextColumns(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    existing,
    titles
  );
};

export const ensureProcessingColumns = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  existing: Column[],
  processingColumns: EvalScorerColumn[]
): Promise<Column[]> => {
  let byTitle = columnsByTitle(existing);
  const columns = [...existing];
  for (const definition of processingColumns) {
    const title = definition.title;
    const dependencies = scorerDependenciesFromConfig(
      definition.config,
      byTitle,
      "column"
    );
    if (title in byTitle) continue;
    const body = buildScorerColumnBody(definition, dependencies);
    const createResponse = await tablesApi.createSheetColumn(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      body
    );
    if (!createResponse?.column) {
      throw apiError(`Failed to create supporting column '${title}'.`);
    }
    columns.push(createResponse.column);
    byTitle[title] = createResponse.column;
  }
  return columns;
};

/**
 * Create the full eval column scaffold in declaration order:
 * input/expected → expectedTrace → custom dataset fields → Output/Trace
 * → supporting columns.
 */
export const ensureEvalScaffoldColumns = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  sheetId: ResourceId,
  existing: Column[],
  args: {
    includeTraceColumns?: boolean;
    includeExpectedTrace?: boolean;
    customFieldTitles?: string[];
    processingColumns?: EvalScorerColumn[];
  } = {}
): Promise<Column[]> => {
  let columns = await ensureNamedTextColumns(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    existing,
    DATASET_TEXT_COLUMNS
  );
  if (args.includeExpectedTrace) {
    columns = await ensureNamedTextColumns(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      columns,
      [EXPECTED_TRACE_COLUMN]
    );
  }
  if (args.customFieldTitles?.length) {
    columns = await ensureCustomTextColumns(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      columns,
      args.customFieldTitles
    );
  }
  columns = await ensureNamedTextColumns(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId,
    columns,
    [
      "Output",
      ...(args.includeTraceColumns ? TRACE_TEXT_COLUMNS : []),
    ]
  );
  if (args.processingColumns?.length) {
    columns = await ensureProcessingColumns(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId,
      columns,
      args.processingColumns
    );
  }
  return columns;
};

export const resolveTable = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  args: {
    name: string;
    tableId: ResourceId | null;
    folderId: number | null;
  }
): Promise<Table> => {
  if (args.tableId != null) {
    const response = await tablesApi.getTable(
      apiKey,
      baseURL,
      throwOnError,
      args.tableId
    );
    if (response?.table) return response.table;
    throw notFoundError(`Table '${args.tableId}' was not found.`);
  }
  const table = await tablesApi.upsertTableByTitle(
    apiKey,
    baseURL,
    throwOnError,
    args.name,
    args.folderId ?? undefined
  );
  if (!table) throw apiError(`Failed to upsert table '${args.name}'.`);
  return table;
};

const EXPERIMENT_NUMBER_RE = /^Experiment #(\d+)$/;

const sheetTitles = (sheets: Sheet[]): Set<string> =>
  new Set(
    sheets
      .map((sheet) => sheet.title)
      .filter((title): title is string => Boolean(title))
      .map(String)
  );

export const nextUniqueSheetTitle = (
  existingTitles: Set<string>,
  baseTitle: string
): string => {
  if (!existingTitles.has(baseTitle)) return baseTitle;
  let suffix = 2;
  while (existingTitles.has(`${baseTitle} #${suffix}`)) suffix += 1;
  return `${baseTitle} #${suffix}`;
};

export const nextExperimentNumberTitle = (
  existingTitles: Set<string>,
  sheetCountHint = 0
): string => {
  const usedNumbers = new Set<number>();
  for (const title of existingTitles) {
    const match = EXPERIMENT_NUMBER_RE.exec(title);
    if (match) usedNumbers.add(Number(match[1]));
  }
  let candidate = Math.max(sheetCountHint + 1, 1);
  while (
    usedNumbers.has(candidate) ||
    existingTitles.has(`Experiment #${candidate}`)
  ) {
    candidate += 1;
  }
  return `Experiment #${candidate}`;
};

const createSheet = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  title: string
): Promise<Sheet> => {
  const createResponse = await tablesApi.createSheet(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    emptySheetCreateBody(title)
  );
  if (!createResponse?.sheet) {
    throw apiError(`Failed to create experiment sheet '${title}'.`);
  }
  return createResponse.sheet;
};

const defaultScaffoldSheet = (sheets: Sheet[]): Sheet | null => {
  if (sheets.length === 1 && sheets[0]?.title === "Sheet 1") return sheets[0];
  return null;
};

export const resolveSheet = async (
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  tableId: ResourceId,
  args: {
    sheetId?: ResourceId | null;
    experimentName?: string | null;
    /** When true and the table has only the default "Sheet 1", rename and reuse it. */
    reuseDefaultSheet?: boolean;
  }
): Promise<Sheet> => {
  const listResponse = await tablesApi.listSheets(
    apiKey,
    baseURL,
    throwOnError,
    tableId
  );
  const sheets = extractSheets(listResponse || {});

  if (args.sheetId != null) {
    for (const sheet of sheets) {
      if (String(sheet.id) === String(args.sheetId)) return sheet;
    }
    throw notFoundError(`Sheet '${args.sheetId}' was not found.`);
  }

  const scaffold = args.reuseDefaultSheet
    ? defaultScaffoldSheet(sheets)
    : null;
  const titles = sheetTitles(scaffold ? [] : sheets);
  const title = args.experimentName
    ? nextUniqueSheetTitle(titles, args.experimentName.trim())
    : nextExperimentNumberTitle(titles, titles.size);

  if (scaffold) {
    const updateResponse = await tablesApi.updateSheet(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      scaffold.id,
      { title }
    );
    const updated = updateResponse?.sheet;
    if (!updated) {
      throw apiError(`Failed to prepare experiment sheet '${title}'.`);
    }
    return updated;
  }
  return createSheet(apiKey, baseURL, throwOnError, tableId, title);
};

export const resolveCases = async <TInput>(
  apiKey: string,
  baseURL: string,
  throwOnError: boolean,
  dataset: EvalDataset<TInput>
): Promise<EvalCase<TInput>[]> => {
  if (Array.isArray(dataset)) return [...dataset];

  const tableId = dataset.tableId;
  if (tableId == null) {
    throw notFoundError("Eval dataset table reference requires tableId.");
  }
  let sheetId = dataset.sheetId;
  if (sheetId == null) {
    const sheet = await tablesApi.ensureDefaultSheet(
      apiKey,
      baseURL,
      throwOnError,
      tableId
    );
    if (!sheet) {
      throw apiError("Failed to resolve sheet for dataset table reference.");
    }
    sheetId = sheet.id;
  }

  const columnsResponse = await tablesApi.listSheetColumns(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId
  );
  const sourceColumns = extractColumns(columnsResponse || {});
  const rowsPayload = await tablesApi.listAllSheetRows(
    apiKey,
    baseURL,
    throwOnError,
    tableId,
    sheetId
  );
  return casesFromRows<TInput>(rowsPayload, sourceColumns);
};
