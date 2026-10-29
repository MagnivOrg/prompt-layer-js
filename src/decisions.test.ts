import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureProviderSettings,
  getProviderConfig,
  openaiRequest,
  openrouterRequest,
} from "@/utils/utils";

const OpenAI = createRequire(import.meta.url)("openai").default;

const decisionKwargs = {
  model: "gpt-6-luna",
  input: "The package arrived with a broken screen.",
  questions: [
    { type: "predicate", name: "damaged", instructions: "Is it damaged?" },
  ],
};

const blueprint = {
  llm_kwargs: decisionKwargs,
  metadata: {
    model: { provider: "openai", name: "gpt-6-luna", api_type: "decisions" },
  },
  prompt_template: { type: "chat" },
};

describe("Decisions API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not send a stream flag", () => {
    const { kwargs } = configureProviderSettings(blueprint, undefined);
    expect(kwargs).toEqual(decisionKwargs);
  });

  it("rejects streaming", () => {
    expect(() =>
      configureProviderSettings(blueprint, undefined, {}, true)
    ).toThrow("does not support streaming");
  });

  it("logs runs as openai.decisions.create", () => {
    expect(
      getProviderConfig("openai:decisions", blueprint.prompt_template)
        .function_name
    ).toBe("openai.decisions.create");
  });

  it("posts to /decisions", async () => {
    const response = {
      answers: [{ type: "predicate", name: "damaged", probability: 0.95 }],
    };
    const post = vi.spyOn(OpenAI.prototype, "post").mockResolvedValue(response);

    await expect(
      openaiRequest(blueprint as never, { ...decisionKwargs, apiKey: "sk-test" })
    ).resolves.toEqual(response);
    expect(post).toHaveBeenCalledWith("/decisions", { body: decisionKwargs });
  });
});

const openrouterDecisionKwargs = {
  model: "openai/gpt-6-luna-decisions",
  state: "The package arrived with a broken screen.",
  questions: {
    damaged: { type: "noul", instructions: "Is the item damaged?" },
  },
};

const openrouterBlueprint = {
  llm_kwargs: openrouterDecisionKwargs,
  metadata: {
    model: {
      provider: "openrouter",
      name: "openai/gpt-6-luna-decisions",
      api_type: "decisions",
    },
  },
  prompt_template: { type: "chat" },
};

const openrouterDecisionResponse = {
  id: "dec_123",
  model: "openai/gpt-6-luna-decisions",
  provider: "OpenAI",
  answers: { damaged: { type: "noul", noul: 0.97 } },
  usage: { input_tokens: 20, output_tokens: 1, cost: 0.0001 },
};

describe("OpenRouter decisions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not send a stream flag", () => {
    const { provider_type, kwargs } = configureProviderSettings(
      openrouterBlueprint,
      undefined
    );
    expect(provider_type).toBe("openrouter");
    expect(kwargs).toEqual(openrouterDecisionKwargs);
  });

  it("rejects streaming", () => {
    expect(() =>
      configureProviderSettings(openrouterBlueprint, undefined, {}, true)
    ).toThrow("does not support streaming");
  });

  it("logs runs as openrouter.decisions.create", () => {
    expect(
      getProviderConfig(
        "openrouter:decisions",
        openrouterBlueprint.prompt_template
      ).function_name
    ).toBe("openrouter.decisions.create");
  });

  it("posts to the OpenRouter decisions endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(openrouterDecisionResponse), {
          status: 200,
        })
      );

    await expect(
      openrouterRequest(openrouterBlueprint as never, {
        ...openrouterDecisionKwargs,
        apiKey: "sk-or-test",
        baseURL: "https://example.test/api/v1",
      })
    ).resolves.toEqual(openrouterDecisionResponse);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer sk-or-test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init?.body as string)).toEqual(openrouterDecisionKwargs);
  });

  it("falls back to OPENROUTER_API_KEY", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-env");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(openrouterDecisionResponse))
      );

    await openrouterRequest(openrouterBlueprint as never, {
      ...openrouterDecisionKwargs,
    });

    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer sk-or-env",
    });
  });

  it("throws on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad request", { status: 400 })
    );

    await expect(
      openrouterRequest(openrouterBlueprint as never, {
        ...openrouterDecisionKwargs,
        apiKey: "sk-or-test",
      })
    ).rejects.toThrow("status 400");
  });
});
