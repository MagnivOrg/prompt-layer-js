/** Unwrap CJS `module.exports = fn` default imports under native ESM. */
export const unwrapDefault = <T>(mod: T | { default: T }): T =>
  typeof mod === "function"
    ? mod
    : ((mod as { default: T }).default ?? (mod as T));
