import { describe, it, expect, vi, beforeEach } from "vitest";
import { isStreamResult } from "@/run-tracing";
import "@/test-fixtures/setup-promptlayer-run-mocks";
import { fakeSpan } from "@/test-fixtures/setup-promptlayer-run-mocks";

const finalChunk = {
  request_id: "req_1",
  raw_response: "chunk",
  prompt_blueprint: {
    messages: [
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ],
  },
};

vi.mock("@/utils/streaming", () => ({
  streamResponse: vi.fn().mockImplementation(async function* () {
    yield { request_id: null, raw_response: "partial", prompt_blueprint: null };
    yield finalChunk;
  }),
}));

import { PromptLayer } from "@/index";
import { setupTracing } from "@/tracing";
import { streamResponse } from "@/utils/streaming";

describe("isStreamResult", () => {
  it("detects generators and stream-like objects", () => {
    function* syncGen() {
      yield 1;
    }
    async function* asyncGen() {
      yield 1;
    }
    expect(isStreamResult(syncGen())).toBe(true);
    expect(isStreamResult(asyncGen())).toBe(true);
    expect(isStreamResult({ pipe: () => undefined })).toBe(true);
    expect(isStreamResult({ getReader: () => undefined })).toBe(true);
    expect(isStreamResult({ request_id: "1" })).toBe(false);
    expect(isStreamResult("text")).toBe(false);
  });
});

describe("run() stream tracing", () => {
  let client: PromptLayer;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new PromptLayer({ apiKey: "test-api-key" });
  });

  it("preserves the tracing-disabled client path", async () => {
    const disabledClient = new PromptLayer({
      apiKey: "test-api-key",
      enableTracing: false,
    });

    const result = await disabledClient.run({
      promptName: "test",
    });

    expect(disabledClient.tracerProvider).toBeNull();
    expect(setupTracing).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      request_id: 1,
      raw_response: {
        choices: [
          {
            message: {
              content: "hi",
            },
          },
        ],
      },
    });
  });

  it("ends tracing after stream consumption without exporting output payloads", async () => {
    const stream = (await client.run({
      promptName: "test",
      inputVariables: {},
      stream: true,
    })) as AsyncIterable<unknown>;

    for await (const _chunk of stream) {
      // drain
    }

    expect(streamResponse).toHaveBeenCalled();
    expect(fakeSpan.setAttribute).not.toHaveBeenCalledWith(
      "function_output",
      expect.anything()
    );
    expect(fakeSpan.end).toHaveBeenCalled();
  });
});
