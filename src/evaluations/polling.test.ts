import { describe, expect, it, vi } from "vitest";
import * as tablesApi from "@/tables/api";
import {
  normalizeOperationStatusPayload,
  operationIsTerminal,
  waitForSheetOperations,
} from "./polling";

describe("operation status polling", () => {
  it("unwraps nested operation payloads from the public API", () => {
    expect(
      normalizeOperationStatusPayload({
        success: true,
        operation: { status: "completed", cell_count: 4 },
      })
    ).toEqual({ status: "completed", cell_count: 4 });
    expect(
      normalizeOperationStatusPayload({
        operation: "recalculate",
        cell_count: 4,
        operation_id: "op-1",
      })
    ).toEqual({
      operation: "recalculate",
      cell_count: 4,
      operation_id: "op-1",
    });
  });

  it("treats finished cell counts as terminal even without status", () => {
    expect(
      operationIsTerminal({
        success: true,
        operation: {
          pending_count: 0,
          completed_count: 8,
          failed_count: 0,
          cell_count: 8,
        },
      })
    ).toBe(true);
    expect(
      operationIsTerminal({
        success: true,
        operation: {
          status: "running",
          pending_count: 2,
          completed_count: 6,
          failed_count: 0,
          cell_count: 8,
        },
      })
    ).toBe(false);
  });

  it("polls nested operation status until completed", async () => {
    vi.spyOn(tablesApi, "createSheetOperation").mockResolvedValue({
      cell_count: 4,
      operation_id: "operation-1",
      operation: "recalculate",
    });
    const getOperation = vi
      .spyOn(tablesApi, "getSheetOperation")
      .mockResolvedValue({
        success: true,
        operation: {
          operation_id: "operation-1",
          status: "completed",
          completed_count: 4,
          failed_count: 0,
          pending_count: 0,
          cell_count: 4,
        },
      });

    const result = await waitForSheetOperations(
      "key",
      "url",
      true,
      "table",
      "sheet",
      { columnIds: ["column"] }
    );

    expect(result).toMatchObject({ status: "completed", cell_count: 4 });
    expect(getOperation).toHaveBeenCalledOnce();
  });
});
