import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getClaudeConfig } from "@/integrations/claude-agents/config";

const REQUIRED_PLUGIN_FILES = [
  ".claude-plugin/plugin.json",
  "hooks/hooks.json",
  "hooks/lib.sh",
  "hooks/session_start.sh",
  "hooks/user_prompt_submit.sh",
  "hooks/post_tool_use.sh",
  "hooks/stop_hook.sh",
  "hooks/session_end.sh",
  "hooks/hook_utils.py",
  "hooks/parse_stop_transcript.py",
];

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
}

describe("getClaudeConfig", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    vi.unstubAllEnvs();
    setPlatform(originalPlatform);
  });

  it("returns config when apiKey is provided explicitly", () => {
    const config = getClaudeConfig({ apiKey: "pl_explicit" });

    expect(config.env).toEqual({
      TRACE_TO_PROMPTLAYER: "true",
      PROMPTLAYER_API_KEY: "pl_explicit",
    });
    expect(config.plugin.type).toBe("local");
    expect(fs.existsSync(config.plugin.path)).toBe(true);
  });

  it("returns config when the api key comes from the environment", () => {
    vi.stubEnv("PROMPTLAYER_API_KEY", "pl_env");

    const config = getClaudeConfig();

    expect(config.env.PROMPTLAYER_API_KEY).toBe("pl_env");
  });

  it("prefers the explicit api key over the environment", () => {
    vi.stubEnv("PROMPTLAYER_API_KEY", "pl_env");

    const config = getClaudeConfig({ apiKey: "pl_explicit" });

    expect(config.env.PROMPTLAYER_API_KEY).toBe("pl_explicit");
  });

  it("throws when the api key is missing", () => {
    vi.stubEnv("PROMPTLAYER_API_KEY", "");

    expect(() => getClaudeConfig()).toThrow(
      "PromptLayer API key not provided. Please set PROMPTLAYER_API_KEY or pass apiKey."
    );
  });

  it("throws when an explicit api key is blank", () => {
    vi.stubEnv("PROMPTLAYER_API_KEY", "pl_env");

    expect(() => getClaudeConfig({ apiKey: "   " })).toThrow(
      "PromptLayer API key not provided. Please set PROMPTLAYER_API_KEY or pass apiKey."
    );
  });

  it("includes traceparent only when explicitly provided", () => {
    const withoutTraceparent = getClaudeConfig({ apiKey: "pl_test" });
    const withTraceparent = getClaudeConfig({
      apiKey: "pl_test",
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    });

    expect(withoutTraceparent.env.PROMPTLAYER_TRACEPARENT).toBeUndefined();
    expect(withTraceparent.env.PROMPTLAYER_TRACEPARENT).toBe(
      "00-11111111111111111111111111111111-2222222222222222-01"
    );
  });

  it("does not set debug or OTLP endpoint env in v1", () => {
    const config = getClaudeConfig({ apiKey: "pl_test" });

    expect(config.env).not.toHaveProperty("PROMPTLAYER_CC_DEBUG");
    expect(config.env).not.toHaveProperty("PROMPTLAYER_OTLP_ENDPOINT");
  });

  it("throws on Windows", () => {
    setPlatform("win32");

    expect(() => getClaudeConfig({ apiKey: "pl_test" })).toThrow(
      "PromptLayer Claude Agents integration does not support Windows. Use Linux or macOS."
    );
  });

  it("returns a plugin path with all required vendored files", () => {
    const config = getClaudeConfig({ apiKey: "pl_test" });

    expect(fs.statSync(config.plugin.path).isDirectory()).toBe(true);

    for (const relativePath of REQUIRED_PLUGIN_FILES) {
      expect(fs.existsSync(path.join(config.plugin.path, relativePath))).toBe(true);
    }
  });
});
