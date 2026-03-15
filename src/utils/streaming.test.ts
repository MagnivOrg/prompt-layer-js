import { describe, it, expect } from "vitest";
import {
  anthropicStreamMessage,
  googleStreamChat,
  bedrockStreamMessage,
  openaiStreamChat,
} from "@/utils/streaming";

describe("anthropicStreamMessage", () => {
  it("merges server_tool_use block with input_json_delta into content", () => {
    const results = [
      {
        type: "message_start" as const,
        message: {
          id: "msg_01",
          model: "claude-sonnet-4-6",
          type: "message" as const,
          role: "assistant" as const,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
        },
      },
      {
        type: "content_block_start" as const,
        index: 0,
        content_block: {
          type: "server_tool_use" as const,
          id: "srvtoolu_01",
          name: "bash_code_execution",
          input: {},
          caller: { type: "direct" as const },
        },
      },
      {
        type: "content_block_delta" as const,
        index: 0,
        delta: { type: "input_json_delta" as const, partial_json: '{"command":"echo hello"}' },
      },
      {
        type: "content_block_stop" as const,
        index: 0,
      },
    ];
    const message = anthropicStreamMessage(results as any);
    expect(message.content).toHaveLength(1);
    expect(message.content![0]).toMatchObject({
      type: "server_tool_use",
      id: "srvtoolu_01",
      name: "bash_code_execution",
      input: { command: "echo hello" },
    });
  });

  it("merges tool_use block with input_json_delta into content", () => {
    const results = [
      {
        type: "message_start" as const,
        message: {
          id: "msg_01",
          model: "claude-sonnet-4-6",
          type: "message" as const,
          role: "assistant" as const,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
        },
      },
      {
        type: "content_block_start" as const,
        index: 0,
        content_block: {
          type: "tool_use" as const,
          id: "toolu_01",
          name: "get_weather",
          input: {},
        },
      },
      {
        type: "content_block_delta" as const,
        index: 0,
        delta: { type: "input_json_delta" as const, partial_json: '{"location":"NYC"}' },
      },
      {
        type: "content_block_stop" as const,
        index: 0,
      },
    ];
    const message = anthropicStreamMessage(results as any);
    expect(message.content).toHaveLength(1);
    expect(message.content![0]).toMatchObject({
      type: "tool_use",
      id: "toolu_01",
      name: "get_weather",
      input: { location: "NYC" },
    });
  });

  it("pushes bash_code_execution_tool_result block on content_block_stop", () => {
    const results = [
      {
        type: "message_start" as const,
        message: {
          id: "msg_01",
          model: "claude-sonnet-4-6",
          type: "message" as const,
          role: "assistant" as const,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
        },
      },
      {
        type: "content_block_start" as const,
        index: 1,
        content_block: {
          type: "bash_code_execution_tool_result" as const,
          tool_use_id: "srvtoolu_01F9YUsLV5DCRx2JbnBXL1hL",
          content: {
            type: "bash_code_execution_result",
            stdout: "First 10 Prime Numbers:\n1. 2\n2. 3\n",
            stderr: "",
            return_code: 0,
            content: [],
          },
        },
      },
      {
        type: "content_block_stop" as const,
        index: 1,
      },
    ];
    const message = anthropicStreamMessage(results as any);
    expect(message.content).toHaveLength(1);
    expect(message.content![0]).toMatchObject({
      type: "bash_code_execution_tool_result",
      tool_use_id: "srvtoolu_01F9YUsLV5DCRx2JbnBXL1hL",
      content: {
        type: "bash_code_execution_result",
        stdout: "First 10 Prime Numbers:\n1. 2\n2. 3\n",
        stderr: "",
        return_code: 0,
        content: [],
      },
    });
  });

  it("attaches citations_delta to text block by index", () => {
    const results = [
      {
        type: "message_start" as const,
        message: {
          id: "msg_01",
          model: "claude-sonnet-4-6",
          type: "message" as const,
          role: "assistant" as const,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
        },
      },
      {
        type: "content_block_start" as const,
        index: 0,
        content_block: { type: "text" as const },
      },
      {
        type: "content_block_delta" as const,
        index: 0,
        delta: { type: "text_delta" as const, text: "The rate is 279.25." },
      },
      {
        type: "content_block_delta" as const,
        index: 0,
        delta: {
          type: "citations_delta" as const,
          citation: {
            type: "web_search_result_location" as const,
            cited_text: "The rate is 279.25.",
            url: "https://example.com",
            title: "Example",
            encrypted_index: "enc",
          },
        },
      },
      {
        type: "content_block_stop" as const,
        index: 0,
      },
    ];
    const message = anthropicStreamMessage(results as any);
    expect(message.content).toHaveLength(1);
    expect(message.content![0]).toMatchObject({
      type: "text",
      text: "The rate is 279.25.",
      citations: null,
      annotations: [
        {
          type: "url_citation",
          url: "https://example.com",
          title: "Example",
          cited_text: "The rate is 279.25.",
          encrypted_index: "enc",
        },
      ],
    });
  });

  it("merges multiple blocks in order (server_tool_use, bash result, text)", () => {
    const results = [
      {
        type: "message_start" as const,
        message: {
          id: "msg_01",
          model: "claude-sonnet-4-6",
          type: "message" as const,
          role: "assistant" as const,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null, service_tier: null },
        },
      },
      {
        type: "content_block_start" as const,
        index: 0,
        content_block: {
          type: "server_tool_use" as const,
          id: "srvtoolu_01",
          name: "bash_code_execution",
          input: {},
          caller: { type: "direct" as const },
        },
      },
      {
        type: "content_block_delta" as const,
        index: 0,
        delta: { type: "input_json_delta" as const, partial_json: '{"command":"echo hi"}' },
      },
      { type: "content_block_stop" as const, index: 0 },
      {
        type: "content_block_start" as const,
        index: 1,
        content_block: {
          type: "bash_code_execution_tool_result" as const,
          tool_use_id: "srvtoolu_01",
          content: { type: "bash_code_execution_result", stdout: "hi\n", stderr: "", return_code: 0, content: [] },
        },
      },
      { type: "content_block_stop" as const, index: 1 },
      {
        type: "content_block_start" as const,
        index: 2,
        content_block: { type: "text" as const },
      },
      {
        type: "content_block_delta" as const,
        index: 2,
        delta: { type: "text_delta" as const, text: "Done!" },
      },
      { type: "content_block_stop" as const, index: 2 },
    ];
    const message = anthropicStreamMessage(results as any);
    expect(message.content).toHaveLength(3);
    expect(message.content![0]).toMatchObject({ type: "server_tool_use", input: { command: "echo hi" } });
    expect(message.content![1]).toMatchObject({ type: "bash_code_execution_tool_result", tool_use_id: "srvtoolu_01" });
    expect(message.content![2]).toMatchObject({ type: "text", text: "Done!" });
  });
});

