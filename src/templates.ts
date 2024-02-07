import { GetPromptTemplateParams, PublishPromptTemplate } from "@/types";
import { getPromptTemplate, publishPromptTemplate } from "@/utils";

export const get = (
  promptName: string,
  params?: Partial<GetPromptTemplateParams>
) => getPromptTemplate(promptName, params);

export const publish = (body: PublishPromptTemplate) =>
  publishPromptTemplate(body);
