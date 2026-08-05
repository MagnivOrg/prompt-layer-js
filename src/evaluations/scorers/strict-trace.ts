import { extractToolNames } from "../trace-tree";
import { validationError } from "../errors";

export type TrajectoryMode = "strict" | "non_strict";

const parseJsonValue = (raw: unknown): unknown => {
  if (raw && (typeof raw === "object" || Array.isArray(raw))) {
    return raw;
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
};

const parseToolList = (entries: unknown): string[] | null => {
  if (!Array.isArray(entries)) {
    return null;
  }
  const tools: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") return null;
    const toolName = entry.trim();
    if (!toolName) return null;
    tools.push(toolName);
  }
  return tools;
};

export const parseExpectedToolListsFromSource = (
  raw: unknown
): string[][] | null => {
  const parsed = parseJsonValue(raw);
  const scenarios = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>).accepted_scenarios
      : null;
  if (!Array.isArray(scenarios) || !scenarios.length) {
    return null;
  }

  const toolLists: string[][] = [];
  for (const scenario of scenarios) {
    const toolList = Array.isArray(scenario)
      ? parseToolList(scenario)
      : scenario && typeof scenario === "object"
        ? parseToolList(
            (scenario as Record<string, unknown>).required_tools
          )
        : null;
    if (!toolList) return null;
    toolLists.push(toolList);
  }
  return toolLists;
};

/** @deprecated Prefer parseExpectedToolListsFromSource for scenario support. */
export const parseExpectedToolsFromSource = (
  raw: unknown
): string[] | null => {
  const toolLists = parseExpectedToolListsFromSource(raw);
  if (!toolLists || toolLists.length !== 1) return null;
  return toolLists[0];
};

const isSubsequence = (required: string[], actual: string[]): boolean => {
  let reqIdx = 0;
  for (const name of actual) {
    if (reqIdx < required.length && name === required[reqIdx]) reqIdx += 1;
  }
  return reqIdx === required.length;
};

const matchToolSequence = (
  actual: string[],
  expected: string[],
  mode: TrajectoryMode
): boolean => {
  if (!expected.length) {
    return !actual.length;
  }
  if (mode === "strict") {
    return (
      actual.length === expected.length &&
      actual.every((tool, index) => tool === expected[index])
    );
  }
  return isSubsequence(expected, actual);
};

/** Score a trace against accepted scenarios from a column cell (0 or 1). */
export const scoreStrictTrace = (
  trace: unknown,
  expected: unknown,
  mode: TrajectoryMode = "strict"
): number => {
  const expectedLists = parseExpectedToolListsFromSource(expected);
  if (!expectedLists?.length) {
    throw validationError(
      "Trajectory expected value must be a non-empty array of tool-name arrays, " +
        'or an object with accepted_scenarios containing required_tools arrays.'
    );
  }
  const actual = extractToolNames(trace);
  return expectedLists.some((expectedTools) =>
    matchToolSequence(actual, expectedTools, mode)
  )
    ? 1
    : 0;
};

export const diagnoseStrictTraceFailure = (
  trace: unknown,
  expected: unknown,
  mode: TrajectoryMode = "strict"
): string | null => {
  if (expected == null) return "expected is missing or not a dict";

  const expectedLists = parseExpectedToolListsFromSource(expected);
  if (!expectedLists?.length) {
    return "expected tools could not be parsed from source";
  }

  if (trace == null) return "trace is missing or not a dict";

  const actual = extractToolNames(trace);
  if (
    expectedLists.some((expectedTools) =>
      matchToolSequence(actual, expectedTools, mode)
    )
  ) {
    return null;
  }

  if (expectedLists.length === 1) {
    const expectedTools = expectedLists[0];
    if (mode === "strict") {
      return `expected tools ${JSON.stringify(expectedTools)} but observed ${JSON.stringify(actual)}`;
    }
    return `required tool order ${JSON.stringify(expectedTools)} not satisfied by observed tools ${JSON.stringify(actual)}`;
  }

  return expectedLists
    .map((expectedTools, index) => {
      if (mode === "strict") {
        return `scenario ${index + 1}: expected tools ${JSON.stringify(expectedTools)} but observed ${JSON.stringify(actual)}`;
      }
      return `scenario ${index + 1}: required tool order ${JSON.stringify(expectedTools)} not satisfied by observed tools ${JSON.stringify(actual)}`;
    })
    .join("; ");
};
