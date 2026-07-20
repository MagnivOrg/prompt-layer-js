export const skillCollectionsEndpoint = (baseURL: string): string =>
  `${baseURL}/api/public/v2/skill-collections`;

export const skillCollectionEndpoint = (
  baseURL: string,
  identifier: string
): string => `${skillCollectionsEndpoint(baseURL)}/${encodeURIComponent(identifier)}`;

export const skillCollectionVersionsEndpoint = (
  baseURL: string,
  identifier: string
): string => `${skillCollectionEndpoint(baseURL, identifier)}/versions`;

const encodeId = (id: string | number): string =>
  encodeURIComponent(String(id));

export const tablesEndpoint = (baseURL: string): string =>
  `${baseURL}/api/public/v2/tables`;

export const tableEndpoint = (
  baseURL: string,
  tableId: string | number
): string => `${tablesEndpoint(baseURL)}/${encodeId(tableId)}`;

export const tableSheetsEndpoint = (
  baseURL: string,
  tableId: string | number
): string => `${tableEndpoint(baseURL, tableId)}/sheets`;

export const tableSheetEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string => `${tableSheetsEndpoint(baseURL, tableId)}/${encodeId(sheetId)}`;

export const tableSheetRowsEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string => `${tableSheetEndpoint(baseURL, tableId, sheetId)}/rows`;

export const tableSheetColumnsEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string => `${tableSheetEndpoint(baseURL, tableId, sheetId)}/columns`;

export const tableSheetColumnEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number,
  columnId: string | number
): string =>
  `${tableSheetColumnsEndpoint(baseURL, tableId, sheetId)}/${encodeId(columnId)}`;

export const tableSheetCellEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number,
  cellId: string | number
): string =>
  `${tableSheetEndpoint(baseURL, tableId, sheetId)}/cells/${encodeId(cellId)}`;

export const tableSheetCellsRecalculationsEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string =>
  `${tableSheetEndpoint(baseURL, tableId, sheetId)}/cells/recalculations`;

export const tableSheetCellRecalculationEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number,
  cellId: string | number
): string =>
  `${tableSheetCellEndpoint(baseURL, tableId, sheetId, cellId)}/recalculations`;

export const tableSheetVersionsEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string => `${tableSheetEndpoint(baseURL, tableId, sheetId)}/versions`;

export const tableSheetVersionEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number,
  versionId: string | number
): string =>
  `${tableSheetVersionsEndpoint(baseURL, tableId, sheetId)}/${encodeId(versionId)}`;

export const tableSheetScoreHistoryEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string =>
  `${tableSheetVersionsEndpoint(baseURL, tableId, sheetId)}/score-history`;

export const tableSheetScoreEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string => `${tableSheetEndpoint(baseURL, tableId, sheetId)}/score`;

export const tableSheetScorecardEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number,
  ...parts: Array<string | number>
): string => {
  const base = `${tableSheetEndpoint(baseURL, tableId, sheetId)}/scorecard`;
  if (!parts.length) return base;
  return `${base}/${parts.map((part) => encodeId(part)).join("/")}`;
};

export const tableSheetStatusCountsEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string => `${tableSheetEndpoint(baseURL, tableId, sheetId)}/status-counts`;

export const tableSheetOperationsEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number
): string => `${tableSheetEndpoint(baseURL, tableId, sheetId)}/operations`;

export const tableSheetOperationEndpoint = (
  baseURL: string,
  tableId: string | number,
  sheetId: string | number,
  operationId: string | number
): string =>
  `${tableSheetOperationsEndpoint(baseURL, tableId, sheetId)}/${encodeId(operationId)}`;

export const addTraceEndpoint = (baseURL: string): string =>
  `${baseURL}/api/public/v2/dataset-versions/add-trace`;
