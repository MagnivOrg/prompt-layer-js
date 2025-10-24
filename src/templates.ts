import {
  GetPromptTemplateParams,
  Pagination,
  PublishPromptTemplate,
} from "@/types";
import {
  getAllPromptTemplates,
  getPromptTemplate,
  publishPromptTemplate,
} from "@/utils/utils";

export class TemplateManager {
  apiKey: string;
  baseURL: string;
  throwOnError: boolean;

  constructor(apiKey: string, baseURL: string, throwOnError: boolean = true) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.throwOnError = throwOnError;
  }

  get = (promptName: string, params?: Partial<GetPromptTemplateParams>) =>
    getPromptTemplate(
      this.apiKey,
      this.baseURL,
      promptName,
      params,
      this.throwOnError
    );

  publish = (body: PublishPromptTemplate) =>
    publishPromptTemplate(this.apiKey, this.baseURL, body, this.throwOnError);

  all = (params?: Pagination) =>
    getAllPromptTemplates(this.apiKey, this.baseURL, params, this.throwOnError);
}
