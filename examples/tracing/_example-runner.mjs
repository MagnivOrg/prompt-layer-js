export const requireEnvironment = (name, alternatives = []) => {
  const names = [name, ...alternatives];
  for (const candidate of names) {
    const value = process.env[candidate];
    if (value) return value;
  }
  throw new Error(
    `${names.join(" or ")} is required`
  );
};

export const DEFAULT_TRACE_MODELS = Object.freeze({
  anthropic: "claude-sonnet-4-6",
  google: "gemini-2.5-flash-lite",
  openAI: "gpt-4.1-mini",
  openAIEmbedding: "text-embedding-3-small",
});

export const modelFromEnvironment = (name, fallback) =>
  process.env[name] ?? fallback;

export const missingEnvironment = (names) => {
  const missing = names.filter((name) => !process.env[name]);
  return missing.length > 0
    ? `missing ${missing.join(", ")}`
    : undefined;
};

const errorMessage = (error) => {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
};

export const runTracingChecks = async (checks) => {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const check of checks) {
    if (check.skip) {
      skipped += 1;
      console.log(`[skip] ${check.name}: ${check.skip}`);
      continue;
    }

    try {
      const detail = await check.run();
      passed += 1;
      console.log(
        `[pass] ${check.name}${detail ? `: ${detail}` : ""}`
      );
    } catch (error) {
      failed += 1;
      console.error(
        `[fail] ${check.name}\n${errorMessage(error)}`
      );
    }
  }

  console.log(
    `Tracing checks: ${passed} passed, ${failed} failed, ${skipped} skipped`
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
};
