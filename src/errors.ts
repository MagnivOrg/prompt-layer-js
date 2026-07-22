export class PromptLayerError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export class PromptLayerAPIError extends PromptLayerError {}

export class PromptLayerConnectionError extends PromptLayerAPIError {}

export class PromptLayerStatusError extends PromptLayerAPIError {
  readonly status: number;

  constructor(message: string, status: number, cause?: unknown) {
    super(message, cause);
    this.status = status;
  }
}

export class PromptLayerAuthenticationError extends PromptLayerStatusError {}

export class PromptLayerNotFoundError extends PromptLayerStatusError {
  constructor(message: string, status = 404, cause?: unknown) {
    super(message, status, cause);
  }
}

export class PromptLayerTimeoutError extends PromptLayerAPIError {}

export class PromptLayerValidationError extends PromptLayerError {}

export class EvaluationFailedError extends PromptLayerError {
  readonly score: unknown;
  readonly passingScore: number | null;
  readonly result: unknown | null;
  readonly failingRowIndices: number[];

  constructor(
    message: string,
    options: {
      score?: unknown;
      passingScore?: number | null;
      result?: unknown | null;
      failingRowIndices?: number[];
    } = {}
  ) {
    super(message);
    this.score = options.score ?? null;
    this.passingScore = options.passingScore ?? null;
    this.result = options.result ?? null;
    this.failingRowIndices = options.failingRowIndices ?? [];
  }
}
