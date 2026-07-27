import { register as registerLoader } from "node:module";
import { pathToFileURL } from "node:url";
import { configureTracing } from "@/tracing";

const isCommonJS = typeof __filename !== "undefined";

if (!isCommonJS) {
  // @ts-expect-error The ESM build preserves import.meta; the guarded CJS
  // build never evaluates this branch.
  const moduleURL: string | undefined = import.meta.url;
  const parentURL =
    typeof moduleURL === "string"
      ? moduleURL
      : pathToFileURL(`${process.cwd()}/`).href;
  registerLoader(
    "@opentelemetry/instrumentation/hook.mjs",
    parentURL
  );
}

configureTracing();
