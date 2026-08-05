import { resolveSetupAgents, type SetupAgentId } from "./agents";
import {
  DOCS_MCP_URL,
  DOCS_URL,
  SDK_EVALS_SKILLS_ZIP_URL,
} from "./constants";
import {
  describeMcpInstall,
  installDocsMcpForAgents,
  type McpInstallResult,
} from "./mcp";
import {
  describeSkillInstall,
  fetchPromptLayerSkill,
  fetchSdkEvalsSkillEntries,
  installSkillEntriesForAgents,
  installSkillForAgents,
  type FetchBinary,
  type FetchText,
  type SkillInstallResult,
} from "./skills";

export type SetupTarget = "all" | "skills" | "mcp";

export interface SetupOptions {
  cwd?: string;
  agents?: string[];
  force?: boolean;
  target?: SetupTarget;
  fetchText?: FetchText;
  fetchBinary?: FetchBinary;
  write?: (message: string) => void;
}

export interface SetupResult {
  agents: SetupAgentId[];
  skills: SkillInstallResult[];
  mcp: McpInstallResult[];
}

export const runSetupCommand = async (
  options: SetupOptions = {}
): Promise<SetupResult> => {
  const cwd = options.cwd ?? process.cwd();
  const force = options.force ?? false;
  const target = options.target ?? "all";
  const write =
    options.write ?? ((message: string) => process.stdout.write(`${message}\n`));
  const agents = resolveSetupAgents(options.agents);

  write(`Configuring PromptLayer for: ${agents.map((a) => a.label).join(", ")}`);

  const skills: SkillInstallResult[] = [];
  const mcp: McpInstallResult[] = [];

  if (target === "all" || target === "skills") {
    write(`Fetching PromptLayer skill from ${DOCS_URL}...`);
    const skillContent = await fetchPromptLayerSkill(options.fetchText);
    const promptlayerResults = await installSkillForAgents({
      cwd,
      agents,
      skillContent,
      force,
    });
    skills.push(...promptlayerResults);
    for (const result of promptlayerResults) {
      write(describeSkillInstall(result));
    }

    write(`Fetching SDK evals skills from ${SDK_EVALS_SKILLS_ZIP_URL}...`);
    const evalEntries = await fetchSdkEvalsSkillEntries(options.fetchBinary);
    const evalResults = await installSkillEntriesForAgents({
      cwd,
      agents,
      files: evalEntries,
      force,
    });
    skills.push(...evalResults);
    for (const result of evalResults) {
      write(describeSkillInstall(result));
    }
  }

  if (target === "all" || target === "mcp") {
    write(`Installing Docs MCP (${DOCS_MCP_URL})...`);
    const mcpResults = await installDocsMcpForAgents({ cwd, agents, force });
    mcp.push(...mcpResults);
    for (const result of mcpResults) {
      write(describeMcpInstall(result));
    }
  }

  write("Done. Restart or reload your coding agent to pick up the new config.");
  return {
    agents: agents.map((agent) => agent.id),
    skills,
    mcp,
  };
};
