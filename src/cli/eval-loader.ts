import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "dotenv";
import { createJiti } from "jiti";

const ENV_FILES = [
  ".env.development.local",
  ".env.local",
  ".env.development",
  ".env",
];

export const loadEvalEnvironment = async (
  cwd = process.cwd()
): Promise<void> => {
  for (const filename of ENV_FILES) {
    try {
      const values = parse(await readFile(resolve(cwd, filename)));
      for (const [key, value] of Object.entries(values)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }
};

export const executeEvalFile = async (filePath: string): Promise<void> => {
  const previousCwd = process.cwd();
  const previousArgv = process.argv;
  try {
    process.chdir(dirname(filePath));
    process.argv = [process.execPath, filePath];
    const jiti = createJiti(previousCwd, {
      interopDefault: true,
      moduleCache: false,
    });
    await jiti.import(filePath);
  } finally {
    process.argv = previousArgv;
    process.chdir(previousCwd);
  }
};