describe("googleStreamChat", () => {
  it("merges text parts from multiple chunks", () => {
    const results = [
      {
        candidates: [
          {
            content: { parts: [{ text: "Hello " }] },
          },
        ],
      },
      {
        candidates: [
          {
            content: { parts: [{ text: "world" }] },
          },
        ],
      },
    ];
    const response = googleStreamChat(results as any);
    expect(response.candidates).toHaveLength(1);
    expect(response.candidates![0].content.parts).toHaveLength(1);
    expect(response.candidates![0].content.parts[0].text).toBe("Hello world");
  });

  it("merges thought and regular text parts", () => {
    const results = [
      {
        candidates: [
          {
            content: {
              parts: [
                { text: "Reasoning.", thought: true, thoughtSignature: "sig1" },
                { text: "Answer." },
              ],
            },
          },
        ],
      },
    ];
    const response = googleStreamChat(results as any);
    const parts = response.candidates![0].content.parts;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({ text: "Reasoning.", thought: true, thoughtSignature: "sig1" });
    expect(parts[1]).toMatchObject({ text: "Answer." });
  });

  it("collects functionCall parts", () => {
    const results = [
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { id: "fc_01", name: "get_weather", args: { location: "NYC" } } },
              ],
            },
          },
        ],
      },
    ];
    const response = googleStreamChat(results as any);
    const parts = response.candidates![0].content.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].functionCall).toMatchObject({
      id: "fc_01",
      name: "get_weather",
      args: { location: "NYC" },
    });
  });
});

