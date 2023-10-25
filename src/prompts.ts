import { Pagination } from "@/types";
import { promptLayerAllPrompts } from "@/utils";

/**
 * @description List all prompts on PromptLayer.
 * @param params
 */
export const all = (params?: Pagination) => promptLayerAllPrompts(params);
