import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tablesApi from "@/tables/api";
import * as evalUtils from "@/evaluations/utils";
import { waitForTraceRequestPrice } from "./tracePrice";

describe("waitForTraceRequestPrice", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(evalUtils, "sleep").mockResolvedValue(undefined);
  });

  it("returns once a linked request log has a price", async () => {
    const getTrace = vi
      .spyOn(tablesApi, "getTrace")
      .mockResolvedValueOnce({ success: true, spans: [{ request_log_id: null }] })
      .mockResolvedValueOnce({ success: true, spans: [{ request_log_id: 42 }] });
    const getRequest = vi
      .spyOn(tablesApi, "getRequest")
      .mockResolvedValueOnce({ success: true, price: 0.001 });

    await waitForTraceRequestPrice("key", "https://api.example.com", "abc123", {
      delaysMs: [10, 20, 20],
    });

    expect(evalUtils.sleep).toHaveBeenCalledTimes(2);
    expect(getTrace).toHaveBeenCalledTimes(2);
    expect(getRequest).toHaveBeenCalledTimes(1);
  });

  it("stops after the delay budget when price never appears", async () => {
    const getTrace = vi
      .spyOn(tablesApi, "getTrace")
      .mockResolvedValue({ success: true, spans: [] });
    const getRequest = vi.spyOn(tablesApi, "getRequest");

    await waitForTraceRequestPrice("key", "https://api.example.com", "abc123", {
      maxWaitMs: 50,
      delaysMs: [10, 10, 10],
    });

    expect(evalUtils.sleep).toHaveBeenCalledTimes(3);
    expect(getTrace).toHaveBeenCalledTimes(3);
    expect(getRequest).not.toHaveBeenCalled();
  });
});
