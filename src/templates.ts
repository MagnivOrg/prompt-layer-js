import { GetPromptTemplateParams } from "@/types";
import { getPromptTemplate } from "@/utils";

export const get = (
  promptName: string,
  params?: Partial<GetPromptTemplateParams>
) => getPromptTemplate(promptName, params);
