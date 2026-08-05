import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  EvalCaseResult,
  EvalDefinition,
  EvalResult,
  EvalScoreCard,
  EvalScorerColumn,
  ResourceId,
  Column,
  Sheet,
  Table,
} from "@/types";
import * as tablesApi from "@/tables/api";
import { extractColumns, extractRows } from "@/tables/helpers";
import { fillRowCells, waitForSheetOperations } from "./polling";
import { waitForTraceRequestPrice } from "./tracePrice";
import {
  clearBlankScaffoldRows,
  EVAL_TABLE_LIST_PARAMS,
  ensureEvalScaffoldColumns,
  resolveCases,
  resolveSheet,
  resolveTable,
} from "./setup";
import {
  flushTraces,
  runCaseInSpan,
} from "./tracing";
import {
  buildCaseResult,
  buildTableDashboardUrl,
  buildTraceImportBody,
  columnsByTitle,
  customFieldTitles,
  findLastRow,
  normalizeEvalCases,
  parseCellValue,
} from "./utils";
import type { NormalizedEvalCase } from "./utils";
import {
  assertEvalArgs,
  assertPassingScore,
} from "./validation";
import type { EvalProcessingColumn } from "@/types";
import { validationError } from "./errors";
import {
  caseHasFailedScorer,
  collectFailingRowIndices,
  scorerPassRates,
} from "./scores";
import {
  configureScorecardFromScorers,
  extractScorecardOverallScore,
  fetchScorecardRowScores,
  recalculateAndWaitScorecard,
} from "./scorecard";
import { resolveOutputFromTraceRow } from "./trace-output";
import { formatScoreValue, getTerminal } from "./terminal";

type CaseExecution<TInput = unknown, TOutput = unknown> = {
  input: TInput;
  expected: unknown;
  expectedTrace: unknown;
  customFields: Record<string, unknown>;
  output: TOutput;
  traceId: string;
  spanId: string;
};

