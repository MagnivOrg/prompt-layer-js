import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { skillPackagePath, type SetupAgent } from "./agents";
import {
  JS_SDK_SKILL_APPENDIX,
  SDK_EVALS_SKILLS_ZIP_URL,
  SKILL_NAME,
  SKILL_SOURCE_URLS,
} from "./constants";
import { readZipEntries, type ZipEntries } from "./unzip";

export type FetchText = (url: string) => Promise<string>;
export type FetchBinary = (url: string) => Promise<Uint8Array>;

export interface SkillInstallResult {
  agent: SetupAgent;
  skillName: string;
  path: string;
  status: "written" | "skipped" | "updated";
}

const defaultFetchText: FetchText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
};

const defaultFetchBinary: FetchBinary = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

export const fetchPromptLayerSkill = async (
  fetchText: FetchText = defaultFetchText
): Promise<string> => {
  const errors: string[] = [];
  for (const url of SKILL_SOURCE_URLS) {
    try {
      const content = (await fetchText(url)).trimEnd();
      if (!content) {
        errors.push(`${url}: empty response`);
        continue;
      }
      return ensureJsSdkAppendix(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${url}: ${message}`);
    }
  }
  throw new Error(
    `Could not download the PromptLayer skill.\n${errors.join("\n")}`
  );
};

export const fetchSdkEvalsSkillEntries = async (
  fetchBinary: FetchBinary = defaultFetchBinary
): Promise<ZipEntries> => {
  const zip = await fetchBinary(SDK_EVALS_SKILLS_ZIP_URL);
  return readZipEntries(zip);
};

export const ensureJsSdkAppendix = (skillContent: string): string => {
  const trimmed = skillContent.trimEnd();
  if (trimmed.includes("JavaScript SDK guidance (from `promptlayer setup`)")) {
    return `${trimmed}\n`;
  }
  return `${trimmed}${JS_SDK_SKILL_APPENDIX}`;
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const writeSkillFile = async (
  absolutePath: string,
  content: string | Uint8Array,
  force: boolean
): Promise<"written" | "updated" | "skipped"> => {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const next =
    typeof content === "string"
      ? content
      : Buffer.from(content);

  try {
    const existing = await readFile(absolutePath);
    const same =
      typeof content === "string"
        ? existing.toString("utf8") === content
        : existing.equals(Buffer.from(content));
    if (same && !force) return "skipped";
    if (!force) return "skipped";
    await writeFile(absolutePath, next);
    return "updated";
  } catch {
    await writeFile(absolutePath, next);
    return "written";
  }
};

export const installSkillForAgents = async ({
  cwd,
  agents,
  skillName = SKILL_NAME,
  skillContent,
  force = false,
}: {
  cwd: string;
  agents: SetupAgent[];
  skillName?: string;
  skillContent: string;
  force?: boolean;
}): Promise<SkillInstallResult[]> => {
  const files: ZipEntries = {
    [`${skillName}/SKILL.md`]: new TextEncoder().encode(skillContent),
  };
  return installSkillEntriesForAgents({ cwd, agents, files, force });
};

export const installSkillEntriesForAgents = async ({
  cwd,
  agents,
  files,
  force = false,
}: {
  cwd: string;
  agents: SetupAgent[];
  files: ZipEntries;
  force?: boolean;
}): Promise<SkillInstallResult[]> => {
  const skillNames = [
    ...new Set(
      Object.keys(files)
        .map((entry) => entry.split("/")[0])
        .filter((name): name is string => Boolean(name))
    ),
  ];

  const results: SkillInstallResult[] = [];
  const handled = new Set<string>();

  for (const agent of agents) {
    for (const skillName of skillNames) {
      const relativeRoot = skillPackagePath(agent, skillName);
      const dedupeKey = `${agent.skillsDir}:${skillName}`;
      if (handled.has(dedupeKey)) {
        results.push({
          agent,
          skillName,
          path: relativeRoot,
          status: "skipped",
        });
        continue;
      }
      handled.add(dedupeKey);

      const absoluteRoot = path.resolve(cwd, relativeRoot);
      const rootExists = await pathExists(absoluteRoot);
      if (rootExists && !force) {
        results.push({
          agent,
          skillName,
          path: relativeRoot,
          status: "skipped",
        });
        continue;
      }

      let status: SkillInstallResult["status"] = rootExists ? "updated" : "written";
      for (const [entryPath, content] of Object.entries(files)) {
        if (!entryPath.startsWith(`${skillName}/`)) continue;
        const absolutePath = path.resolve(cwd, agent.skillsDir, entryPath);
        const fileStatus = await writeSkillFile(absolutePath, content, true);
        if (fileStatus === "written" && status !== "updated") {
          status = "written";
        } else if (fileStatus === "updated") {
          status = "updated";
        }
      }

      results.push({
        agent,
        skillName,
        path: relativeRoot,
        status,
      });
    }
  }

  return results;
};

export const describeSkillInstall = (result: SkillInstallResult): string => {
  const label = `${result.agent.label} skill (${result.skillName})`;
  if (result.status === "skipped") {
    return `Skipped ${label}: ${result.path} already exists (use --force to overwrite)`;
  }
  if (result.status === "updated") {
    return `Updated ${label}: ${result.path}`;
  }
  return `Installed ${label}: ${result.path}`;
};
