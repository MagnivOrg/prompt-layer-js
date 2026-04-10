import {
  GetPromptTemplateParams,
  GetPromptTemplateResponse,
  Pagination,
  PublishPromptTemplate,
} from "@/types";
import {
  getAllPromptTemplates,
  getPromptTemplate,
  PromptLayerRetryableHttpError,
  publishPromptTemplate,
} from "@/utils/utils";
import {
  PromptTemplateCache,
  isLocallyRenderable,
  makeCacheParams,
  renderResponse,
  shouldSkipCache,
} from "@/utils/template-cache";

function isTransientError(error: unknown): boolean {
  if (error instanceof PromptLayerRetryableHttpError) return true;
  // Network-level failures (fetch TypeError)
  if (error instanceof TypeError) return true;
  const msg =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("network")
  ) {
    return true;
  }
  // 5xx errors that survived the retry policy
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number" && status >= 500) return true;
  }
  return false;
}

export class TemplateManager {
  apiKey: string;
  baseURL: string;
  throwOnError: boolean;
  private _cache: PromptTemplateCache | null;

  constructor(
    apiKey: string,
    baseURL: string,
    throwOnError: boolean = true,
    cache: PromptTemplateCache | null = null
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.throwOnError = throwOnError;
    this._cache = cache;
  }

  get = async (
    promptName: string,
    params?: Partial<GetPromptTemplateParams>
  ): Promise<GetPromptTemplateResponse | null> => {
    if (
      this._cache &&
      !shouldSkipCache(params as Record<string, unknown> | null)
    ) {
      return this._getWithCache(promptName, params);
    }
    return this._fetchNormal(promptName, params);
  };

  private _fetchNormal = (
    promptName: string,
    params?: Partial<GetPromptTemplateParams>
  ): Promise<GetPromptTemplateResponse | null> =>
    getPromptTemplate(
      this.apiKey,
      this.baseURL,
      promptName,
      params,
      this.throwOnError
    );

  private _getWithCache = async (
    promptName: string,
    params?: Partial<GetPromptTemplateParams>
  ): Promise<GetPromptTemplateResponse | null> => {
    const cache = this._cache!;
    const cacheKey = PromptTemplateCache.makeKey(
      promptName,
      params as Record<string, unknown> | null
    );
    const inputVariables = params?.input_variables as
      | Record<string, unknown>
      | undefined;

    if (cache.isNonRenderable(cacheKey)) {
      return this._fetchNormal(promptName, params);
    }

    const [cached, isFresh] = cache.get(cacheKey);

    if (cached !== null && isFresh) {
      return renderResponse(cached, inputVariables) as unknown as GetPromptTemplateResponse;
    }

    const stale = cached;

    const cacheParams = makeCacheParams(params as Record<string, unknown> | null);

    let apiResult;
    try {
      apiResult = await getPromptTemplate(
        this.apiKey,
        this.baseURL,
        promptName,
        cacheParams as Partial<GetPromptTemplateParams>,
        true
      );
    } catch (error) {
      if (isTransientError(error)) {
        if (stale !== null) {
          return renderResponse(stale, inputVariables) as unknown as GetPromptTemplateResponse;
        }
        if (!this.throwOnError) return null;
      }
      if (!this.throwOnError) return null;
      throw error;
    }

    if (!apiResult) return null;

    if (!isLocallyRenderable(apiResult as unknown as Record<string, unknown>)) {
      cache.markNonRenderable(cacheKey);
      return this._fetchNormal(promptName, params);
    }

    cache.put(cacheKey, apiResult as unknown as Record<string, unknown>);
    return renderResponse(
      apiResult as unknown as Record<string, unknown>,
      inputVariables
    ) as unknown as GetPromptTemplateResponse;
  };

  publish = async (body: PublishPromptTemplate) => {
    const result = await publishPromptTemplate(
      this.apiKey,
      this.baseURL,
      body,
      this.throwOnError
    );
    if (this._cache && result) {
      const promptName = (body as Record<string, unknown>)["prompt_name"] as
        | string
        | undefined;
      if (promptName) {
        this._cache.invalidate(promptName);
      }
    }
    return result;
  };

  all = (params?: Pagination) =>
    getAllPromptTemplates(this.apiKey, this.baseURL, params, this.throwOnError);
}