const runWithConcurrency = async <T, R>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onComplete?: (completed: number, total: number) => void
): Promise<R[]> => {
  let completed = 0;
  if (maxConcurrency === 1) {
    const sequential: R[] = [];
    for (let index = 0; index < items.length; index += 1) {
      sequential.push(await worker(items[index], index));
      onComplete?.(++completed, items.length);
    }
    return sequential;
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let failure: unknown;
  const workers = Array.from(
    { length: Math.max(1, Math.min(maxConcurrency, items.length)) },
    async () => {
      while (true) {
        if (failure !== undefined) return;
        const index = nextIndex++;
        if (index >= items.length) return;
        try {
          results[index] = await worker(items[index], index);
          onComplete?.(++completed, items.length);
        } catch (error) {
          failure = error;
          return;
        }
      }
    }
  );
  await Promise.all(workers);
  if (failure !== undefined) throw failure;
  return results;
};

const executeCases = async <TInput, TOutput>(args: {
  name: string;
  cases: NormalizedEvalCase<TInput>[];
  runner: (input: TInput) => TOutput | Promise<TOutput>;
  tracerProvider: NodeTracerProvider;
  maxConcurrency: number;
  tableId?: string | number | null;
  sheetId?: string | number | null;
}): Promise<CaseExecution<TInput, TOutput>[]> => {
  return runWithConcurrency(
    args.cases,
    args.maxConcurrency,
    async (caseItem) => {
      const [outputValue, traceId, spanId] = await runCaseInSpan(
        args.name,
        args.runner,
        caseItem.input,
        args.tracerProvider.getTracer("promptlayer.evals"),
        { tableId: args.tableId, sheetId: args.sheetId }
      );
      return {
        input: caseItem.input,
        expected: caseItem.expected,
        expectedTrace: caseItem.expectedTrace,
        customFields: caseItem.customFields,
        output: outputValue,
        traceId,
        spanId,
      };
    },
    (completed, total) => getTerminal().progress(completed, total)
  );
};

const postprocessTraceImport = (
  importResponse: Record<string, unknown> | null | undefined,
  outputValue: unknown,
  byTitle: Record<string, Column>,
  fallbackRow: Record<string, unknown> | null
): [number | null, Record<string, unknown> | null, unknown] => {
  let traceRow =
    importResponse?.row &&
    typeof importResponse.row === "object" &&
    !Array.isArray(importResponse.row)
      ? (importResponse.row as Record<string, unknown>)
      : null;
  let rowIndex =
    importResponse?.row_index != null
      ? Number(importResponse.row_index)
      : null;
  if (!traceRow) traceRow = fallbackRow;
  let resolvedOutput = outputValue;
  if (traceRow) {
    if (traceRow.row_index != null) rowIndex = Number(traceRow.row_index);
    resolvedOutput = resolveOutputFromTraceRow(
      traceRow,
      byTitle,
      outputValue
    );
  }
  return [rowIndex, traceRow, resolvedOutput];
};

const persistTraceRows = async <TInput, TOutput>(args: {
  apiKey: string;
  baseURL: string;
  throwOnError: boolean;
  tableId: ResourceId;
  sheetId: ResourceId;
  evalName: string;
  executed: CaseExecution<TInput, TOutput>[];
  byTitle: Record<string, Column>;
  customFieldTitles: readonly string[];
  tracerProvider: NodeTracerProvider;
}): Promise<
  [
    Array<number | null>,
    Array<Record<string, unknown> | null>,
    CaseExecution<TInput, TOutput>[],
  ]
> => {
  const rowIndices: Array<number | null> = [];
  const rows: Array<Record<string, unknown> | null> = [];
  const updated: CaseExecution<TInput, TOutput>[] = [];
  for (const execution of args.executed) {
    await flushTraces(args.tracerProvider, args.throwOnError);
    await waitForTraceRequestPrice(args.apiKey, args.baseURL, execution.traceId);
    const importResponse = await tablesApi.addTraceImport(
      args.apiKey,
      args.baseURL,
      args.throwOnError,
      buildTraceImportBody({
        traceId: execution.traceId,
        sheetId: args.sheetId,
        tableId: args.tableId,
        evalName: args.evalName,
      })
    );
    let fallbackRow: Record<string, unknown> | null = null;
    if (!(importResponse?.row && typeof importResponse.row === "object")) {
      const rowsPayload = await tablesApi.listSheetRows(
        args.apiKey,
        args.baseURL,
        args.throwOnError,
        args.tableId,
        args.sheetId,
        {
          ...EVAL_TABLE_LIST_PARAMS,
          order: "desc",
          limit: 1,
          include_columns: false,
        }
      );
      fallbackRow = findLastRow(rowsPayload);
    }
    const [rowIndex, traceRow, resolvedOutput] = postprocessTraceImport(
      importResponse,
      execution.output,
      args.byTitle,
      fallbackRow
    );
    const typedOutput = resolvedOutput as TOutput;
    if (traceRow) {
      const customValues = Object.fromEntries(
        args.customFieldTitles.map((title) => [
          title,
          execution.customFields[title] ?? "",
        ])
      );
      await fillRowCells(
        args.apiKey,
        args.baseURL,
        args.throwOnError,
        args.tableId,
        args.sheetId,
        traceRow,
        args.byTitle,
        {
          ...customValues,
          input: execution.input,
          expected: execution.expected,
          expectedTrace: execution.expectedTrace,
          output: typedOutput,
        }
      );
    }
    rowIndices.push(rowIndex);
    rows.push(traceRow);
    updated.push({
      ...execution,
      output: typedOutput,
    });
  }
  return [rowIndices, rows, updated];
};

const buildResults = <TInput, TOutput>(
  executed: CaseExecution<TInput, TOutput>[],
  rowIndices: Array<number | null>,
  scoresByRow: Record<number, Record<string, unknown>>,
  metadataByRow: Record<number, { price: number | null; latency: number | null }>
): EvalCaseResult<TInput, TOutput>[] => {
  const results: EvalCaseResult<TInput, TOutput>[] = [];
  executed.forEach((item, i) => {
    const rowIndex = rowIndices[i] ?? null;
    results.push(
      buildCaseResult({
        inputValue: item.input,
        expectedValue: item.expected,
        outputValue: item.output,
        scores: rowIndex != null ? scoresByRow[rowIndex] || {} : {},
        price: rowIndex != null ? metadataByRow[rowIndex]?.price : null,
        latency: rowIndex != null ? metadataByRow[rowIndex]?.latency : null,
        traceId: item.traceId,
        spanId: item.spanId,
        rowIndex,
      })
    );
  });
  return results;
};

const metricValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const fetchExecutionMetadataByRow = async (args: {
  apiKey: string;
  baseURL: string;
  throwOnError: boolean;
  tableId: ResourceId;
  sheetId: ResourceId;
  columns: Column[];
}): Promise<Record<number, { price: number | null; latency: number | null }>> => {
  const payload = await tablesApi.listAllSheetRows(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    args.tableId,
    args.sheetId,
    {
      ...EVAL_TABLE_LIST_PARAMS,
      include_execution_metadata_aggregates: true,
      include_columns: true,
    }
  );
  const payloadColumns = Array.isArray(payload?.columns)
    ? (payload.columns as Column[])
    : [];
  const byTitle = columnsByTitle([
    ...args.columns,
    ...payloadColumns,
  ]);
  const priceColumn = byTitle["Trace.price"];
  const latencyColumn = byTitle["Trace.latency"];
  const result: Record<
    number,
    { price: number | null; latency: number | null }
  > = {};
  for (const row of extractRows(payload)) {
    if (row.row_index == null) continue;
    const cells = (row.cells as Record<string, unknown>) || {};
    const parseMetric = (column?: Column): number | null => {
      if (!column) return null;
      const cell = cells[String(column.id)];
      return metricValue(
        parseCellValue(
          cell && typeof cell === "object"
            ? (cell as Record<string, unknown>)
            : null
        )
      );
    };
    result[Number(row.row_index)] = {
      price: parseMetric(priceColumn),
      latency: parseMetric(latencyColumn),
    };
  }
  return result;
};

const buildEvalResult = <TInput, TOutput>(args: {
  name: string;
  table: Table;
  sheet: Sheet;
  results: EvalCaseResult<TInput, TOutput>[];
  failedRowIndices: number[];
  scoreCards: EvalScoreCard[];
  apiBaseUrl: string;
}): EvalResult<TInput, TOutput> => {
  const url = buildTableDashboardUrl({
    apiBaseUrl: args.apiBaseUrl,
    workspaceId: args.table.workspace_id,
    tableId: args.table.id,
    sheetId: args.sheet.id,
  });
  const result: EvalResult<TInput, TOutput> = {
    name: args.name,
    tableId: args.table.id,
    sheetId: args.sheet.id,
    failedRowIndices: args.failedRowIndices,
    scoreCards: args.scoreCards,
    totalRows: args.results.length,
    results: args.results,
  };
  if (url) result.url = url;
  return result;
};

const emitEvaluationSummary = <TInput, TOutput>(args: {
  caseResults: EvalCaseResult<TInput, TOutput>[];
  scoreCards: EvalScoreCard[];
  includeFailureExamples: boolean;
}): void => {
  const terminal = getTerminal();
  if (args.scoreCards.length) terminal.evaluationResults(args.scoreCards);

  if (args.includeFailureExamples) {
    const failedCases = args.caseResults.filter(caseHasFailedScorer);
    let scorerTitles = args.scoreCards.map((row) => row.scorer);
    if (!scorerTitles.length) {
      for (const caseResult of args.caseResults) {
        for (const title of Object.keys(caseResult.scores || {})) {
          if (!scorerTitles.includes(title)) scorerTitles.push(title);
        }
      }
    }
    terminal.failureExamples(failedCases, { scorerTitles });
  }
};

interface RunEvalOptions<TInput, TOutput>
  extends EvalDefinition<TInput, TOutput> {
  apiKey: string;
  baseURL: string;
  throwOnError: boolean;
  tracerProvider: NodeTracerProvider;
}

const processingColumnIds = (
  sheetColumns: Column[],
  processingColumns: EvalProcessingColumn[]
): string[] => {
  const byTitle = columnsByTitle(sheetColumns);
  const ids: string[] = [];
  for (const definition of processingColumns) {
    const column = byTitle[definition.title];
    if (column?.id != null) ids.push(String(column.id));
  }
  return ids;
};

export const runEval = async <TInput, TOutput>(
  args: RunEvalOptions<TInput, TOutput>
): Promise<EvalResult<TInput, TOutput>> => {
  const maxConcurrency = args.maxConcurrency ?? 1;
  const { scorers: normalizedScorers, columns: processingColumns } =
    assertEvalArgs(args.name, args.dataset, args.runner, args.scorers, {
      columns: args.columns,
      tableId: args.tableId,
      sheetId: args.sheetId,
      folderId: args.folderId,
      experimentName: args.experimentName,
      maxConcurrency,
      passingScore: args.passingScore,
    });
  const tableId = args.tableId ?? null;
  const folderId = args.folderId ?? null;
  const includeFailureExamples = Boolean(args.includeFailureExamples);

  getTerminal().step("Resolving Table");
  const table = await resolveTable(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    {
      name: args.name,
      tableId,
      folderId,
    }
  );
  getTerminal().step("Preparing experiment sheet");
  const sheet = await resolveSheet(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    table.id,
    {
      sheetId: null,
      experimentName: args.experimentName,
      reuseDefaultSheet: tableId == null,
    }
  );

  getTerminal().step("Loading dataset");
  const resolvedCases = await resolveCases(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    args.dataset
  );
  const cases = normalizeEvalCases(resolvedCases);
  if (!cases.length) {
    throw validationError("Eval dataset resolved to zero cases.");
  }
  const datasetFieldTitles = customFieldTitles(cases);

  getTerminal().step("Setting up columns");
  const columnsResponse = await tablesApi.listSheetColumns(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    table.id,
    sheet.id,
    EVAL_TABLE_LIST_PARAMS
  );
  let columns = extractColumns(columnsResponse || {});
  columns = await ensureEvalScaffoldColumns(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    table.id,
    sheet.id,
    columns,
    {
      includeTraceColumns: true,
      includeExpectedTrace: cases.some(
        (caseItem) => caseItem.expectedTrace != null
      ),
      customFieldTitles: datasetFieldTitles,
      processingColumns,
    }
  );
  await clearBlankScaffoldRows(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    table.id,
    sheet.id
  );

  getTerminal().step("Setting up scorers");
  await configureScorecardFromScorers(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    table.id,
    sheet.id,
    columns,
    normalizedScorers,
    args.name
  );

  const byTitle = columnsByTitle(columns);
  getTerminal().step(
    `Running cases (${cases.length} case${cases.length === 1 ? "" : "s"}, concurrency=${maxConcurrency})`
  );
  getTerminal().runnersStart(cases.length);
  let executed = await executeCases({
    name: args.name,
    cases,
    runner: args.runner,
    tracerProvider: args.tracerProvider,
    maxConcurrency,
    tableId: table.id,
    sheetId: sheet.id,
  });

  getTerminal().step("Importing traces and writing rows");
  let rowIndices: Array<number | null>;
  [rowIndices, , executed] = await persistTraceRows({
    apiKey: args.apiKey,
    baseURL: args.baseURL,
    throwOnError: args.throwOnError,
    tableId: table.id,
    sheetId: sheet.id,
    evalName: args.name,
    executed,
    byTitle,
    customFieldTitles: datasetFieldTitles,
    tracerProvider: args.tracerProvider,
  });

  const processingIds = processingColumnIds(columns, processingColumns);
  if (processingIds.length) {
    getTerminal().step("Computing preprocessing columns");
    await waitForSheetOperations(
      args.apiKey,
      args.baseURL,
      args.throwOnError,
      table.id,
      sheet.id,
      {
        columnIds: processingIds,
        rowIds: rowIndices.filter((index): index is number => index != null),
        onProgress: (completed, total, failed, status) =>
          getTerminal().cellProgress(completed, total, failed, status),
      }
    );
  }

  getTerminal().step("Scoring rows");
  const scorecardPayload = await recalculateAndWaitScorecard(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    table.id,
    sheet.id,
    {
      onProgress: (completed, total, failed) =>
        getTerminal().scoringProgress(completed, total, failed),
    }
  );
  const scoresByRow = await fetchScorecardRowScores(
    args.apiKey,
    args.baseURL,
    args.throwOnError,
    table.id,
    sheet.id,
    rowIndices,
    scorecardPayload
  );

  const score = {
    aggregate_score: extractScorecardOverallScore(scorecardPayload),
    scorecard: scorecardPayload.scorecard,
    latest_calculation: scorecardPayload.latest_calculation,
    progress: scorecardPayload.progress,
  };

  const metadataByRow = await fetchExecutionMetadataByRow({
    apiKey: args.apiKey,
    baseURL: args.baseURL,
    throwOnError: args.throwOnError,
    tableId: table.id,
    sheetId: sheet.id,
    columns,
  });
  const caseResults = buildResults(
    executed,
    rowIndices,
    scoresByRow,
    metadataByRow
  );
  const failedIndices = collectFailingRowIndices(caseResults);
  const scoreCards = scorerPassRates(caseResults);

  let passed: boolean | undefined;
  if (args.passingScore !== undefined) {
    const overall = extractScorecardOverallScore(scorecardPayload);
    passed = overall !== null && overall >= args.passingScore;
  }
  getTerminal().score(formatScoreValue(score), passed);
  emitEvaluationSummary({
    caseResults,
    scoreCards,
    includeFailureExamples,
  });

  const result = buildEvalResult({
    name: args.name,
    table,
    sheet,
    results: caseResults,
    failedRowIndices: failedIndices,
    scoreCards,
    apiBaseUrl: args.baseURL,
  });

  assertPassingScore(score, args.passingScore, {
    result,
    failingRowIndices: failedIndices,
  });
  if (result.url) getTerminal().link(result.url);
  return result;
};
