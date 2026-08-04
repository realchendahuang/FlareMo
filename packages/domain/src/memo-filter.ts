import type { MemoRow, UserRow } from "@flaremo/db";
import { type ParseResult, parse } from "@marcbachmann/cel-js";
import { ValidationError } from "./errors";

const MAX_MEMO_FILTER_LENGTH = 4_096;
const MAX_MEMO_FILTER_AST_NODES = 512;

/**
 * A compiled Memos CEL filter.  The parser/evaluator is deliberately kept in
 * the domain package so REST, Connect-shaped JSON, and MCP all evaluate the
 * same expression against the same resource context.
 */
export type CompiledMemoFilter = (memo: MemoRow, user: UserRow) => boolean;

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
    compiled = parse(value);
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

  return (memo, user) => {
    try {
      return compiled(memoFilterContext(memo, user)) === true;
    } catch (error) {
      throw new ValidationError(
        `Memos CEL filter evaluation failed: ${safeError(error)}`,
      );
    }
  };
}

export function memoFilterContext(memo: MemoRow, user: UserRow) {
  const payload = isRecord(memo.payload) ? memo.payload : {};
  const property = isRecord(payload.property) ? payload.property : {};
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  return {
    name: memo.id,
    content: memo.content,
    creator: user.id,
    created_ts: new Date(memo.createdAt),
    updated_ts: new Date(memo.updatedAt),
    pinned: memo.pinned,
    visibility: memo.visibility.toUpperCase(),
    state: memo.status.toUpperCase(),
    tags,
    has_link: property.has_link === true,
    has_task_list: property.has_task_list === true,
    has_code: property.has_code === true,
    has_incomplete_tasks: property.has_incomplete_tasks === true,
    // Memos CEL examples use `now - duration(...)`; CEL-JS does not expose a
    // process-global `now`, so bind one per request/evaluation context.
    now: new Date(),
  };
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
