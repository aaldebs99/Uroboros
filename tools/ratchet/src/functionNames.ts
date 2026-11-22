/**
 * An ESLint rule that records where every function is and what it is called.
 *
 * `sonarjs/cognitive-complexity` reports a score at a function's head but not its name, and the
 * ratchet needs stable keys that survive edits elsewhere in the file. This rule runs in the same
 * ESLint pass and collects `{ name, start, end }` per function; the complexity gate then matches
 * each score to the innermost function containing the reported position.
 */
import { type Rule } from "eslint";

export type Position = { line: number; column: number };

export type FunctionSpan = { name: string; start: Position; end: Position };

export const ANONYMOUS = "<anonymous>";

type FunctionNode = Rule.Node & {
  type: "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression";
};

function keyName(key: { type: string; name?: string }): string | undefined {
  if (key.type === "Identifier") {
    return key.name;
  }
  return key.type === "PrivateIdentifier" && key.name !== undefined ? `#${key.name}` : undefined;
}

function ownName(node: FunctionNode): string | undefined {
  return node.type !== "ArrowFunctionExpression" && node.id ? node.id.name : undefined;
}

function parentName(parent: Rule.Node): string | undefined {
  switch (parent.type) {
    case "VariableDeclarator":
      return parent.id.type === "Identifier" ? parent.id.name : undefined;
    case "MethodDefinition":
    case "PropertyDefinition":
    case "Property":
      return parent.computed ? undefined : keyName(parent.key);
    case "AssignmentExpression":
      return parent.left.type === "Identifier" ? parent.left.name : undefined;
    default:
      return undefined;
  }
}

/** The name a human would call this function by. */
export function functionName(node: FunctionNode): string {
  return ownName(node) ?? parentName(node.parent) ?? ANONYMOUS;
}

/** Whether `position` lies within `span` (start inclusive, end exclusive). */
export function contains(span: FunctionSpan, position: Position): boolean {
  const after =
    position.line > span.start.line ||
    (position.line === span.start.line && position.column >= span.start.column);
  const before =
    position.line < span.end.line ||
    (position.line === span.end.line && position.column < span.end.column);
  return after && before;
}

/** The rule module. `spans` receives one entry per function, grouped by absolute file name. */
export function collectorRule(spans: Map<string, FunctionSpan[]>): Rule.RuleModule {
  return {
    meta: { type: "problem", schema: [] },
    create(context) {
      const record = (node: Rule.Node): void => {
        const loc = node.loc;
        if (!loc) {
          return;
        }
        // sonarjs reports a method at its key, which sits before the function value's range.
        const parent = node.parent;
        const head =
          (parent?.type === "MethodDefinition" || parent?.type === "Property") && parent.loc
            ? parent.loc.start
            : loc.start;
        const list = spans.get(context.filename) ?? [];
        list.push({
          name: functionName(node as FunctionNode),
          start: { line: head.line, column: head.column },
          end: { line: loc.end.line, column: loc.end.column },
        });
        spans.set(context.filename, list);
      };
      return {
        FunctionDeclaration: record,
        FunctionExpression: record,
        ArrowFunctionExpression: record,
      };
    },
  };
}
