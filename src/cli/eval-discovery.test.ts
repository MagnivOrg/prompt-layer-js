import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverEvalFiles } from "./eval-discovery";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("eval discovery", () => {
  it("finds JS and TypeScript eval calls in deterministic order", async () => {
    const root = await mkdtemp(join(tmpdir(), "promptlayer-evals-"));
    roots.push(root);
    await writeFile(join(root, "b.eval.ts"), "await evaluate('b', options)");
    await writeFile(join(root, "a.js"), "runSupportEval()");
    await writeFile(join(root, "ignored.ts"), "export const value = 1");

    const files = await discoverEvalFiles([root]);

    expect(files.map((file) => file.slice(root.length + 1))).toEqual([
      "a.js",
      "b.eval.ts",
    ]);
  });

  it("skips dependency and hidden directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "promptlayer-evals-"));
    roots.push(root);
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, ".venv"), { recursive: true });
    await mkdir(join(root, ".hidden"), { recursive: true });
    await writeFile(join(root, "node_modules", "dep.js"), "evaluate('x', {})");
    await writeFile(join(root, ".venv", "lib.js"), "evaluate('x', {})");
    await writeFile(join(root, ".hidden", "private.js"), "evaluate('x', {})");
    await writeFile(join(root, "visible.js"), "evaluate('x', {})");

    const files = await discoverEvalFiles([root]);

    expect(files).toEqual([join(root, "visible.js")]);
  });

  it("skips hidden/dot files in directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "promptlayer-evals-"));
    roots.push(root);
    await writeFile(join(root, ".secret.eval.js"), "evaluate('x', {})");
    await writeFile(join(root, "visible.js"), "evaluate('x', {})");

    const files = await discoverEvalFiles([root]);

    expect(files).toEqual([join(root, "visible.js")]);
  });

  it("matches aevaluate, async_evaluate, and *_eval aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "promptlayer-evals-"));
    roots.push(root);
    await writeFile(join(root, "a.js"), "aevaluate('a', {})");
    await writeFile(join(root, "b.js"), "async_evaluate('b', {})");
    await writeFile(join(root, "c.js"), "runSupport_eval()");
    await writeFile(join(root, "d.js"), "export const value = 1");

    const files = await discoverEvalFiles([root]);

    expect(files.map((file) => file.slice(root.length + 1))).toEqual([
      "a.js",
      "b.js",
      "c.js",
    ]);
  });

  it("throws when a path does not exist", async () => {
    await expect(
      discoverEvalFiles([join(tmpdir(), "missing-promptlayer-evals-path")])
    ).rejects.toThrow(/Path not found:/);
  });

  it("requires explicit file paths to contain an eval call", async () => {
    const root = await mkdtemp(join(tmpdir(), "promptlayer-evals-"));
    roots.push(root);
    const plain = join(root, "plain.ts");
    await writeFile(plain, "export const value = 1");

    const files = await discoverEvalFiles([plain]);

    expect(files).toEqual([]);
  });
});
