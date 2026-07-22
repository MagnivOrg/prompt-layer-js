import { PromptLayer } from "@/index";
import { PromptLayerAPIError } from "@/errors";
import {
  addTraceImport,
  createSheetColumn,
  createTable,
  ensureDefaultSheet,
  listAllSheetRows,
  listTables,
  upsertTableByTitle,
} from "@/tables/api";
import {
  emptyCsvSheetSource,
  emptySheetCreateBody,
  withDefaultEmptySheetSource,
} from "@/tables/helpers";
import { getUrlString, jsonResponse } from "@/test-helpers";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

describe("tables", () => {
  let client: PromptLayer;
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new PromptLayer({
      apiKey: "test-api-key",
      baseURL: "https://api.promptlayer.com",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("exposes a tables manager on the main client", () => {
    expect(client.tables).toBeDefined();
    expect(typeof client.tables.list).toBe("function");
    expect(typeof client.tables.create).toBe("function");
    expect(typeof client.tables.imports.addTrace).toBe("function");
  });

  it("exposes nested sheet resources", () => {
    const sheet = client.tables.sheets("10").forSheet("5");
    expect(typeof sheet.rows.list).toBe("function");
    expect(typeof sheet.columns.create).toBe("function");
    expect(typeof sheet.score.recalculate).toBe("function");
    expect(typeof sheet.cells.batchRecalculate).toBe("function");
    expect(typeof sheet.versions.scoreHistory).toBe("function");
  });

  it("lists tables via the public v2 API", async () => {
    const payload = {
      success: true,
      data: [{ id: "1", title: "Eval Table" }],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload, 200));

    const response = await listTables(
      "test-api-key",
      "https://api.promptlayer.com",
      true,
      { limit: 20 }
    );

    const [input, init] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toBe(
      "https://api.promptlayer.com/api/public/v2/tables?limit=20"
    );
    expect(init?.headers).toMatchObject({ "X-API-KEY": "test-api-key" });
    expect(response).toEqual(payload);
  });

  it("maps create table request bodies", async () => {
    const payload = {
      success: true,
      table: { id: "10", title: "Support Agent Eval" },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload, 201));

    const response = await createTable(
      "test-api-key",
      "https://api.promptlayer.com",
      true,
      { title: "Support Agent Eval", folder_id: 3 }
    );

    const [input, init] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toBe(
      "https://api.promptlayer.com/api/public/v2/tables"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "Support Agent Eval",
      folder_id: 3,
    });
    expect(response).toEqual(payload);
  });

  it("maps create column bodies with is_output_column", async () => {
    const payload = {
      success: true,
      column: { id: "7", title: "Correctness", type: "LLM_ASSERTION" },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload, 201));

    const response = await createSheetColumn(
      "test-api-key",
      "https://api.promptlayer.com",
      true,
      "10",
      "5",
      {
        title: "Correctness",
        type: "LLM_ASSERTION",
        is_output_column: true,
      }
    );

    const [input, init] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toBe(
      "https://api.promptlayer.com/api/public/v2/tables/10/sheets/5/columns"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "Correctness",
      type: "LLM_ASSERTION",
      is_output_column: true,
    });
    expect(response).toEqual(payload);
  });

  it("posts add-trace to dataset-versions with smart_table_id", async () => {
    const payload = { success: true, rows_added: 1 };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload, 201));

    const response = await addTraceImport(
      "test-api-key",
      "https://api.promptlayer.com",
      true,
      {
        trace_id: "abc123trace",
        sheet_id: "5",
        smart_table_id: "10",
        metadata: { source: "eval" },
      }
    );

    const [input, init] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toBe(
      "https://api.promptlayer.com/api/public/v2/dataset-versions/add-trace"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      trace_id: "abc123trace",
      sheet_id: "5",
      smart_table_id: "10",
      metadata: { source: "eval" },
    });
    expect(response).toEqual(payload);
  });

  it("builds empty CSV sheet sources and injects defaults", () => {
    const source = emptyCsvSheetSource("My Sheet.csv");
    expect(source).toEqual({
      type: "file",
      file_name: "My Sheet.csv",
      file_content_base64: Buffer.from("input\n", "utf8").toString("base64"),
    });
    expect(emptyCsvSheetSource("sheet").file_name).toBe("sheet.csv");

    const withDefault = withDefaultEmptySheetSource({ title: "Experiment #1" });
    expect(withDefault.source).toEqual(emptyCsvSheetSource("Experiment #1.csv"));

    const preserved = withDefaultEmptySheetSource({
      title: "Custom",
      source: {
        type: "request_logs",
        request_log_ids: [1, 2],
      },
    });
    expect(preserved.source).toEqual({
      type: "request_logs",
      request_log_ids: [1, 2],
    });

    expect(emptySheetCreateBody("Sheet 1")).toEqual({
      title: "Sheet 1",
      source: emptyCsvSheetSource("Sheet 1.csv"),
    });
  });

  it("injects empty CSV source when creating sheets via the manager", async () => {
    const payload = {
      success: true,
      sheet: { id: "5", title: "Experiment #1" },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(payload, 202));

    const response = await client.tables.sheets("10").create({
      title: "Experiment #1",
    });

    const [input, init] = fetchMock.mock.calls[0];
    expect(getUrlString(input)).toBe(
      "https://api.promptlayer.com/api/public/v2/tables/10/sheets"
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      title: "Experiment #1",
      source: emptyCsvSheetSource("Experiment #1.csv"),
    });
    expect(response).toEqual(payload);
  });

  it("injects empty CSV source when ensuring a default sheet", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [] }, 200))
      .mockResolvedValueOnce(
        jsonResponse(
          { success: true, sheet: { id: "5", title: "Sheet 1" } },
          202
        )
      );

    const sheet = await ensureDefaultSheet(
      "test-api-key",
      "https://api.promptlayer.com",
      true,
      "10"
    );

    expect(sheet).toEqual({ id: "5", title: "Sheet 1" });
    const [, createInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(createInit?.body))).toEqual({
      title: "Sheet 1",
      source: emptyCsvSheetSource("Sheet 1.csv"),
    });
  });

  it("lists by title and folder when upserting a table", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ success: true, data: [] }, 200))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: true,
            table: { id: "10", title: "Support Agent Eval", folder_id: 3 },
          },
          201
        )
      );

    const table = await upsertTableByTitle(
      "test-api-key",
      "https://api.promptlayer.com",
      true,
      "Support Agent Eval",
      3
    );

    const listUrl = getUrlString(fetchMock.mock.calls[0][0]);
    expect(listUrl).toContain("/api/public/v2/tables?");
    expect(listUrl).toContain("name=Support+Agent+Eval");
    expect(listUrl).toContain("folder_id=3");
    expect(listUrl).toContain("limit=100");
    expect(table).toEqual({
      id: "10",
      title: "Support Agent Eval",
      folder_id: 3,
    });
  });

  it("paginates listAll rows, clamps limit, and preserves first-page metadata", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: [{ row_index: 0 }],
            columns: [{ id: "input" }],
            row_count: 2,
            pagination: { next_cursor: "next" },
          },
          200
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: [{ row_index: 1 }],
            pagination: { next_cursor: null },
          },
          200
        )
      );

    const result = await listAllSheetRows(
      "test-api-key",
      "https://api.promptlayer.com",
      true,
      "table",
      "sheet",
      { limit: 500, cursor: "stale" }
    );

    expect(result).toMatchObject({
      data: [{ row_index: 0 }, { row_index: 1 }],
      columns: [{ id: "input" }],
      row_count: 2,
    });

    const firstUrl = getUrlString(fetchMock.mock.calls[0][0]);
    expect(firstUrl).toContain("limit=100");
    expect(firstUrl).not.toContain("cursor=stale");

    const secondUrl = getUrlString(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain("cursor=next");
    expect(secondUrl).toContain("include_columns=false");
  });

  it("raises on repeated row pagination cursors when throwOnError is true", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: [{ row_index: 0 }],
            pagination: { next_cursor: "loop" },
          },
          200
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: [{ row_index: 1 }],
            pagination: { next_cursor: "loop" },
          },
          200
        )
      );

    await expect(
      listAllSheetRows(
        "test-api-key",
        "https://api.promptlayer.com",
        true,
        "table",
        "sheet"
      )
    ).rejects.toBeInstanceOf(PromptLayerAPIError);
  });
});
