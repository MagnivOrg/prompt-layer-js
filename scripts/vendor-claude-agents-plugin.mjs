import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const SOURCE_REPOSITORY = "https://github.com/MagnivOrg/promptlayer-claude-plugins";
const REQUIRED_FILES = [
  "plugins/trace/.claude-plugin/plugin.json",
  "plugins/trace/setup.sh",
  "plugins/trace/hooks/hooks.json",
  "plugins/trace/hooks/lib.sh",
  "plugins/trace/hooks/session_start.sh",
  "plugins/trace/hooks/user_prompt_submit.sh",
  "plugins/trace/hooks/post_tool_use.sh",
  "plugins/trace/hooks/stop_hook.sh",
  "plugins/trace/hooks/session_end.sh",
  "plugins/trace/hooks/py/__init__.py",
  "plugins/trace/hooks/py/cli.py",
  "plugins/trace/hooks/py/context.py",
  "plugins/trace/hooks/py/handlers.py",
  "plugins/trace/hooks/py/otlp.py",
  "plugins/trace/hooks/py/settings.py",
  "plugins/trace/hooks/py/state.py",
  "plugins/trace/hooks/py/stop_parser.py",
  "plugins/trace/hooks/py/traceparent.py",
];

function parseSourceArg(argv) {
  const sourceIndex = argv.indexOf("--source");
  if (sourceIndex === -1 || sourceIndex + 1 >= argv.length) {
    throw new Error("Missing required --source /path/to/promptlayer-claude-plugins argument.");
  }

  return path.resolve(argv[sourceIndex + 1]);
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required vendoring source file is missing: ${filePath}`);
  }
}

function copyRequiredFiles(sourceRoot, destinationRoot) {
  for (const relativePath of REQUIRED_FILES) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const destinationPath = path.join(
      destinationRoot,
      relativePath.replace(/^plugins\/trace\//, "")
    );

    ensureFileExists(sourcePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function readCommitSha(sourceRoot) {
  return execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function writeVendorMetadata(destinationRoot, commitSha) {
  const metadataPath = path.join(destinationRoot, "vendor_metadata.json");
  const metadata = {
    repository: SOURCE_REPOSITORY,
    commit_sha: commitSha,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function main() {
  const sourceRoot = parseSourceArg(process.argv);
  const pluginSourceRoot = path.join(sourceRoot);
  const destinationRoot = path.resolve("vendor", "claude-agents");
  const destinationPluginRoot = path.join(destinationRoot, "trace");

  if (!fs.existsSync(pluginSourceRoot) || !fs.statSync(pluginSourceRoot).isDirectory()) {
    throw new Error(`Vendoring source directory does not exist: ${pluginSourceRoot}`);
  }

  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationPluginRoot, { recursive: true });

  copyRequiredFiles(pluginSourceRoot, destinationPluginRoot);
  writeVendorMetadata(destinationRoot, readCommitSha(pluginSourceRoot));

  process.stdout.write(
    `Vendored Claude Agents plugin from ${pluginSourceRoot} into ${destinationRoot}\n`
  );
}

main();
