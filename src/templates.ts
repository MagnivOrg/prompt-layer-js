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
  throwOnError: boolean;

  constructor(apiKey: string, throwOnError: boolean = true) {
    this.apiKey = apiKey;
    this.throwOnError = throwOnError;
  }

  get = (promptName: string, params?: Partial<GetPromptTemplateParams>) =>
    getPromptTemplate(this.apiKey, promptName, params, this.throwOnError);

  publish = (body: PublishPromptTemplate) =>
    publishPromptTemplate(this.apiKey, body, this.throwOnError);

  all = (params?: Pagination) =>
    getAllPromptTemplates(this.apiKey, params, this.throwOnError);
}
