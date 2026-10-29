import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import "@/test-fixtures/setup-promptlayer-run-mocks";
import { PromptLayer } from "@/index";
import {
  configureProviderSettings,
  getProviderConfig,
  openrouterRequest,
  trackRequest,
} from "@/utils/utils";

const kwargs = {
  model: "openai/gpt-6-luna-decisions",
  state: "The package arrived with a broken screen.",
  questions: {
    damaged: { type: "noul", instructions: "Is the item damaged?" },
  },
};

const blueprint = {
  id: 1,
  version: 1,
  prompt_template: { type: "chat", messages: [] },
  metadata: {
    model: {
      provider: "openrouter",
      name: "openai/gpt-6-luna-decisions",
      api_type: "decisions",
      parameters: {},
    },
  },
  llm_kwargs: kwargs,
  custom_provider: null,
};

const response = {
  id: "dec_123",
  model: "openai/gpt-6-luna-decisions",
  answers: { damaged: { type: "noul", noul: 0.97 } },
  usage: { input_tokens: 20, output_tokens: 1, cost: 0.0001 },
};

describe("run() with an OpenRouter decision prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes to openrouter:decisions and logs the response", async () => {
    const client = new PromptLayer({ apiKey: "test-api-key" });
    client.templates.get = vi.fn().mockResolvedValue(blueprint);
    (configureProviderSettings as Mock).mockReturnValueOnce({
      provider_type: "openrouter",
      kwargs,
    });
    (getProviderConfig as Mock).mockReturnValueOnce({
      function_name: "openrouter.decisions.create",
      stream_function: undefined,
    });
    (openrouterRequest as Mock).mockResolvedValueOnce(response);

    await client.run({ promptName: "decision-prompt" });

    expect(getProviderConfig).toHaveBeenCalledWith(
      "openrouter:decisions",
      blueprint.prompt_template
    );
    expect(openrouterRequest).toHaveBeenCalledWith(blueprint, kwargs);
    expect(trackRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        function_name: "openrouter.decisions.create",
        provider_type: "openrouter",
        request_response: response,
      }),
      true
    );
  });
});
