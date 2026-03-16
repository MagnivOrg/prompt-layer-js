import { describe, it, expect } from "vitest";
import {
  buildPromptBlueprintFromAnthropicEvent,
  buildPromptBlueprintFromGoogleEvent,
  buildPromptBlueprintFromOpenAIEvent,
  buildPromptBlueprintFromOpenAIResponsesEvent,
  buildPromptBlueprintFromBedrockEvent,
  buildPromptBlueprintFromOpenAIImagesEvent,
} from "@/utils/blueprint-builder";
import type { Metadata } from "@/types";

const metadata: Metadata = {
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
};

describe("buildPromptBlueprintFromAnthropicEvent", () => {
  describe("merged message (event.content array)", () => {
    it("maps server_tool_use block to content", () => {
      const event = {
        content: [
          {
            type: "server_tool_use",
            id: "srvtoolu_01",
            name: "bash_code_execution",
            input: { command: "echo hi" },
          },
        ],
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      expect(blueprint.prompt_template.messages).toHaveLength(1);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.role).toBe("assistant");
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "server_tool_use",
        id: "srvtoolu_01",
        name: "bash_code_execution",
        input: { command: "echo hi" },
      });
      expect(msg.tool_calls).toEqual([]);
    });

    it("maps web_search_tool_result block to content", () => {
      const event = {
        content: [
          {
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_02",
            content: [
              {
                type: "web_search_result",
                url: "https://example.com",
                title: "Example",
                encrypted_content: "enc",
                page_age: "1 day",
              },
            ],
          },
        ],
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_02",
        content: [
          {
            type: "web_search_result",
            url: "https://example.com",
            title: "Example",
            encrypted_content: "enc",
            page_age: "1 day",
          },
        ],
      });
    });

    it("maps bash_code_execution_tool_result block to content", () => {
      const event = {
        content: [
          {
            type: "bash_code_execution_tool_result",
            tool_use_id: "srvtoolu_01F9YUsLV5DCRx2JbnBXL1hL",
            content: {
              type: "bash_code_execution_result",
              stdout: "Hello\n",
              stderr: "",
              return_code: 0,
              content: [],
            },
          },
        ],
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "bash_code_execution_tool_result",
        tool_use_id: "srvtoolu_01F9YUsLV5DCRx2JbnBXL1hL",
        content: {
          type: "bash_code_execution_result",
          stdout: "Hello\n",
          stderr: "",
          return_code: 0,
          content: [],
        },
      });
    });

    it("maps text block with annotations (citations) to content", () => {
      const event = {
        content: [
          {
            type: "text",
            text: "Some cited text.",
            annotations: [
              {
                url: "https://example.com",
                title: "Example",
                cited_text: "cited",
                start_index: 0,
                end_index: 14,
              },
            ],
          },
        ],
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "text",
        text: "Some cited text.",
        annotations: [
          expect.objectContaining({
            type: "url_citation",
            url: "https://example.com",
            title: "Example",
            cited_text: "cited",
          }),
        ],
      });
    });
  });

  describe("content_block_start (single stream event)", () => {
    it("maps server_tool_use content_block_start to server_tool_use content", () => {
      const event = {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "server_tool_use",
          id: "srvtoolu_01",
          name: "bash_code_execution",
          input: {},
        },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "server_tool_use",
        id: "srvtoolu_01",
        name: "bash_code_execution",
        input: {},
      });
    });

    it("maps bash_code_execution_tool_result content_block_start to content", () => {
      const event = {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "bash_code_execution_tool_result",
          tool_use_id: "srvtoolu_01",
          content: {
            type: "bash_code_execution_result",
            stdout: "First 10 primes\n",
            stderr: "",
            return_code: 0,
            content: [],
          },
        },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "bash_code_execution_tool_result",
        tool_use_id: "srvtoolu_01",
        content: {
          type: "bash_code_execution_result",
          stdout: "First 10 primes\n",
          stderr: "",
          return_code: 0,
          content: [],
        },
      });
    });

    it("maps web_search_tool_result content_block_start to content", () => {
      const event = {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_02",
          content: [{ type: "web_search_result", url: "https://a.com", title: "A" }],
        },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_02",
        content: [{ type: "web_search_result", url: "https://a.com", title: "A" }],
      });
    });

    it("maps tool_use content_block_start to tool_calls", () => {
      const event = {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_01",
          name: "get_weather",
          input: {},
        },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.tool_calls).toHaveLength(1);
      expect(msg.tool_calls![0]).toMatchObject({
        id: "toolu_01",
        type: "function",
        function: { name: "get_weather", arguments: "{}" },
      });
    });
  });

  describe("content_block_delta", () => {
    it("maps input_json_delta with blockTypeByIndex server_tool_use to server_tool_use content", () => {
      const event = {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"command":"echo hi"}',
        },
      };
      const blockTypeByIndex: Record<number, string> = { 0: "server_tool_use" };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata, blockTypeByIndex);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "server_tool_use",
        id: "",
        name: "",
        input: '{"command":"echo hi"}',
      });
      expect(msg.tool_calls).toEqual([]);
    });

    it("maps input_json_delta with blockTypeByIndex tool_use to tool_calls", () => {
      const event = {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"location":"NYC"}',
        },
      };
      const blockTypeByIndex: Record<number, string> = { 0: "tool_use" };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata, blockTypeByIndex);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.tool_calls).toHaveLength(1);
      expect(msg.tool_calls![0]).toMatchObject({
        id: "",
        type: "function",
        function: { name: "", arguments: '{"location":"NYC"}' },
      });
      expect(msg.content).toEqual([]);
    });

    it("maps input_json_delta without blockTypeByIndex to tool_calls (default)", () => {
      const event = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "{}" },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.tool_calls).toHaveLength(1);
      expect(msg.content).toEqual([]);
    });

    it("maps citations_delta to text content with annotations", () => {
      const event = {
        type: "content_block_delta",
        index: 3,
        delta: {
          type: "citations_delta",
          citation: {
            type: "web_search_result_location",
            cited_text: "The USD/PKR rate fell to 279.25.",
            url: "https://tradingeconomics.com/pakistan/currency",
            title: "Pakistan Rupee - News",
            encrypted_index: "Eo8BCioI...",
          },
        },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "text",
        text: "",
        annotations: [
          expect.objectContaining({
            type: "url_citation",
            url: "https://tradingeconomics.com/pakistan/currency",
            title: "Pakistan Rupee - News",
            cited_text: "The USD/PKR rate fell to 279.25.",
            encrypted_index: "Eo8BCioI...",
          }),
        ],
      });
    });

    it("maps text_delta to text content", () => {
      const event = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello " },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toEqual({ type: "text", text: "Hello " });
    });

    it("maps thinking_delta to thinking content", () => {
      const event = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me check." },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "thinking",
        thinking: "Let me check.",
        signature: "",
      });
    });

    it("maps signature_delta to thinking content with signature", () => {
      const event = {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig123" },
      };
      const blueprint = buildPromptBlueprintFromAnthropicEvent(event, metadata);
      const msg = blueprint.prompt_template.messages[0];
      expect(msg.content).toHaveLength(1);
      expect(msg.content![0]).toMatchObject({
        type: "thinking",
        thinking: "",
        signature: "sig123",
      });
    });
  });
});

