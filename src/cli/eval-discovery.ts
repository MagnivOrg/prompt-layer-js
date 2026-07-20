import { access, constants, readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { homedir } from "node:os";
import fg from "fast-glob";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { unwrapDefault } from "@/utils/unwrap-default";

const traverse = unwrapDefault(traverseModule);

const EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);
const IGNORE = [
  "**/.*",
  "**/.*/*",
  "**/{.git,.hg,.svn,.tox,.venv,venv,node_modules,__pycache__,.mypy_cache,.pytest_cache,site-packages,dist-packages,dist,build,coverage,.cache,.turbo}/**",
];

const EVAL_ALIASES = new Set([
  "evaluate",
  "aevaluate",
  "async_evaluate",
  "asyncevaluate",
]);

const expandHome = (path: string): string =>
  path === "~" || path.startsWith("~/")
    ? resolve(homedir(), path.slice(2))
    : resolve(path);

const isEvalCallName = (name: string): boolean => {
  const normalized = name.toLowerCase();
  return (
    EVAL_ALIASES.has(normalized) ||
    normalized.endsWith("_eval") ||
    /Eval$/i.test(name)
  );
};

const containsEvalCall = async (path: string): Promise<boolean> => {
  try {
    const source = await readFile(path, "utf8");
    const ast = parse(source, {
      sourceType: "unambiguous",
      plugins: extname(path).includes("ts")
        ? ["typescript", "jsx"]
        : ["jsx"],
    });
    let found = false;
    traverse(ast, {
      CallExpression(callPath) {
        const callee = callPath.node.callee;
        let name: string | null = null;
        if (callee.type === "Identifier") name = callee.name;
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.type === "Identifier"
        ) {
          name = callee.property.name;
        }
        if (name && isEvalCallName(name)) {
          found = true;
          callPath.stop();
        }
      },
    });
    return found;
  } catch {
    return false;
  }
};

const assertPathExists = async (raw: string, absolute: string): Promise<void> => {
  try {
    await access(absolute, constants.F_OK);
  } catch {
    throw new Error(`Path not found: ${raw}`);
  }
};

const isHiddenFile = (path: string): boolean => basename(path).startsWith(".");

export const discoverEvalFiles = async (paths: string[]): Promise<string[]> => {
  const candidates: string[] = [];
  for (const input of paths) {
    const absolute = expandHome(input);
    await assertPathExists(input, absolute);
    if (EXTENSIONS.has(extname(absolute))) {
      candidates.push(absolute);
      continue;
    }
    const files = await fg("**/*.{js,mjs,cjs,ts,mts,cts}", {
      cwd: absolute,
      absolute: true,
      onlyFiles: true,
      unique: true,
      ignore: IGNORE,
      dot: false,
    });
    candidates.push(
      ...files.filter((file) => !isHiddenFile(file)).sort()
    );
  }
  const deduplicated = [...new Set(candidates)];
  const matches: string[] = [];
  for (const path of deduplicated) {
    if (await containsEvalCall(path)) matches.push(path);
  }
  return matches;
};
