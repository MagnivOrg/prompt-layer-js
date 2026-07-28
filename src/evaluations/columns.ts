import {
  ColumnType,
  EvalScorerColumn,
  ColumnTypeValue,
} from "@/types";
import { parseExpression } from "@babel/parser";
import generateModule from "@babel/generator";
import traverseModule from "@babel/traverse";
import * as t from "@babel/types";
import { unwrapDefault } from "@/utils/unwrap-default";
import { validationError } from "./errors";
import { isReservedEvalColumnTitle } from "./utils";

const generate = unwrapDefault(generateModule);
const traverse = unwrapDefault(traverseModule);

const SCORER_PARAM_COLUMN_ALIASES: Record<string, string> = {
  input: "Input",
  output: "Output",
  expected: "Expected",
  trace: "Trace",
};

export const column = (
  title: string,
  type: ColumnType | ColumnTypeValue | string,
  config?: Record<string, unknown>
): EvalScorerColumn => {
  if (typeof title !== "string" || !title.trim()) {
    throw validationError("Column title must be a non-empty string.");
  }
  if (isReservedEvalColumnTitle(title)) {
    throw validationError(
      `Eval column title '${title}' is reserved for built-in eval columns.`
    );
  }
  if (String(type).toUpperCase() === "TEXT") {
    throw validationError(
      "Eval columns cannot be TEXT; use dataset fields or built-in input/expected/output columns."
    );
  }
  const payload: EvalScorerColumn = {
    title,
    type,
  };
  if (config !== undefined) payload.config = config;
  return payload;
};

export const codeExecutionColumn = (
  title: string,
  options: {
    code: string;
    language?: "PYTHON" | "JAVASCRIPT";
  }
): EvalScorerColumn => {
  if (typeof options.code !== "string" || !options.code.trim()) {
    throw validationError("codeExecutionColumn requires non-empty code.");
  }
  return column(title, ColumnType.CODE_EXECUTION, {
    code: options.code,
    language: options.language ?? "JAVASCRIPT",
  });
};

const parseScorer = (
  fn: Function,
  fnName: string
): t.FunctionExpression | t.ArrowFunctionExpression => {
  const source = Function.prototype.toString.call(fn).trim();
  if (source.includes("[native code]") || source.startsWith("class ")) {
    throw validationError(`Scorer '${fnName}' must have serializable source.`);
  }
  let expression: t.Expression;
  try {
    expression = parseExpression(`(${source})`, {
      plugins: ["typescript"],
    });
  } catch {
    throw validationError(`Could not parse source for scorer '${fnName}'.`);
  }
  if (!t.isFunctionExpression(expression) && !t.isArrowFunctionExpression(expression)) {
    throw validationError(`Scorer '${fnName}' must be a named function or arrow function.`);
  }
  if (expression.async || expression.generator) {
    throw validationError("Async and generator scorer functions are not supported.");
  }
  return expression;
};

const paramName = (param: t.Function["params"][number]): string => {
  const value = t.isAssignmentPattern(param) ? param.left : param;
  if (!t.isIdentifier(value)) {
    throw validationError("Scorer parameters must be simple named parameters.");
  }
  return value.name;
};

const normalizeScoreReturn = (argument: t.Expression | null): t.Expression => {
  if (
    argument &&
    t.isObjectExpression(argument) &&
    argument.properties.length === 1
  ) {
    const property = argument.properties[0];
    if (
      t.isObjectProperty(property) &&
      !property.computed &&
      ((t.isIdentifier(property.key) && property.key.name === "score") ||
        (t.isStringLiteral(property.key) && property.key.value === "score")) &&
      t.isExpression(property.value)
    ) {
      return property.value;
    }
  }
  return argument ?? t.nullLiteral();
};

const scorerCode = (
  fn: Function,
  fnName: string
): { params: string[]; body: string } => {
  const expression = parseScorer(fn, fnName);
  const params = expression.params.map(paramName);
  const statements = t.isBlockStatement(expression.body)
    ? [...expression.body.body]
    : [t.returnStatement(expression.body)];

  while (
    statements.length &&
    t.isExpressionStatement(statements[0]) &&
    t.isStringLiteral(statements[0].expression)
  ) {
    statements.shift();
  }
  const rewritten = statements.map((statement) =>
    t.isReturnStatement(statement)
      ? t.expressionStatement(
          t.assignmentExpression(
            "=",
            t.identifier("result"),
            normalizeScoreReturn(statement.argument as t.Expression | null)
          )
        )
      : statement
  );
  const file = t.file(t.program(rewritten));
  traverse(file, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        !t.isMemberExpression(callee) ||
        !t.isIdentifier(callee.object, { name: "data" }) ||
        !t.isIdentifier(callee.property, { name: "get" }) ||
        path.node.arguments.length === 0
      ) {
        return;
      }
      const firstArg = path.node.arguments[0];
      if (!t.isStringLiteral(firstArg)) return;
      const mapped = SCORER_PARAM_COLUMN_ALIASES[firstArg.value];
      if (mapped) firstArg.value = mapped;
    },
    MemberExpression(path) {
      if (!t.isIdentifier(path.node.object, { name: "data" })) return;
      if (
        !path.node.computed &&
        t.isIdentifier(path.node.property) &&
        path.node.property.name in SCORER_PARAM_COLUMN_ALIASES
      ) {
        path.replaceWith(
          t.memberExpression(
            t.identifier("data"),
            t.identifier(SCORER_PARAM_COLUMN_ALIASES[path.node.property.name])
          )
        );
        return;
      }
      if (
        path.node.computed &&
        t.isStringLiteral(path.node.property) &&
        path.node.property.value in SCORER_PARAM_COLUMN_ALIASES
      ) {
        path.node.property.value =
          SCORER_PARAM_COLUMN_ALIASES[path.node.property.value];
      }
    },
  });
  const body = generate(file.program, { comments: true }).code;
  if (!body.trim()) throw validationError(`Scorer '${fnName}' has an empty body.`);
  return { params, body };
};

const bindParamsFromData = (params: string[]): string[] => {
  if (params.length === 1 && params[0] === "data") return [];
  return params.map((name) => {
    const columnTitle = SCORER_PARAM_COLUMN_ALIASES[name] ?? name;
    return `const ${name} = data.get(${JSON.stringify(columnTitle)});`;
  });
};

export const scorerFromFunction = (
  fn: (...args: unknown[]) => unknown,
  options: { title?: string } = {}
): EvalScorerColumn => {
  if (typeof fn !== "function") {
    throw validationError("scorerFromFunction requires a callable.");
  }
  const fnName = fn.name || "scorer";
  if (!fn.name || fnName === "anonymous") {
    throw validationError(
      "Lambda scorers are not supported; use a named function or codeExecutionColumn(...)."
    );
  }

  const parsed = scorerCode(fn, fnName);
  const bindLines = bindParamsFromData(parsed.params);
  const code = [...bindLines, parsed.body].join("\n") + "\n";
  const columnTitle =
    options.title ?? (fnName.replace(/_/g, " ").trim() || fnName);
  return codeExecutionColumn(columnTitle, {
    code,
    language: "JAVASCRIPT",
  });
};