// --- Google (Gemini) ---
const googleMetadata: Metadata = {
  model: { provider: "google", name: "gemini-2.0-flash" },
};

describe("buildPromptBlueprintFromGoogleEvent", () => {
  it("maps candidates with text part to text content", () => {
    const event = {
      candidates: [
        {
          content: {
            parts: [{ text: "Hello from Gemini" }],
          },
        },
      ],
    };
    const blueprint = buildPromptBlueprintFromGoogleEvent(event, googleMetadata);
    expect(blueprint.prompt_template.messages).toHaveLength(1);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(1);
    expect(msg.content![0]).toMatchObject({ type: "text", text: "Hello from Gemini" });
  });

  it("maps thought part to thinking content", () => {
    const event = {
      candidates: [
        {
          content: {
            parts: [{ text: "Reasoning step.", thought: true, thoughtSignature: "sig1" }],
          },
        },
      ],
    };
    const blueprint = buildPromptBlueprintFromGoogleEvent(event, googleMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(1);
    expect(msg.content![0]).toMatchObject({
      type: "thinking",
      thinking: "Reasoning step.",
      signature: "sig1",
    });
  });

  it("maps functionCall part to tool_calls", () => {
    const event = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  id: "fc_01",
                  name: "get_weather",
                  args: { location: "NYC" },
                },
              },
            ],
          },
        },
      ],
    };
    const blueprint = buildPromptBlueprintFromGoogleEvent(event, googleMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0]).toMatchObject({
      id: "fc_01",
      function: { name: "get_weather", arguments: '{"location":"NYC"}' },
    });
  });

  it("maps executableCode and codeExecutionResult to content", () => {
    const event = {
      candidates: [
        {
          content: {
            parts: [
              { executableCode: { code: "print(1+1)", language: "python" } },
              { codeExecutionResult: { output: "2", outcome: "OUTCOME_OK" } },
            ],
          },
        },
      ],
    };
    const blueprint = buildPromptBlueprintFromGoogleEvent(event, googleMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(2);
    expect(msg.content![0]).toMatchObject({ type: "code", code: "print(1+1)", language: "python" });
    expect(msg.content![1]).toMatchObject({
      type: "code_execution_result",
      output: "2",
      outcome: "OUTCOME_OK",
    });
  });
});

