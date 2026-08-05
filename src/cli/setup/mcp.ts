import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SetupAgent } from "./agents";
import { DOCS_MCP_SERVER_NAME, DOCS_MCP_URL } from "./constants";

export interface McpInstallResult {
  agent: SetupAgent;
  path: string;
  status: "written" | "updated" | "skipped" | "unsupported";
}

const cursorDocsServer = {
  url: DOCS_MCP_URL,
};

const claudeDocsServer = {
  type: "http",
  url: DOCS_MCP_URL,
};

const parseJsonObject = (raw: string, filePath: string): Record<string, unknown> => {
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse JSON in ${filePath}. Fix or remove it, then retry.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object in ${filePath}.`);
  }
  return parsed as Record<string, unknown>;
};

const mergeJsonMcpConfig = ({
  existingRaw,
  filePath,
  serverEntry,
  force,
}: {
  existingRaw: string | null;
  filePath: string;
  serverEntry: Record<string, unknown>;
  force: boolean;
}): { next: string; status: "written" | "updated" | "skipped" } => {
  const existing = existingRaw ? parseJsonObject(existingRaw, filePath) : {};
  const serversValue = existing.mcpServers;
  const servers =
    serversValue && typeof serversValue === "object" && !Array.isArray(serversValue)
      ? { ...(serversValue as Record<string, unknown>) }
      : {};

  const current = servers[DOCS_MCP_SERVER_NAME];
  const alreadyMatches =
    current &&
    typeof current === "object" &&
    !Array.isArray(current) &&
    JSON.stringify(current) === JSON.stringify(serverEntry);

  if (alreadyMatches && !force) {
    return {
      next: `${JSON.stringify(existing, null, 2)}\n`,
      status: "skipped",
    };
  }

  if (current && !force && !alreadyMatches) {
    return {
      next: `${JSON.stringify(existing, null, 2)}\n`,
      status: "skipped",
    };
  }

  servers[DOCS_MCP_SERVER_NAME] = serverEntry;
  const nextObject = {
    ...existing,
    mcpServers: servers,
  };
  return {
    next: `${JSON.stringify(nextObject, null, 2)}\n`,
    status: existingRaw ? "updated" : "written",
  };
};

const mergeCodexMcpConfig = ({
  existingRaw,
  force,
}: {
  existingRaw: string | null;
  force: boolean;
}): { next: string; status: "written" | "updated" | "skipped" } => {
  const sectionHeader = `[mcp_servers.${DOCS_MCP_SERVER_NAME}]`;
  const sectionBody = `${sectionHeader}\nurl = "${DOCS_MCP_URL}"\n`;
  const existing = existingRaw ?? "";

  if (existing.includes(sectionHeader)) {
    if (!force) {
      return { next: existing.endsWith("\n") ? existing : `${existing}\n`, status: "skipped" };
    }
    const next = existing.replace(
      /\[mcp_servers\.promptlayer-docs\][\s\S]*?(?=\n\[|$)/,
      sectionBody.trimEnd()
    );
    return {
      next: next.endsWith("\n") ? next : `${next}\n`,
      status: "updated",
    };
  }

  if (!existing.trim()) {
    return { next: `${sectionBody}\n`, status: "written" };
  }

  const prefix = existing.endsWith("\n") ? existing : `${existing}\n`;
  return { next: `${prefix}\n${sectionBody}\n`, status: "updated" };
};

export const installDocsMcpForAgents = async ({
  cwd,
  agents,
  force = false,
}: {
  cwd: string;
  agents: SetupAgent[];
  force?: boolean;
}): Promise<McpInstallResult[]> => {
  const results: McpInstallResult[] = [];
  const written = new Map<string, McpInstallResult["status"]>();

  for (const agent of agents) {
    if (!agent.mcpPath || agent.mcpFormat === "none") {
      results.push({
        agent,
        path: agent.mcpPath ?? "",
        status: "unsupported",
      });
      continue;
    }

    const absolutePath = path.resolve(cwd, agent.mcpPath);
    if (written.has(absolutePath)) {
      results.push({
        agent,
        path: agent.mcpPath,
        status: written.get(absolutePath) ?? "skipped",
      });
      continue;
    }

    let existingRaw: string | null = null;
    try {
      existingRaw = await readFile(absolutePath, "utf8");
    } catch {
      existingRaw = null;
    }

    let merged: { next: string; status: "written" | "updated" | "skipped" };
    if (agent.mcpFormat === "cursor") {
      merged = mergeJsonMcpConfig({
        existingRaw,
        filePath: agent.mcpPath,
        serverEntry: cursorDocsServer,
        force,
      });
    } else if (agent.mcpFormat === "claude") {
      merged = mergeJsonMcpConfig({
        existingRaw,
        filePath: agent.mcpPath,
        serverEntry: claudeDocsServer,
        force,
      });
    } else {
      merged = mergeCodexMcpConfig({ existingRaw, force });
    }

    if (merged.status !== "skipped") {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, merged.next, "utf8");
    }

    written.set(absolutePath, merged.status);
    results.push({
      agent,
      path: agent.mcpPath,
      status: merged.status,
    });
  }

  return results;
};

export const describeMcpInstall = (result: McpInstallResult): string => {
  const label = `${result.agent.label} Docs MCP (${DOCS_MCP_SERVER_NAME})`;
  if (result.status === "unsupported") {
    return `Skipped ${label}: no known MCP config path for this agent`;
  }
  if (result.status === "skipped") {
    return `Skipped ${label}: ${result.path} already configured (use --force to overwrite)`;
  }
  if (result.status === "updated") {
    return `Updated ${label}: ${result.path}`;
  }
  return `Installed ${label}: ${result.path}`;
};
