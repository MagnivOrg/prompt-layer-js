import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requirePromptLayerApiKey } from "@/utils/utils";

export interface GetClaudeConfigOptions {
  apiKey?: string;
  traceparent?: string;
}

export interface PromptLayerClaudeAgentsPlugin {
  type: "local";
  path: string;
}

export interface PromptLayerClaudeAgentsEnv {
  TRACE_TO_PROMPTLAYER: "true";
  PROMPTLAYER_API_KEY: string;
  PROMPTLAYER_TRACEPARENT?: string;
}

export interface PromptLayerClaudeAgentsConfig {
  plugin: PromptLayerClaudeAgentsPlugin;
  env: PromptLayerClaudeAgentsEnv;
}

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
] as const;

const VENDORED_PLUGIN_RELATIVE_PATH = path.join("vendor", "claude-agents", "trace");

function currentModuleDir(): string {
  const originalPrepareStackTrace = Error.prepareStackTrace;

  try {
    Error.prepareStackTrace = (_error, stack) => stack;
    const callsites = new Error().stack as unknown as NodeJS.CallSite[] | undefined;
    const currentFile = callsites
      ?.map((callsite) => callsite.getFileName())
      .find((fileName) => fileName && !fileName.startsWith("node:"));

    if (!currentFile) {
      throw new Error(
        "PromptLayer Claude Agents could not determine its current module path."
      );
    }

    return path.dirname(
      currentFile.startsWith("file://") ? fileURLToPath(currentFile) : currentFile
    );
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }
}

function assertSupportedPlatform(): void {
  if (process.platform === "win32") {
    throw new Error(
      "PromptLayer Claude Agents integration does not support Windows. Use Linux or macOS."
    );
  }
}

function candidatePluginRoots(): string[] {
  const moduleDir = currentModuleDir();

  // Support all package layouts we exercise in development and publishing:
  // - source tests run from src/integrations/claude-agents/config.ts
  // - CJS consumers load dist/claude-agents.js
  // - ESM consumers load dist/esm/claude-agents.js
  // Each build places the current module at a different depth relative to
  // vendor/claude-agents/trace, so we probe the known stable offsets.
  return [
    path.resolve(moduleDir, "..", "..", "..", VENDORED_PLUGIN_RELATIVE_PATH),
    path.resolve(moduleDir, "..", VENDORED_PLUGIN_RELATIVE_PATH),
    path.resolve(moduleDir, "..", "..", VENDORED_PLUGIN_RELATIVE_PATH),
  ];
}

function assertRequiredVendoredFiles(pluginRoot: string): void {
  const missingFiles = REQUIRED_PLUGIN_FILES.filter(
    (relativePath) => !fs.existsSync(path.join(pluginRoot, relativePath))
  );

  if (missingFiles.length > 0) {
    throw new Error(
      `PromptLayer Claude Agents vendored plugin is incomplete. Missing: ${missingFiles.join(", ")}`
    );
  }
}

function resolvePluginRoot(): string {
  for (const candidate of candidatePluginRoots()) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const stats = fs.statSync(candidate);
    if (!stats.isDirectory()) {
      continue;
    }

    assertRequiredVendoredFiles(candidate);
    return candidate;
  }

  throw new Error(
    "PromptLayer Claude Agents vendored plugin was not found in the installed package."
  );
}

export function getClaudeConfig(
  options: GetClaudeConfigOptions = {}
): PromptLayerClaudeAgentsConfig {
  assertSupportedPlatform();

  const pluginPath = resolvePluginRoot();
  const apiKey = requirePromptLayerApiKey(options.apiKey);
  const traceparent = options.traceparent?.trim();

  const env: PromptLayerClaudeAgentsEnv = {
    TRACE_TO_PROMPTLAYER: "true",
    PROMPTLAYER_API_KEY: apiKey,
  };

  if (traceparent) {
    env.PROMPTLAYER_TRACEPARENT = traceparent;
  }

  return {
    plugin: {
      type: "local",
      path: pluginPath,
    },
    env,
  };
}
