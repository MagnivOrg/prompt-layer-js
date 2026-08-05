import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSetupAgents } from "./agents";
import {
  DOCS_MCP_SERVER_NAME,
  DOCS_MCP_URL,
  SDK_EVALS_SKILLS_ZIP_URL,
} from "./constants";
import { installDocsMcpForAgents } from "./mcp";
import { runSetupCommand } from "./run";
import {
  ensureJsSdkAppendix,
  installSkillEntriesForAgents,
  installSkillForAgents,
} from "./skills";
import { createStoredZip, readZipEntries } from "./unzip";

const skillFixture = `---
name: Promptlayer
description: Test skill
---

# PromptLayer Skill

Base content.
`;

const evalSkillFixture = `---
name: sdk-eval-builder
description: Test eval skill
---

# SDK Eval Builder
`;

describe("resolveSetupAgents", () => {
  it("defaults to cursor and claude", () => {
    expect(resolveSetupAgents(undefined).map((agent) => agent.id)).toEqual([
      "cursor",
      "claude",
    ]);
  });

  it("accepts aliases and deduplicates", () => {
    expect(
      resolveSetupAgents(["claude-code", "cursor", "claude"]).map(
        (agent) => agent.id
      )
    ).toEqual(["claude", "cursor"]);
  });

  it("rejects unknown agents", () => {
    expect(() => resolveSetupAgents(["windsurf"])).toThrow(/Unknown agent/);
  });
});

describe("ensureJsSdkAppendix", () => {
  it("appends JS SDK guidance once", () => {
    const once = ensureJsSdkAppendix(skillFixture);
    const twice = ensureJsSdkAppendix(once);
    expect(once).toContain("JavaScript SDK guidance");
    expect(twice).toBe(once.endsWith("\n") ? once : `${once}\n`);
  });
});

describe("readZipEntries", () => {
  it("reads stored zip entries", () => {
    const zip = createStoredZip({
      "sdk-eval-builder/SKILL.md": evalSkillFixture,
      "sdk-eval-builder/references/model-comparison-eval.md": "# refs\n",
    });
    const entries = readZipEntries(zip);
    expect(Object.keys(entries).sort()).toEqual([
      "sdk-eval-builder/SKILL.md",
      "sdk-eval-builder/references/model-comparison-eval.md",
    ]);
    expect(new TextDecoder().decode(entries["sdk-eval-builder/SKILL.md"])).toBe(
      evalSkillFixture
    );
  });
});

describe("installSkillForAgents", () => {
  it("writes skill files and skips existing without --force", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pl-setup-skills-"));
    const agents = resolveSetupAgents(["cursor", "claude"]);
    const content = ensureJsSdkAppendix(skillFixture);

    const first = await installSkillForAgents({
      cwd,
      agents,
      skillContent: content,
    });
    expect(first.every((result) => result.status === "written")).toBe(true);

    const second = await installSkillForAgents({
      cwd,
      agents,
      skillContent: content,
    });
    expect(second.every((result) => result.status === "skipped")).toBe(true);

    const forced = await installSkillForAgents({
      cwd,
      agents,
      skillContent: `${content}\n# changed\n`,
      force: true,
    });
    expect(forced.every((result) => result.status === "updated")).toBe(true);

    const cursorSkill = await readFile(
      path.join(cwd, ".agents/skills/promptlayer/SKILL.md"),
      "utf8"
    );
    expect(cursorSkill).toContain("# changed");
  });
});

describe("installSkillEntriesForAgents", () => {
  it("installs zip skill trees under each agent skills directory", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pl-setup-eval-skills-"));
    const agents = resolveSetupAgents(["cursor", "claude"]);
    const files = readZipEntries(
      createStoredZip({
        "sdk-eval-builder/SKILL.md": evalSkillFixture,
        "sdk-eval-builder/references/model-comparison-eval.md": "# refs\n",
      })
    );

    const results = await installSkillEntriesForAgents({
      cwd,
      agents,
      files,
    });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.skillName === "sdk-eval-builder")).toBe(
      true
    );

    const cursorSkill = await readFile(
      path.join(cwd, ".agents/skills/sdk-eval-builder/SKILL.md"),
      "utf8"
    );
    const cursorRef = await readFile(
      path.join(
        cwd,
        ".agents/skills/sdk-eval-builder/references/model-comparison-eval.md"
      ),
      "utf8"
    );
    const claudeSkill = await readFile(
      path.join(cwd, ".claude/skills/sdk-eval-builder/SKILL.md"),
      "utf8"
    );
    expect(cursorSkill).toContain("SDK Eval Builder");
    expect(cursorRef).toContain("# refs");
    expect(claudeSkill).toContain("SDK Eval Builder");
  });
});

