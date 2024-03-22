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

export const get = (
  promptName: string,
  params?: Partial<GetPromptTemplateParams>
) => getPromptTemplate(promptName, params);

export const publish = (body: PublishPromptTemplate) =>
  publishPromptTemplate(body);

export const all = (params?: Pagination) => getAllPromptTemplates(params);