// --- OpenAI (chat-completions) ---
const openaiMetadata: Metadata = {
  model: { provider: "openai", name: "gpt-4o" },
};

describe("buildPromptBlueprintFromOpenAIEvent", () => {
  it("maps choices[].delta.content to text content", () => {
    const event = {
      choices: [{ delta: { content: "Hello" } }],
    };
    const blueprint = buildPromptBlueprintFromOpenAIEvent(event, openaiMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(1);
    expect(msg.content![0]).toMatchObject({ type: "text", text: "Hello" });
  });

  it("maps choices[].delta.tool_calls to tool_calls", () => {
    const event = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                id: "call_01",
                function: { name: "get_weather", arguments: '{"city":"Boston"}' },
              },
            ],
          },
        },
      ],
    };
    const blueprint = buildPromptBlueprintFromOpenAIEvent(event, openaiMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0]).toMatchObject({
      id: "call_01",
      function: { name: "get_weather", arguments: '{"city":"Boston"}' },
    });
  });

  it("handles toolCalls (camelCase) alias", () => {
    const event = {
      choices: [
        {
          delta: {
            toolCalls: [
              { id: "call_02", function: { name: "search", arguments: "{}" } },
            ],
          },
        },
      ],
    };
    const blueprint = buildPromptBlueprintFromOpenAIEvent(event, openaiMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].function.name).toBe("search");
  });
});

// --- OpenAI Responses API ---
const openaiResponsesMetadata: Metadata = {
  model: { provider: "openai", name: "gpt-4o", api_type: "responses" },
};

