import {
  anthropicStreamMessage,
  getAllPromptTemplates,
  getPromptTemplate,
  openaiStreamChat,
  promptlayerApiHandler,
  promptLayerTrackMetadata,
  trackRequest,
} from "./utils";

import { ChatCompletionChunk, ChatCompletion } from "openai/resources";
import { MessageStreamEvent, Message } from "@anthropic-ai/sdk/resources";
import { TrackRequest } from "./types";

describe("utils", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("promptlayerApiHandler", () => {
    it("should handle async iterables", async () => {
      const mockGenerator = async function* () {
        yield { value: 1 };
        yield { value: 2 };
      };

      const result = await promptlayerApiHandler("test-key", {
        request_response: mockGenerator() as any,
        function_name: "test",
        api_key: "test-key",
        request_end_time: new Date().toISOString(),
        request_start_time: new Date().toISOString(),
      });

      expect(result).toBeDefined();
    });
  });

  describe("openaiStreamChat", () => {
    it("should combine chat completion chunks correctly", () => {
      const chunks: ChatCompletionChunk[] = [
        {
          id: "1",
          choices: [{
            delta: { content: "Hello" },
            index: 0,
            finish_reason: null
          }],
          created: 1234,
          model: "gpt-4",
          object: "chat.completion.chunk"
        },
        {
          id: "2", 
          choices: [{
            delta: { content: " world" },
            index: 0,
            finish_reason: "stop"
          }],
          created: 1235,
          model: "gpt-4",
          object: "chat.completion.chunk"
        }
      ];

      const result = openaiStreamChat(chunks);

      expect(result.choices[0].message.content).toBe("Hello world");
    });
  });

  describe("anthropicStreamMessage", () => {
    it("should combine message stream events correctly", () => {
      const events: MessageStreamEvent[] = [
        {
          type: "message_start",
          message: {
            id: "msg_1",
            model: "claude-2",
            role: "assistant",
            content: [],
            type: "message",
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 }
          }
        },
        {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hello" },
          index: 0
        },
        {
          type: "content_block_delta", 
          delta: { type: "text_delta", text: " world" },
          index: 0
        }
      ];

      const result = anthropicStreamMessage(events);

      expect(result.content[0].text).toBe("Hello world");
    });
  });

  describe("API requests", () => {
    it("should make track request correctly", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({ request_id: "123" })
      });

      const result = await trackRequest({
        api_key: "test-key",
        function_name: "test",
        request_response: { text: "test" },
        request_end_time: new Date().toISOString(),
        request_start_time: new Date().toISOString(),
      });

      expect(result).toEqual({ request_id: "123" });
    });

    it("should handle track request errors", async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

      const result = await trackRequest({
        api_key: "test-key",
        function_name: "test",
        request_response: { text: "test" },
        request_end_time: new Date().toISOString(),
        request_start_time: new Date().toISOString(),
      });

      expect(result).toEqual({});
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe("promptLayerTrackMetadata", () => {
    it("should track metadata successfully", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({})
      });

      const result = await promptLayerTrackMetadata("test-key", {
        request_id: 123,
        metadata: { key: "value" }
      });

      expect(result).toBe(true);
    });
  });

  describe("getPromptTemplate", () => {
    it("should fetch prompt template successfully", async () => {
      const mockResponse = {
        prompt_template: { name: "test", text: "Hello {{name}}" }
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await getPromptTemplate("test-key", "test-prompt");

      expect(result).toEqual(mockResponse);
    });
  });

  describe("getAllPromptTemplates", () => {
    it("should fetch all prompt templates", async () => {
      const mockTemplates = [
        { name: "template1" },
        { name: "template2" }
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({ items: mockTemplates })
      });

      const result = await getAllPromptTemplates("test-key");

      expect(result).toEqual(mockTemplates);
    });
  });
});
