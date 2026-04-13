import { describe, expect, it } from "vitest";
import { PromptLayer } from "@/index";
import { PromptTemplateCache } from "@/utils/template-cache";

describe("PromptLayer cache invalidation", () => {
  it("invalidates only the specified prompt name", () => {
    const client = new PromptLayer({
      apiKey: "test-key",
      baseURL: "https://api.promptlayer.com",
      cacheTtlSeconds: 60,
    });
    const cache = (client.templates as any)._cache as PromptTemplateCache;

    const alphaKey = PromptTemplateCache.makeKey("alpha");
    const betaKey = PromptTemplateCache.makeKey("beta");
    cache.put(alphaKey, { prompt_template: { type: "chat", messages: [] } });
    cache.put(betaKey, { prompt_template: { type: "chat", messages: [] } });

    client.invalidate("alpha");

    const [alphaCached] = cache.get(alphaKey);
    const [betaCached] = cache.get(betaKey);
    expect(alphaCached).toBeNull();
    expect(betaCached).not.toBeNull();
  });

  it("invalidates the entire cache when no prompt name is provided", () => {
    const client = new PromptLayer({
      apiKey: "test-key",
      baseURL: "https://api.promptlayer.com",
      cacheTtlSeconds: 60,
    });
    const cache = (client.templates as any)._cache as PromptTemplateCache;

    const firstKey = PromptTemplateCache.makeKey("first");
    const secondKey = PromptTemplateCache.makeKey("second");
    cache.put(firstKey, { prompt_template: { type: "chat", messages: [] } });
    cache.put(secondKey, { prompt_template: { type: "chat", messages: [] } });

    client.invalidate();

    const [firstCached] = cache.get(firstKey);
    const [secondCached] = cache.get(secondKey);
    expect(firstCached).toBeNull();
    expect(secondCached).toBeNull();
  });
});
