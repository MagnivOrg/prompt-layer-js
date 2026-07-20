import {
  AddTableRows,
  AddTraceImport,
  BatchRecalculateCells,
  ConfigureSheetScore,
  CreateColumn,
  CreateSheet,
  CreateSheetVersion,
  CreateTable,
  DeleteSheetRows,
  ListTablesParams,
  ResourceId,
  CellResponse,
  ColumnListResponse,
  ColumnResponse,
  SheetListResponse,
  SheetResponse,
  SheetVersionListResponse,
  SheetVersionResponse,
  TableListResponse,
  TableResponse,
  TableScoreResponse,
  UpdateCell,
  UpdateColumn,
  UpdateSheet,
  UpdateTable,
} from "@/types";
import * as tablesApi from "./api";
import { withDefaultEmptySheetSource } from "./helpers";

export class TableSheetRowsManager {
  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean,
    private tableId: ResourceId,
    private sheetId: ResourceId
  ) {}

  list = (params?: Record<string, string | number | boolean>) =>
    tablesApi.listSheetRows(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      params
    );

  listAll = (params?: Record<string, string | number | boolean>) =>
    tablesApi.listAllSheetRows(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      params
    );

  add = (body: AddTableRows) =>
    tablesApi.addSheetRows(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      body
    );

  delete = (body: DeleteSheetRows) =>
    tablesApi.deleteSheetRows(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      body
    );
}

export class TableSheetColumnsManager {
  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean,
    private tableId: ResourceId,
    private sheetId: ResourceId
  ) {}

  list = (): Promise<ColumnListResponse | null> =>
    tablesApi.listSheetColumns(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId
    );

  create = (body: CreateColumn): Promise<ColumnResponse | null> =>
    tablesApi.createSheetColumn(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      body
    );

  update = (
    columnId: ResourceId,
    body: UpdateColumn
  ): Promise<ColumnResponse | null> =>
    tablesApi.updateSheetColumn(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      columnId,
      body
    );

  delete = (columnId: ResourceId): Promise<boolean> =>
    tablesApi.deleteSheetColumn(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      columnId
    );
}

export class TableSheetCellsManager {
  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean,
    private tableId: ResourceId,
    private sheetId: ResourceId
  ) {}

  get = (cellId: ResourceId): Promise<CellResponse | null> =>
    tablesApi.getSheetCell(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      cellId
    );

  update = (
    cellId: ResourceId,
    body: UpdateCell
  ): Promise<CellResponse | null> =>
    tablesApi.updateSheetCell(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      cellId,
      body
    );

  recalculate = (cellId: ResourceId): Promise<CellResponse | null> =>
    tablesApi.recalculateSheetCell(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      cellId
    );

  batchRecalculate = (
    body: BatchRecalculateCells
  ): Promise<Record<string, unknown> | null> =>
    tablesApi.batchRecalculateSheetCells(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      body
    );
}

export class TableSheetVersionsManager {
  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean,
    private tableId: ResourceId,
    private sheetId: ResourceId
  ) {}

  list = (): Promise<SheetVersionListResponse | null> =>
    tablesApi.listSheetVersions(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId
    );

  create = (
    body: CreateSheetVersion = {}
  ): Promise<SheetVersionResponse | null> =>
    tablesApi.createSheetVersion(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      body
    );

  get = (versionId: ResourceId): Promise<SheetVersionResponse | null> =>
    tablesApi.getSheetVersion(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      versionId
    );

  scoreHistory = (): Promise<Record<string, unknown> | null> =>
    tablesApi.getSheetScoreHistory(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId
    );
}

export class TableSheetScoreManager {
  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean,
    private tableId: ResourceId,
    private sheetId: ResourceId
  ) {}

  get = (): Promise<TableScoreResponse | null> =>
    tablesApi.getSheetScore(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId
    );

  configure = (
    body: ConfigureSheetScore
  ): Promise<TableScoreResponse | null> =>
    tablesApi.configureSheetScore(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      body
    );

  recalculate = (): Promise<TableScoreResponse | null> =>
    tablesApi.recalculateSheetScore(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId
    );
}

export class TableSheetManager {
  rows: TableSheetRowsManager;
  columns: TableSheetColumnsManager;
  cells: TableSheetCellsManager;
  versions: TableSheetVersionsManager;
  score: TableSheetScoreManager;

  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean,
    private tableId: ResourceId,
    private sheetId: ResourceId
  ) {
    this.rows = new TableSheetRowsManager(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId
    );
    this.columns = new TableSheetColumnsManager(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId
    );
    this.cells = new TableSheetCellsManager(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId
    );
    this.versions = new TableSheetVersionsManager(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId
    );
    this.score = new TableSheetScoreManager(
      apiKey,
      baseURL,
      throwOnError,
      tableId,
      sheetId
    );
  }

  get = (): Promise<SheetResponse | null> =>
    tablesApi.getSheet(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId
    );

  update = (body: UpdateSheet): Promise<SheetResponse | null> =>
    tablesApi.updateSheet(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId,
      body
    );

  delete = (): Promise<boolean> =>
    tablesApi.deleteSheet(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId
    );

  statusCounts = (): Promise<Record<string, unknown> | null> =>
    tablesApi.getSheetStatusCounts(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      this.sheetId
    );
}

export class TableSheetsManager {
  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean,
    private tableId: ResourceId
  ) {}

  list = (): Promise<SheetListResponse | null> =>
    tablesApi.listSheets(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId
    );

  create = (body: CreateSheet = {}): Promise<SheetResponse | null> =>
    tablesApi.createSheet(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      withDefaultEmptySheetSource(body)
    );

  forSheet = (sheetId: ResourceId): TableSheetManager =>
    new TableSheetManager(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      this.tableId,
      sheetId
    );
}

export class TableImportsManager {
  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean
  ) {}

  addTrace = (body: AddTraceImport): Promise<Record<string, unknown> | null> =>
    tablesApi.addTraceImport(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      body
    );
}

export class TableManager {
  imports: TableImportsManager;

  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean
  ) {
    this.imports = new TableImportsManager(apiKey, baseURL, throwOnError);
  }

  list = (
    params?: ListTablesParams
  ): Promise<TableListResponse | null> =>
    tablesApi.listTables(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      params
    );

  create = (body: CreateTable): Promise<TableResponse | null> =>
    tablesApi.createTable(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      body
    );

  get = (tableId: ResourceId): Promise<TableResponse | null> =>
    tablesApi.getTable(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      tableId
    );

  update = (
    tableId: ResourceId,
    body: UpdateTable
  ): Promise<TableResponse | null> =>
    tablesApi.updateTable(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      tableId,
      body
    );

  delete = (tableId: ResourceId): Promise<boolean> =>
    tablesApi.deleteTable(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      tableId
    );

  sheets = (tableId: ResourceId): TableSheetsManager =>
    new TableSheetsManager(
      this.apiKey,
      this.baseURL,
      this.throwOnError,
      tableId
    );
}
