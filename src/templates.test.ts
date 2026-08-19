import { PromptLayer } from "@/index";
import type {
  BuiltInTool,
  LegacyOpenAINativeMcpTool,
  PromptLayerMcpTool,
  PublishPromptTemplate,
  Tool,
  ToolVariable,
} from "@/index";
import { jsonResponse } from "@/test-helpers";
import { isLocallyRenderable, renderResponse } from "@/utils/template-cache";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

describe("prompt template tool schemas", () => {
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

  it("publishes managed and native MCP tools without changing their wire shapes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }, 201));

    const managedMcp: PromptLayerMcpTool = {
      type: "mcp",
      mcp_server_id: 42,
    };
    const nativeMcp: BuiltInTool = {
      id: "openai_mcp",
      name: "MCP",
      description: "OpenAI-native MCP",
      provider: "openai",
      type: "openai_mcp",
      config: {
        type: "mcp",
        server_label: "docs",
        server_url: "https://docs.example.com/mcp",
        headers: { Authorization: "Bearer token" },
        require_approval: "never",
      },
    };
    const toolVariable: ToolVariable = {
      type: "variable",
      name: "additional_tools",
    };
    const openRouterTool: BuiltInTool = {
      id: "openrouter_web",
      name: "Web Search",
      description: "OpenRouter web search",
      provider: "openrouter",
      type: "web_search",
      config: {
        id: "web",
        engine: "exa",
        max_results: 3,
      },
    };
    const tools: Tool[] = [managedMcp, nativeMcp, toolVariable, openRouterTool];
    const body: PublishPromptTemplate = {
      prompt_name: "mcp-prompt",
      prompt_template: {
        type: "chat",
        messages: [{ role: "user", content: [{ type: "text", text: "Search" }] }],
        tools,
      },
      metadata: {
        model: {
          provider: "openai",
          name: "gpt-5",
          parameters: {},
        },
      },
      parent_version_id: 7,
    };

    await client.templates.publish(body);

    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(requestBody.prompt_version.prompt_template.tools).toEqual(tools);
    expect(requestBody.prompt_version.parent_version_id).toBe(7);
  });

  it("keeps the legacy OpenAI-native MCP input available for compatibility", () => {
    const legacyTool: LegacyOpenAINativeMcpTool = {
      id: "openai_mcp",
      name: "MCP",
      description: "Legacy OpenAI-native MCP",
      provider: "openai",
      type: "mcp",
      config: {
        type: "mcp",
        server_label: "docs",
        server_url: "https://docs.example.com/mcp",
        execution_mode: "provider",
      },
    };

    expect(legacyTool.type).toBe("mcp");
    expect(legacyTool.config.execution_mode).toBe("provider");
  });

  it("preserves backend-resolved kwargs when locally rendering an MCP prompt", () => {
    const response = {
      prompt_template: {
        type: "chat",
        messages: [{ role: "user", content: [{ type: "text", text: "Search" }] }],
        tools: [{ type: "mcp", mcp_server_id: 42 }],
      },
      llm_kwargs: {
        tools: [
          {
            type: "function",
            function: {
              name: "search_docs",
              description: "Search documentation",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      },
    };

    expect(isLocallyRenderable(response)).toBe(true);
    expect(renderResponse(response).llm_kwargs).toEqual(response.llm_kwargs);
  });
});
