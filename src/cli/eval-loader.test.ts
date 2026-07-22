import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeEvalFile } from "./eval-loader";

const roots: string[] = [];

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).__promptlayerJitiFixture;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("eval loader", () => {
  it("executes TypeScript with file-local cwd and argv then restores them", async () => {
    const root = await mkdtemp(join(tmpdir(), "promptlayer-loader-"));
    roots.push(root);
    const file = join(root, "fixture.eval.ts");
    await writeFile(
      file,
      [
        "const payload: { cwd: string; argv: string } = {",
        "  cwd: process.cwd(),",
        "  argv: process.argv[1],",
        "};",
        "(globalThis as any).__promptlayerJitiFixture = payload;",
      ].join("\n")
    );
    const previousCwd = process.cwd();
    const previousArgv = process.argv;

    await executeEvalFile(file);

    expect(
      (globalThis as Record<string, any>).__promptlayerJitiFixture
    ).toEqual({ cwd: await realpath(root), argv: file });
    expect(process.cwd()).toBe(previousCwd);
    expect(process.argv).toBe(previousArgv);
  });
});
