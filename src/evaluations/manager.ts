import type { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { EvalDefinition, EvalResult } from "@/types";
import { setupTracing } from "@/tracing";
import { runEval } from "./runner";

export class EvalManager {
  constructor(
    private apiKey: string,
    private baseURL: string,
    private throwOnError: boolean,
    private tracerProvider: NodeTracerProvider | null = null
  ) {}

  run = <TInput, TOutput>(
    definition: EvalDefinition<TInput, TOutput>
  ): Promise<EvalResult<TInput, TOutput>> => {
    const apiKey = definition.apiKey || this.apiKey;
    const baseURL = definition.baseURL || this.baseURL;
    let tracerProvider = this.tracerProvider;
    if (!tracerProvider) {
      tracerProvider = setupTracing(true, apiKey, baseURL);
    }
    return runEval({
      name: definition.name,
      dataset: definition.dataset,
      runner: definition.runner,
      scorers: definition.scorers,
      columns: definition.columns,
      apiKey,
      baseURL,
      throwOnError: this.throwOnError,
      tracerProvider,
      tableId: definition.tableId,
      sheetId: definition.sheetId,
      folderId: definition.folderId,
      experimentName: definition.experimentName,
      maxConcurrency: definition.maxConcurrency ?? 1,
      passingScore: definition.passingScore,
      includeFailureExamples: definition.includeFailureExamples,
    });
  };
}
