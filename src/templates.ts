import {
  GetPromptTemplateParams,
  Pagination,
  PublishPromptTemplate,
} from "@/types";
import {
  getAllPromptTemplates,
  getPromptTemplate,
  publishPromptTemplate,
} from "@/utils";

export class TemplateManager {
  apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  get = (promptName: string, params?: Partial<GetPromptTemplateParams>) =>
    getPromptTemplate(this.apiKey, promptName, params);

  publish = (body: PublishPromptTemplate) =>
    publishPromptTemplate(this.apiKey, body);

  all = (params?: Pagination) => getAllPromptTemplates(this.apiKey, params);
}
