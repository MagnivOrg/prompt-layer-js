import { validationError } from "../errors";

export const requireNonEmptyString = (
  value: unknown,
  label: string
): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError(`${label} must be a non-empty string.`);
  }
  return value;
};

export const requireNonNegativeInteger = (
  value: unknown,
  label: string
): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw validationError(`${label} must be a non-negative integer.`);
  }
  return value;
};
