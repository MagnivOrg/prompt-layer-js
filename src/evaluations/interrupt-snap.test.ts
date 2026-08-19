import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishEvalRunAbort,
  sheetRowCountFromPayload,
  withEvalInterruptSnap,
} from "@/evaluations/runner";
import { resetEvalInterruptState } from "@/evaluations/interrupt";

describe("eval interrupt abort publish", () => {
  afterEach(() => {
    resetEvalInterruptState();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("parses row_count from nested sheet payloads", () => {
    expect(sheetRowCountFromPayload({ sheet: { id: "s1", row_count: 3 } })).toBe(
      3
    );
    expect(sheetRowCountFromPayload({ id: "s1", row_count: 7 })).toBe(7);
    expect(sheetRowCountFromPayload({ sheet: { id: "s1", row_count: 0 } })).toBe(
      0
    );
    expect(sheetRowCountFromPayload(null)).toBe(0);
  });

  it("publishes eval_run_status=aborted with a one-shot PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await publishEvalRunAbort({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.com",
      tableId: "t1",
      sheetId: "s1",
      knownWritten: 3,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/tables/t1/sheets/s1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ eval_run_status: "aborted" });
    expect(init.headers["X-API-KEY"]).toBe("pl_test");
  });

  it("swallows abort failures so interrupt exit is not masked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("offline"))
    );
    await expect(
      publishEvalRunAbort({
        apiKey: "pl_test",
        baseURL: "https://api.promptlayer.com",
        tableId: "t1",
        sheetId: "s1",
        knownWritten: 4,
      })
    ).resolves.toBeUndefined();
  });

  it("PATCHes aborted when the populate run throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      withEvalInterruptSnap(
        {
          apiKey: "pl_test",
          baseURL: "https://api.promptlayer.com",
          tableId: "t1",
          sheetId: "s1",
        },
        async () => {
          throw new Error("runner blew up");
        }
      )
    ).rejects.toThrow("runner blew up");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ eval_run_status: "aborted" });
  });

  it("does not PATCH aborted when populate succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      withEvalInterruptSnap(
        {
          apiKey: "pl_test",
          baseURL: "https://api.promptlayer.com",
          tableId: "t1",
          sheetId: "s1",
        },
        async () => "ok"
      )
    ).resolves.toBe("ok");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
