import { promptLayerApiRequest } from "@/utils";
import { describe, expect, it } from "vitest";

describe("promptLayerApiRequest", () =>
  it("returns a successful response", async () => {
    const response = await promptLayerApiRequest({
      api_key: "test-api-key",
      function_name: "openai.chat.completions.create",
      request_start_time: "2021-10-13T15:00:00.000Z",
      request_end_time: "2021-10-13T15:00:00.000Z",
    });
    expect(response).toEqual(undefined);
  }));