describe("buildPromptBlueprintFromOpenAIResponsesEvent", () => {
  it("maps response.reasoning_summary_text.delta to thinking content", () => {
    const event = {
      type: "response.reasoning_summary_text.delta",
      item_id: "item_1",
      delta: "Some reasoning.",
    };
    const blueprint = buildPromptBlueprintFromOpenAIResponsesEvent(event, openaiResponsesMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(1);
    expect(msg.content![0]).toMatchObject({
      type: "thinking",
      id: "item_1",
      thinking: "Some reasoning.",
      signature: "",
    });
  });

  it("maps response.output_text.delta to text content", () => {
    const event = {
      type: "response.output_text.delta",
      item_id: "msg_01",
      delta: "Hello world",
    };
    const blueprint = buildPromptBlueprintFromOpenAIResponsesEvent(event, openaiResponsesMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(1);
    expect(msg.content![0]).toMatchObject({ type: "text", id: "msg_01", text: "Hello world" });
  });

  it("maps response.output_item.added (message) to text content", () => {
    const event = {
      type: "response.output_item.added",
      item: { type: "message", id: "msg_01" },
      item_id: "msg_01",
    };
    const blueprint = buildPromptBlueprintFromOpenAIResponsesEvent(event, openaiResponsesMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(1);
    expect(msg.content![0]).toMatchObject({ type: "text", id: "msg_01", text: "" });
  });

  it("maps response.output_item.added (function_call) to tool_calls", () => {
    const event = {
      type: "response.output_item.added",
      item: { type: "function_call", id: "fc_01", call_id: "call_01", name: "get_weather" },
      item_id: "fc_01",
    };
    const blueprint = buildPromptBlueprintFromOpenAIResponsesEvent(event, openaiResponsesMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0]).toMatchObject({
      id: "call_01",
      function: { name: "get_weather", arguments: "" },
      tool_id: "fc_01",
    });
  });

  it("maps response.function_call_arguments.done to tool_calls", () => {
    const event = {
      type: "response.function_call_arguments.done",
      item_id: "fc_01",
      arguments: '{"location":"NYC"}',
    };
    const blueprint = buildPromptBlueprintFromOpenAIResponsesEvent(event, openaiResponsesMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0].function.arguments).toBe('{"location":"NYC"}');
  });
});

// --- Amazon Bedrock ---
const bedrockMetadata: Metadata = {
  model: { provider: "amazon.bedrock", name: "anthropic.claude-3-sonnet" },
};

describe("buildPromptBlueprintFromBedrockEvent", () => {
  it("maps contentBlockDelta with text to text content", () => {
    const event = {
      contentBlockDelta: { delta: { text: "Hello from Bedrock" } },
    };
    const blueprint = buildPromptBlueprintFromBedrockEvent(event, bedrockMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(1);
    expect(msg.content![0]).toMatchObject({ type: "text", text: "Hello from Bedrock" });
  });

  it("maps contentBlockDelta with reasoningContent to thinking content", () => {
    const event = {
      contentBlockDelta: {
        delta: {
          reasoningContent: { text: "Thinking...", signature: "sig123" },
        },
      },
    };
    const blueprint = buildPromptBlueprintFromBedrockEvent(event, bedrockMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.content).toHaveLength(1);
    expect(msg.content![0]).toMatchObject({
      type: "thinking",
      thinking: "Thinking...",
      signature: "sig123",
    });
  });

  it("maps contentBlockDelta with toolUse to tool_calls", () => {
    const event = {
      contentBlockDelta: {
        delta: {
          toolUse: {
            toolUseId: "toolu_01",
            name: "search",
            input: '{"query":"test"}',
          },
        },
      },
    };
    const blueprint = buildPromptBlueprintFromBedrockEvent(event, bedrockMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0]).toMatchObject({
      id: "toolu_01",
      function: { name: "search", arguments: '{"query":"test"}' },
    });
  });

  it("maps contentBlockStart with toolUse to tool_calls", () => {
    const event = {
      contentBlockStart: {
        start: {
          toolUse: { toolUseId: "toolu_02", name: "get_weather" },
        },
      },
    };
    const blueprint = buildPromptBlueprintFromBedrockEvent(event, bedrockMetadata);
    const msg = blueprint.prompt_template.messages[0];
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls![0]).toMatchObject({
      id: "toolu_02",
      function: { name: "get_weather", arguments: "" },
    });
  });
});

// --- OpenAI Images ---
const openaiImagesMetadata: Metadata = {
  model: { provider: "openai", name: "dall-e-3", api_type: "images" },
};

describe("buildPromptBlueprintFromOpenAIImagesEvent", () => {
  it("maps image_generation.partial_image to output_media content", () => {
    const event = {
      type: "image_generation.partial_image",
      b64_json: "base64encodeddata",
      output_format: "png",
      partial_image_index: 0,
    };
    const blueprint = buildPromptBlueprintFromOpenAIImagesEvent(event, openaiImagesMetadata);
    expect(blueprint.prompt_template.type).toBe("completion");
    const content = (blueprint.prompt_template as { content: unknown[] }).content;
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      type: "output_media",
      url: "base64encodeddata",
      mime_type: "image/png",
      media_type: "image",
      provider_metadata: { partial_image_index: 0 },
    });
  });

  it("maps image_generation.completed to output_media content", () => {
    const event = {
      type: "image_generation.completed",
      b64_json: "finalbase64",
      output_format: "webp",
      size: "1024x1024",
      quality: "hd",
    };
    const blueprint = buildPromptBlueprintFromOpenAIImagesEvent(event, openaiImagesMetadata);
    const content = (blueprint.prompt_template as { content: unknown[] }).content;
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      type: "output_media",
      url: "finalbase64",
      mime_type: "image/webp",
      media_type: "image",
      provider_metadata: expect.objectContaining({ size: "1024x1024", quality: "hd" }),
    });
  });
});
