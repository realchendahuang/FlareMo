import type { MemoRow, UserRow } from "@flaremo/db";
import { Environment, type ParseResult } from "@marcbachmann/cel-js";
import { ValidationError } from "./errors";

const MAX_MEMO_FILTER_LENGTH = 4_096;
const MAX_MEMO_FILTER_AST_NODES = 512;

/**
 * A compiled Memos CEL filter.  The parser/evaluator is deliberately kept in
 * the domain package so REST, Connect-shaped JSON, and MCP all evaluate the
 * same expression against the same resource context.
 */
export type CompiledMemoFilter = (
  memo: MemoRow,
  user: UserRow | null,
) => boolean;

const memoFilterEnvironment = new Environment({
  // Memos filters are user supplied. Keep the parser bounded even before the
  // domain-level node count check below gets a chance to run.
  limits: {
    maxAstNodes: MAX_MEMO_FILTER_AST_NODES,
    maxDepth: 64,
    maxListElements: 128,
    maxMapEntries: 128,
    maxCallArguments: 16,
  },
  unlistedVariablesAreDyn: false,
})
  .registerVariable("content", "string")
  .registerVariable("creator", "string")
  .registerVariable("creator_id", "int")
  .registerVariable("created_ts", "google.protobuf.Timestamp")
  .registerVariable("updated_ts", "google.protobuf.Timestamp")
  .registerVariable("pinned", "bool")
  .registerVariable("visibility", "string")
  .registerVariable("state", "string")
  .registerVariable("tags", "list<string>")
  .registerVariable("tag", "string")
  .registerVariable("has_link", "bool")
  .registerVariable("has_task_list", "bool")
  .registerVariable("has_code", "bool")
  .registerVariable("has_incomplete_tasks", "bool")
  .registerVariable("now", "google.protobuf.Timestamp")
  .registerFunction(
    "flaremo_sets_contains(list<string>, list<string>): bool",
    (left: string[], right: string[]) =>
      distinctStrings(right).every((value) => left.includes(value)),
  )
  .registerFunction(
    "flaremo_sets_intersects(list<string>, list<string>): bool",
    (left: string[], right: string[]) =>
      distinctStrings(left).some((value) => right.includes(value)),
  )
  .registerFunction(
    "flaremo_sets_equivalent(list<string>, list<string>): bool",
    (left: string[], right: string[]) => {
      const leftSet = distinctStrings(left);
      const rightSet = distinctStrings(right);
      return (
        leftSet.length === rightSet.length &&
        leftSet.every((value) => rightSet.includes(value))
      );
    },
  );

export function compileMemoFilter(
  expression: string | undefined,
): CompiledMemoFilter | undefined {
  const value = expression?.trim();
  if (!value) return undefined;
  if (value.length > MAX_MEMO_FILTER_LENGTH) {
    throw new ValidationError("Memos filter is too long");
  }

  let compiled: ParseResult;
  try {
    compiled = memoFilterEnvironment.parse(
      normalizeMemoFilterExpression(value),
    );
  } catch (error) {
    throw new ValidationError(`Invalid Memos CEL filter: ${safeError(error)}`);
  }

  if (countAstNodes(compiled.ast) > MAX_MEMO_FILTER_AST_NODES) {
    throw new ValidationError("Memos filter is too complex");
  }

  const checked = compiled.check();
  if (!checked.valid) {
    throw new ValidationError(
      `Invalid Memos CEL filter: ${safeError(checked.error)}`,
    );
  }

  const frozenNow = new Date();
  const usesTagAlias = astContainsIdentifier(compiled.ast, "tag");

  return (memo, user) => {
    const context = memoFilterContext(memo, user, frozenNow);
    try {
      // Memos' `tag` is a virtual alias for membership in `tags`, not one
      // arbitrary scalar stored on a memo. Evaluating once per tag preserves
      // the existential semantics of the upstream `tag in [...]` form while
      // keeping CEL-JS' regular type checker in place.
      if (usesTagAlias) {
        return context.tags.some(
          (tag) => compiled({ ...context, tag }) === true,
        );
      }
      return compiled(context) === true;
    } catch (error) {
      throw new ValidationError(
        `Memos CEL filter evaluation failed: ${safeError(error)}`,
      );
    }
  };
}

