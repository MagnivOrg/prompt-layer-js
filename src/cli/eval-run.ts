import { relative } from "node:path";
import { EvaluationFailedError } from "@/errors";
import {
  DefaultEvalTerminal,
  withEvalTerminal,
  type EvalTerminal,
} from "@/evaluations/terminal";
import { discoverEvalFiles } from "./eval-discovery";
import { executeEvalFile, loadEvalEnvironment } from "./eval-loader";

const EMPTY_DISCOVERY_MESSAGE =
  "No *.eval.{js,ts,...} files containing evaluate(...), aevaluate(...), or *_eval(...) calls were found.";

export const formatFailureDetail = (error: unknown): string => {
  if (error instanceof EvaluationFailedError) return error.message;
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
};

export const runEvalCommand = async (
  paths: string[],
  terminal: EvalTerminal = new DefaultEvalTerminal()
): Promise<number> => {
  let files: string[];
  try {
    await loadEvalEnvironment();
    files = await discoverEvalFiles(paths);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    terminal.write(message, { error: true });
    return 1;
  }

  if (!files.length) {
    terminal.write(EMPTY_DISCOVERY_MESSAGE, { error: true });
    return 1;
  }

  terminal.sessionStart(files.length);
  let passed = 0;
  let failed = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const display = relative(process.cwd(), file) || file;
    terminal.fileStart(display, index + 1, files.length);
    try {
      await withEvalTerminal(terminal, () => executeEvalFile(file));
      terminal.filePassed();
      passed += 1;
    } catch (error) {
      terminal.fileFailed(display, formatFailureDetail(error));
      failed += 1;
    }
  }
  terminal.sessionEnd(passed, failed);
  return failed ? 1 : 0;
};