describe("installDocsMcpForAgents", () => {
  it("merges Cursor and Claude MCP configs without clobbering peers", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pl-setup-mcp-"));
    await mkdir(path.join(cwd, ".cursor"), { recursive: true });
    await writeFile(
      path.join(cwd, ".cursor/mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            other: { url: "https://example.com/mcp" },
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const agents = resolveSetupAgents(["cursor", "claude"]);
    const results = await installDocsMcpForAgents({ cwd, agents });
    expect(results.map((result) => result.status)).toEqual([
      "updated",
      "written",
    ]);

    const cursorConfig = JSON.parse(
      await readFile(path.join(cwd, ".cursor/mcp.json"), "utf8")
    );
    expect(cursorConfig.mcpServers.other.url).toBe("https://example.com/mcp");
    expect(cursorConfig.mcpServers[DOCS_MCP_SERVER_NAME]).toEqual({
      url: DOCS_MCP_URL,
    });

    const claudeConfig = JSON.parse(
      await readFile(path.join(cwd, ".mcp.json"), "utf8")
    );
    expect(claudeConfig.mcpServers[DOCS_MCP_SERVER_NAME]).toEqual({
      type: "http",
      url: DOCS_MCP_URL,
    });
  });

  it("skips existing Docs MCP entries unless forced", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pl-setup-mcp-skip-"));
    const agents = resolveSetupAgents(["claude"]);
    await installDocsMcpForAgents({ cwd, agents });
    const skipped = await installDocsMcpForAgents({ cwd, agents });
    expect(skipped[0]?.status).toBe("skipped");

    await writeFile(
      path.join(cwd, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            [DOCS_MCP_SERVER_NAME]: {
              type: "http",
              url: "https://example.com/old",
            },
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const withoutForce = await installDocsMcpForAgents({ cwd, agents });
    expect(withoutForce[0]?.status).toBe("skipped");

    const forced = await installDocsMcpForAgents({
      cwd,
      agents,
      force: true,
    });
    expect(forced[0]?.status).toBe("updated");
    const config = JSON.parse(
      await readFile(path.join(cwd, ".mcp.json"), "utf8")
    );
    expect(config.mcpServers[DOCS_MCP_SERVER_NAME].url).toBe(DOCS_MCP_URL);
  });
});

describe("runSetupCommand", () => {
  it("installs docs skill, sdk-evals skills, and docs MCP together", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "pl-setup-all-"));
    const logs: string[] = [];
    const zip = createStoredZip({
      "sdk-eval-builder/SKILL.md": evalSkillFixture,
      "sdk-eval-builder/references/model-comparison-eval.md": "# refs\n",
    });

    const result = await runSetupCommand({
      cwd,
      agents: ["cursor", "claude"],
      fetchText: async () => skillFixture,
      fetchBinary: async (url) => {
        expect(url).toBe(SDK_EVALS_SKILLS_ZIP_URL);
        return zip;
      },
      write: (message) => logs.push(message),
    });

    expect(result.skills).toHaveLength(4);
    expect(result.mcp).toHaveLength(2);
    expect(logs.some((line) => line.includes("SDK evals skills"))).toBe(true);
    expect(logs.some((line) => line.includes("Done."))).toBe(true);

    const skill = await readFile(
      path.join(cwd, ".claude/skills/promptlayer/SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("JavaScript SDK guidance");
    expect(skill).toContain("docs.promptlayer.com/llms.txt");

    const evalSkill = await readFile(
      path.join(cwd, ".agents/skills/sdk-eval-builder/SKILL.md"),
      "utf8"
    );
    expect(evalSkill).toContain("SDK Eval Builder");
  });
});
