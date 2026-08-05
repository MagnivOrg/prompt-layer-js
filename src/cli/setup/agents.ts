export type SetupAgentId = "cursor" | "claude" | "codex";

export interface SetupAgent {
  id: SetupAgentId;
  aliases: string[];
  label: string;
  /** Directory where agent skill packages are installed, e.g. `.agents/skills`. */
  skillsDir: string;
  mcpPath?: string;
  mcpFormat: "cursor" | "claude" | "codex" | "none";
}

export const SETUP_AGENTS: SetupAgent[] = [
  {
    id: "cursor",
    aliases: ["cursor", "cursor-cli"],
    label: "Cursor",
    skillsDir: ".agents/skills",
    mcpPath: ".cursor/mcp.json",
    mcpFormat: "cursor",
  },
  {
    id: "claude",
    aliases: ["claude", "claude-code", "claudecode"],
    label: "Claude Code",
    skillsDir: ".claude/skills",
    mcpPath: ".mcp.json",
    mcpFormat: "claude",
  },
  {
    id: "codex",
    aliases: ["codex"],
    label: "Codex",
    skillsDir: ".agents/skills",
    mcpPath: ".codex/config.toml",
    mcpFormat: "codex",
  },
];

export const DEFAULT_SETUP_AGENTS: SetupAgentId[] = ["cursor", "claude"];

export const skillPackagePath = (
  agent: SetupAgent,
  skillName: string
): string => `${agent.skillsDir}/${skillName}`;

export const resolveSetupAgents = (
  requested: string[] | undefined
): SetupAgent[] => {
  if (!requested?.length) {
    return SETUP_AGENTS.filter((agent) =>
      DEFAULT_SETUP_AGENTS.includes(agent.id)
    );
  }

  const selected = new Map<SetupAgentId, SetupAgent>();
  for (const raw of requested) {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "*" || normalized === "all") {
      for (const agent of SETUP_AGENTS) {
        selected.set(agent.id, agent);
      }
      continue;
    }
    const match = SETUP_AGENTS.find((agent) =>
      agent.aliases.includes(normalized)
    );
    if (!match) {
      const supported = SETUP_AGENTS.map((agent) => agent.id).join(", ");
      throw new Error(
        `Unknown agent "${raw}". Supported agents: ${supported}, or "*".`
      );
    }
    selected.set(match.id, match);
  }
  return [...selected.values()];
};
