import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@openai/agents", () => ({
  addTraceProcessor: vi.fn(),
  setTraceProcessors: vi.fn(),
}));

import {
  instrumentOpenAIAgents,
} from "@/integrations/openai-agents/instrumentation";
import * as agentsModule from "@openai/agents";

describe("instrumentOpenAIAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers the processor exclusively by default", async () => {
    const processor = await instrumentOpenAIAgents({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
    });

    expect(agentsModule.setTraceProcessors).toHaveBeenCalledWith([processor]);
    expect(agentsModule.addTraceProcessor).not.toHaveBeenCalled();
  });

  it("registers the processor non-exclusively when requested", async () => {
    const processor = await instrumentOpenAIAgents({
      apiKey: "pl_test",
      baseURL: "https://api.promptlayer.dev",
      exclusive: false,
    });

    expect(agentsModule.addTraceProcessor).toHaveBeenCalledWith(processor);
    expect(agentsModule.setTraceProcessors).not.toHaveBeenCalled();
  });

  it("throws when the api key is missing", async () => {
    await expect(
      instrumentOpenAIAgents({
        apiKey: "",
      })
    ).rejects.toThrow("PromptLayer API key not provided");
  });
});