export function memoFilterContext(
  memo: MemoRow,
  user: UserRow | null,
  now = new Date(),
) {
  const payload = isRecord(memo.payload) ? memo.payload : {};
  const property = isRecord(payload.property)
    ? (payload.property as Record<string, unknown>)
    : {};
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    name: memo.id,
    content: memo.content,
    creator: user?.id ?? memo.userId,
    creator_id: memoCreatorId(user?.id ?? memo.userId),
    created_ts: new Date(memo.createdAt),
    updated_ts: new Date(memo.updatedAt),
    pinned: memo.pinned,
    visibility: memo.visibility.toUpperCase(),
    state: memo.status.toUpperCase(),
    tags,
    has_link: property.has_link === true || property.hasLink === true,
    has_task_list:
      property.has_task_list === true || property.hasTaskList === true,
    has_code: property.has_code === true || property.hasCode === true,
    has_incomplete_tasks:
      property.has_incomplete_tasks === true ||
      property.hasIncompleteTasks === true,
    // Memos freezes `now` during filter compilation. This matters when a
    // long-running page scans many rows near a time boundary.
    now,
  };
}

function normalizeMemoFilterExpression(expression: string) {
  let normalized = expression
    .replaceAll("sets.contains(", "flaremo_sets_contains(")
    .replaceAll("sets.intersects(", "flaremo_sets_intersects(")
    .replaceAll("sets.equivalent(", "flaremo_sets_equivalent(");

  normalized = rewriteTagsAll(normalized);
  return normalized;
}

function rewriteTagsAll(expression: string) {
  const target = "tags.all(";
  let output = "";
  let cursor = 0;
  while (cursor < expression.length) {
    const match = findOutsideString(expression, target, cursor);
    if (match < 0) {
      output += expression.slice(cursor);
      break;
    }

    output += expression.slice(cursor, match);
    const end = findClosingParenthesis(expression, match + target.length - 1);
    if (end < 0) {
      output += expression.slice(match);
      break;
    }

    const call = expression.slice(match, end + 1);
    output += `(size(tags) > 0 && ${call})`;
    cursor = end + 1;
  }
  return output;
}

function findOutsideString(input: string, needle: string, from: number) {
  let quote: string | undefined;
  let escaped = false;
  for (let index = from; index <= input.length - needle.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (input.startsWith(needle, index)) return index;
  }
  return -1;
}

function findClosingParenthesis(input: string, opening: number) {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = opening; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function astContainsIdentifier(
  node: { op: string; args: unknown },
  name: string,
): boolean {
  if (node.op === "id") return node.args === name;
  const children = Array.isArray(node.args)
    ? node.args
    : node.args && typeof node.args === "object"
      ? Object.values(node.args)
      : [];
  return children.some((child) => {
    if (isAstNode(child)) return astContainsIdentifier(child, name);
    if (Array.isArray(child)) {
      return child.some((nested) =>
        isAstNode(nested) ? astContainsIdentifier(nested, name) : false,
      );
    }
    return false;
  });
}

function memoCreatorId(userId: string) {
  if (userId === "users/owner") return 1n;
  const numericId = /^users\/([1-9][0-9]*)$/.exec(userId)?.[1];
  if (numericId) {
    const parsed = BigInt(numericId);
    if (parsed <= 2_147_483_647n) return parsed;
  }

  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(userId)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  const value = BigInt(hash & 2_147_483_647);
  return value > 1n ? value : 2n;
}

function distinctStrings(values: string[]) {
  return [...new Set(values)];
}

function countAstNodes(node: { op: string; args: unknown }): number {
  let count = 1;
  const children = Array.isArray(node.args)
    ? node.args
    : node.args && typeof node.args === "object"
      ? Object.values(node.args)
      : [];
  for (const child of children) {
    if (isAstNode(child)) count += countAstNodes(child);
    else if (Array.isArray(child)) {
      for (const nested of child) {
        if (isAstNode(nested)) count += countAstNodes(nested);
      }
    }
  }
  return count;
}

function isAstNode(value: unknown): value is { op: string; args: unknown } {
  return Boolean(
    value && typeof value === "object" && "op" in value && "args" in value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "expression is not valid";
}