describe("bedrockStreamMessage", () => {
  it("merges text deltas into single text block", () => {
    const results = [
      {
        contentBlockDelta: { delta: { text: "Hello " } },
      },
      {
        contentBlockDelta: { delta: { text: "world" } },
      },
      {
        contentBlockStop: {},
      },
    ];
    const response = bedrockStreamMessage(results as any);
    expect(response.output.message.content).toHaveLength(1);
    expect(response.output.message.content[0]).toMatchObject({ text: "Hello world" });
  });

  it("merges toolUse deltas and parses input JSON", () => {
    const results = [
      {
        contentBlockStart: {
          start: {
            toolUse: { toolUseId: "toolu_01", name: "search" },
          },
        },
      },
      {
        contentBlockDelta: {
          delta: {
            toolUse: { input: '{"query":"test"}' },
          },
        },
      },
      {
        contentBlockStop: {},
      },
    ];
    const response = bedrockStreamMessage(results as any);
    expect(response.output.message.content).toHaveLength(1);
    expect(response.output.message.content[0].toolUse).toMatchObject({
      toolUseId: "toolu_01",
      name: "search",
      input: { query: "test" },
    });
  });

  it("merges reasoningContent into thinking block", () => {
    const results = [
      {
        contentBlockDelta: {
          delta: {
            reasoningContent: { text: "Think ", signature: "" },
          },
        },
      },
      {
        contentBlockDelta: {
          delta: {
            reasoningContent: { signature: "sig123" },
          },
        },
      },
      {
        contentBlockStop: {},
      },
    ];
    const response = bedrockStreamMessage(results as any);
    expect(response.output.message.content).toHaveLength(1);
    expect(response.output.message.content[0].reasoningContent.reasoningText).toMatchObject({
      text: "Think ",
      signature: "sig123",
    });
  });
});

describe("openaiStreamChat", () => {
  it("merges choice deltas into single message", () => {
    const results = [
      {
        id: "chatcmpl-1",
        model: "gpt-4o",
        created: 123,
        choices: [{ index: 0, delta: { content: "Hello " }, finish_reason: null }],
        system_fingerprint: null,
      },
      {
        id: "chatcmpl-1",
        model: "gpt-4o",
        created: 123,
        choices: [{ index: 0, delta: { content: "world" }, finish_reason: null }],
        system_fingerprint: null,
      },
      {
        id: "chatcmpl-1",
        model: "gpt-4o",
        created: 123,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        system_fingerprint: null,
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      },
    ];
    const response = openaiStreamChat(results as any);
    expect(response.choices).toHaveLength(1);
    expect(response.choices[0].message?.content).toBe("Hello world");
    expect(response.usage?.completion_tokens).toBe(2);
  });

  it("merges tool_calls from deltas (id in first chunk, arguments in later chunk)", () => {
    const results = [
      {
        id: "chatcmpl-1",
        model: "gpt-4o",
        created: 123,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { id: "call_01", index: 0, function: { name: "get_weather", arguments: "" } },
              ],
            },
            finish_reason: null,
          },
        ],
        system_fingerprint: null,
      },
      {
        id: "chatcmpl-1",
        model: "gpt-4o",
        created: 123,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { name: "", arguments: '{"city":"Boston"}' } },
              ],
            },
            finish_reason: null,
          },
        ],
        system_fingerprint: null,
      },
    ];
    const response = openaiStreamChat(results as any);
    expect(response.choices[0].message?.tool_calls).toHaveLength(1);
    expect(response.choices[0].message?.tool_calls![0]).toMatchObject({
      id: "call_01",
      function: { name: "get_weather", arguments: '{"city":"Boston"}' },
    });
  });
});
