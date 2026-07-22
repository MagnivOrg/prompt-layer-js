import {
  PromptLayerAPIError,
  PromptLayerNotFoundError,
  PromptLayerTimeoutError,
  PromptLayerValidationError,
} from "@/errors";

export const validationError = (message: string): Error =>
  new PromptLayerValidationError(message);

export const apiError = (message: string): Error =>
  new PromptLayerAPIError(message);

export const notFoundError = (message: string): Error =>
  new PromptLayerNotFoundError(message);

export const timeoutError = (message: string): Error =>
  new PromptLayerTimeoutError(message);
