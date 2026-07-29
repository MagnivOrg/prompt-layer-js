import { createRequire } from "node:module";

export const requireProviderSDK = (() => {
  if (typeof __filename !== "undefined") {
    return createRequire(__filename);
  }
  // @ts-expect-error The ESM build preserves import.meta; the guarded CJS
  // build never evaluates this branch.
  return createRequire(import.meta.url);
})();
