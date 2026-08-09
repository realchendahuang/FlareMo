import type { AttachmentRow, MemoRow, UserRow } from "@flaremo/db";
import { Environment, type ParseResult } from "@marcbachmann/cel-js";
import { ValidationError } from "./errors";

const MAX_MEMO_FILTER_LENGTH = 4_096;
const MAX_MEMO_FILTER_AST_NODES = 512;
const MAX_MEMO_FILTER_REGEX_LENGTH = 1_024;
const MAX_MEMO_FILTER_REGEX_CACHE_ENTRIES = 256;

const memoFilterRegexCache = new Map<string, RegExp>();

type MemoFilterAst = {
  op: string;
  args: unknown;
};

/**
 * A compiled Memos CEL filter.  The parser/evaluator is deliberately kept in
 * the domain package so REST, Connect-shaped JSON, and MCP all evaluate the
 * same expression against the same resource context.
 */
export type CompiledMemoFilter = (
  memo: MemoRow,
  user: UserRow | null,
) => boolean;

export type CompiledAttachmentFilter = (attachment: AttachmentRow) => boolean;

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
  // AttachmentService uses the same CEL runtime with a smaller schema. Keep
  // these variables in the shared environment so both filters use identical
  // parsing, timestamp, duration, arithmetic, and string-method semantics.
  .registerVariable("filename", "string")
  .registerVariable("mime_type", "string")
  .registerVariable("create_time", "google.protobuf.Timestamp")
  // cel-js names CEL's dynamic/any type `dyn`.
  .registerVariable("memo_id", "dyn")
  .registerVariable("memo", "string")
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
  )
  .registerFunction(
    "flaremo_tag_in(list<string>, list<string>): bool",
    (tags: string[], candidates: string[]) =>
      candidates.some((candidate) =>
        tags.some(
          (tag) => tag === candidate || tag.startsWith(`${candidate}/`),
        ),
      ),
  )
  .registerFunction(
    "string.flaremo_contains(string): bool",
    (left: string, right: string) =>
      left.toLowerCase().includes(right.toLowerCase()),
  )
  .registerFunction(
    "string.flaremo_startsWith(string): bool",
    (left: string, right: string) =>
      left.toLowerCase().startsWith(right.toLowerCase()),
  )
  .registerFunction(
    "string.flaremo_endsWith(string): bool",
    (left: string, right: string) =>
      left.toLowerCase().endsWith(right.toLowerCase()),
  )
  .registerFunction(
    "string.flaremo_matches(string): bool",
    (left: string, pattern: string) => {
      const regex = getMemoFilterRegex(pattern);
      return regex.test(left);
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
  rejectReservedImplementationNames(value);

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
  if (checked.type !== "bool") {
    throw new ValidationError(
      "Invalid Memos CEL filter: filter must evaluate to a boolean",
    );
  }

  validateMemoFilterSurface(compiled.ast);

  const frozenNow = new Date();

  return (memo, user) => {
    const context = memoFilterContext(memo, user, frozenNow);
    try {
      return compiled(context) === true;
    } catch (error) {
      throw new ValidationError(
        `Memos CEL filter evaluation failed: ${safeError(error)}`,
      );
    }
  };
}

/**
 * Compile the pinned upstream AttachmentService filter schema.
 *
 * Memos' Go server evaluates this schema with CEL before rendering it to SQL.
 * FlareMo has no SQL-rendering CEL compiler on Workers, so it evaluates the
 * same bounded expression against attachment metadata after applying the
 * owner/deleted/state boundary in the domain service. The route never gets a
 * second ad-hoc filter grammar.
 */
export function compileAttachmentFilter(
  expression: string | undefined,
): CompiledAttachmentFilter | undefined {
  const value = expression?.trim();
  if (!value) return undefined;
  if (value.length > MAX_MEMO_FILTER_LENGTH) {
    throw new ValidationError("Memos filter is too long");
  }
  rejectReservedImplementationNames(value);

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
  if (checked.type !== "bool") {
    throw new ValidationError(
      "Invalid Memos CEL filter: filter must evaluate to a boolean",
    );
  }

  validateAttachmentFilterSurface(compiled.ast);
  const frozenNow = new Date();

  return (attachment) => {
    // Upstream exposes memo_id as CEL's nullable/dynamic value. Keep the
    // null case distinct from an empty resource name so `memo_id == null`
    // retains the same meaning for unbound attachments.
    const memoId = attachment.memoId ?? null;
    try {
      return (
        compiled({
          filename: attachment.filename,
          mime_type: attachment.contentType ?? "",
          create_time: new Date(attachment.createdAt),
          memo_id: memoId,
          memo: memoId,
          now: frozenNow,
        }) === true
      );
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
  let normalized = rewriteOutsideStringLiterals(expression, (code) =>
    code
      .replace(
        /\bsets\s*\.\s*(contains|intersects|equivalent)\s*\(/g,
        (_, name: string) => `flaremo_sets_${name}(`,
      )
      .replace(
        /\.\s*(contains|startsWith|endsWith|matches)\s*(?=\()/g,
        (_, name: string) => `.flaremo_${name}`,
      ),
  );

  normalized = rewriteTagsAll(normalized);
  normalized = rewriteTagAliasIn(normalized);
  return normalized;
}

function rewriteTagsAll(expression: string) {
  let output = "";
  let cursor = 0;
  while (cursor < expression.length) {
    const match = findQualifiedCall(expression, "tags", "all", cursor);
    if (!match) {
      output += expression.slice(cursor);
      break;
    }

    const end = findClosingDelimiter(expression, match.opening);
    if (end < 0) {
      output += expression.slice(cursor);
      break;
    }

    output += expression.slice(cursor, match.start);
    const call = expression.slice(match.start, end + 1);
    output += `(size(tags) > 0 && ${call})`;
    cursor = end + 1;
  }
  return output;
}

function rewriteTagAliasIn(expression: string) {
  let output = "";
  let cursor = 0;
  while (cursor < expression.length) {
    const match = findTagInList(expression, cursor);
    if (!match) {
      output += expression.slice(cursor);
      break;
    }

    output += expression.slice(cursor, match.start);
    output += `flaremo_tag_in(tags,${expression.slice(match.listStart, match.end + 1)})`;
    cursor = match.end + 1;
  }
  return output;
}

function rewriteOutsideStringLiterals(
  input: string,
  rewrite: (code: string) => string,
) {
  let output = "";
  let segmentStart = 0;
  let index = 0;

  while (index < input.length) {
    if (!isStringDelimiter(input[index])) {
      index += 1;
      continue;
    }

    output += rewrite(input.slice(segmentStart, index));
    const end = findStringLiteralEnd(input, index);
    if (end < 0) {
      output += input.slice(index);
      return output;
    }
    output += input.slice(index, end);
    index = end;
    segmentStart = end;
  }

  return output + rewrite(input.slice(segmentStart));
}

function findQualifiedCall(
  input: string,
  receiver: string,
  method: string,
  from: number,
) {
  for (let index = from; index < input.length; index += 1) {
    if (isStringDelimiter(input[index])) {
      const end = findStringLiteralEnd(input, index);
      if (end < 0) return undefined;
      index = end - 1;
      continue;
    }
    if (!input.startsWith(receiver, index)) continue;
    if (
      isIdentifierCharacter(input[index - 1]) ||
      isIdentifierCharacter(input[index + receiver.length])
    ) {
      continue;
    }

    let cursor = skipWhitespace(input, index + receiver.length);
    if (input[cursor] !== ".") continue;
    cursor = skipWhitespace(input, cursor + 1);
    if (!input.startsWith(method, cursor)) continue;
    if (
      isIdentifierCharacter(input[cursor - 1]) ||
      isIdentifierCharacter(input[cursor + method.length])
    ) {
      continue;
    }
    cursor = skipWhitespace(input, cursor + method.length);
    if (input[cursor] !== "(") continue;
    return { start: index, opening: cursor };
  }
  return undefined;
}

function findTagInList(input: string, from: number) {
  for (let index = from; index < input.length; index += 1) {
    if (isStringDelimiter(input[index])) {
      const end = findStringLiteralEnd(input, index);
      if (end < 0) return undefined;
      index = end - 1;
      continue;
    }
    if (!input.startsWith("tag", index)) continue;
    if (
      isIdentifierCharacter(input[index - 1]) ||
      isIdentifierCharacter(input[index + 3])
    ) {
      continue;
    }

    let cursor = skipWhitespace(input, index + 3);
    if (!input.startsWith("in", cursor)) continue;
    if (
      isIdentifierCharacter(input[cursor - 1]) ||
      isIdentifierCharacter(input[cursor + 2])
    ) {
      continue;
    }
    cursor = skipWhitespace(input, cursor + 2);
    if (input[cursor] !== "[") continue;
    const end = findClosingDelimiter(input, cursor);
    if (end < 0) return undefined;
    return { start: index, listStart: cursor, end };
  }
  return undefined;
}

function findClosingDelimiter(input: string, opening: number) {
  const expected = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]);
  const closing = new Set(expected.values());
  const stack: string[] = [];

  for (let index = opening; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) continue;
    if (isStringDelimiter(character)) {
      const end = findStringLiteralEnd(input, index);
      if (end < 0) return -1;
      index = end - 1;
      continue;
    }
    if (expected.has(character)) {
      stack.push(expected.get(character) as string);
      continue;
    }
    if (!closing.has(character)) continue;
    if (stack.pop() !== character) return -1;
    if (stack.length === 0) return index;
  }
  return -1;
}

function findStringLiteralEnd(input: string, start: number) {
  const delimiter = input[start];
  if (delimiter === undefined) return -1;
  const triple = input.startsWith(delimiter.repeat(3), start);
  const width = triple ? 3 : 1;

  for (let index = start + width; index < input.length; index += 1) {
    if (input[index] === "\\") {
      index += 1;
      continue;
    }
    if (
      triple
        ? input.startsWith(delimiter.repeat(3), index)
        : input[index] === delimiter
    ) {
      return index + width;
    }
  }
  return -1;
}

function isStringDelimiter(value: string | undefined) {
  return value === '"' || value === "'" || value === "`";
}

function isIdentifierCharacter(value: string | undefined) {
  return value !== undefined && /[A-Za-z0-9_]/.test(value);
}

function skipWhitespace(input: string, from: number) {
  let index = from;
  while (/\s/.test(input[index] ?? "")) index += 1;
  return index;
}

const memoFilterBooleanFields = new Set([
  "pinned",
  "has_link",
  "has_task_list",
  "has_code",
  "has_incomplete_tasks",
]);
const memoFilterStringFields = new Set([
  "content",
  "creator",
  "visibility",
  "state",
]);
const memoFilterAllowedIds = new Set([
  ...memoFilterBooleanFields,
  ...memoFilterStringFields,
  "creator_id",
  "created_ts",
  "updated_ts",
  "tags",
  "now",
]);

function rejectUnsupported(message: string): never {
  throw new ValidationError(`Invalid Memos CEL filter: ${message}`);
}

function rejectReservedImplementationNames(expression: string) {
  let found = false;
  rewriteOutsideStringLiterals(expression, (code) => {
    if (
      /\bflaremo_(?:sets_(?:contains|intersects|equivalent)|tag_in|(?:contains|startsWith|endsWith|matches))\b/.test(
        code,
      )
    ) {
      found = true;
    }
    return code;
  });
  if (found) {
    rejectUnsupported("reserved implementation helper is not public");
  }
}

function validateMemoFilterSurface(node: MemoFilterAst) {
  visitMemoFilterAst(node, new Set<string>());
}

function validateAttachmentFilterSurface(node: MemoFilterAst) {
  visitAttachmentFilterAst(node, new Set<string>());
}

function visitAttachmentFilterAst(node: MemoFilterAst, boundIds: Set<string>) {
  switch (node.op) {
    case "id": {
      const name = identifierName(node);
      if (
        !name ||
        (!new Set([
          "filename",
          "mime_type",
          "create_time",
          "memo_id",
          "memo",
          "now",
        ]).has(name) &&
          !boundIds.has(name))
      ) {
        rejectUnsupported("identifier is not supported for attachments");
      }
      return;
    }
    case "value":
      return;
    case "list":
      for (const item of requireAstArray(node.args, "list")) {
        visitAttachmentFilterAst(item, boundIds);
      }
      return;
    case "&&":
    case "||":
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "@in":
    case "in": {
      const args = binaryAstArgs(node);
      if (!args) rejectUnsupported(`${node.op} requires two operands`);
      visitAttachmentFilterAst(args[0], boundIds);
      visitAttachmentFilterAst(args[1], boundIds);
      return;
    }
    case "+":
    case "-":
    case "*":
    case "/":
    case "%": {
      const args = binaryAstArgs(node);
      if (!args) rejectUnsupported(`${node.op} requires two operands`);
      visitAttachmentFilterAst(args[0], boundIds);
      visitAttachmentFilterAst(args[1], boundIds);
      return;
    }
    case "!_":
      if (!isAstNode(node.args))
        rejectUnsupported("NOT requires one condition");
      visitAttachmentFilterAst(node.args, boundIds);
      return;
    case "call": {
      const parts = callParts(node);
      if (!parts) rejectUnsupported("malformed function call");
      if (parts.name === "timestamp" || parts.name === "duration") {
        if (parts.args.length !== 1) {
          rejectUnsupported(`${parts.name} requires one literal`);
        }
        const literal = requireAstArg(parts.args, 0, parts.name);
        if (parts.name === "timestamp") {
          const stringValue = stringLiteral(literal);
          if (stringValue !== undefined) validateTimestampLiteral(stringValue);
          else if (!isIntegerLiteral(literal)) {
            rejectUnsupported(
              "timestamp requires an RFC3339 string or epoch integer",
            );
          }
        } else {
          const stringValue = stringLiteral(literal);
          if (stringValue === undefined) {
            rejectUnsupported("duration requires a literal string");
          }
          validateDurationLiteral(stringValue);
        }
        return;
      }
      return rejectUnsupported(`function ${parts.name} is not supported`);
    }
    case "rcall": {
      const parts = receiverCallParts(node);
      if (!parts) rejectUnsupported("malformed receiver call");
      const receiverName = identifierName(parts.receiver);
      if (
        ![
          "filename",
          "mime_type",
          ...(boundIds.has(receiverName ?? "") ? [receiverName as string] : []),
        ].includes(receiverName ?? "")
      ) {
        if (!memoFilterTimestampMethods.has(parts.name)) {
          rejectUnsupported("attachment method receiver is not supported");
        }
      }
      if (memoFilterTimestampMethods.has(parts.name)) {
        if (receiverName !== "create_time" || parts.args.length !== 0) {
          rejectUnsupported(
            `${parts.name} is only supported on create_time without arguments`,
          );
        }
        visitAttachmentFilterAst(parts.receiver, boundIds);
        return;
      }
      if (
        ![
          "flaremo_contains",
          "flaremo_startsWith",
          "flaremo_endsWith",
          "flaremo_matches",
        ].includes(parts.name)
      ) {
        rejectUnsupported(`method ${parts.name} is not supported`);
      }
      if (parts.args.length !== 1) {
        rejectUnsupported(`${parts.name} requires one string literal`);
      }
      const literal = stringLiteral(requireAstArg(parts.args, 0, parts.name));
      if (literal === undefined) {
        rejectUnsupported(`${parts.name} requires a literal string`);
      }
      if (parts.name === "flaremo_matches") validateRegexPattern(literal);
      if (receiverName !== "filename" && receiverName !== "mime_type") {
        rejectUnsupported("text methods only support attachment text fields");
      }
      visitAttachmentFilterAst(parts.receiver, boundIds);
      return;
    }
    default:
      rejectUnsupported(`operator ${node.op} is not supported`);
  }
}

function visitMemoFilterAst(node: MemoFilterAst, boundIds: Set<string>) {
  switch (node.op) {
    case "id": {
      const name = identifierName(node);
      if (!name || (!memoFilterAllowedIds.has(name) && !boundIds.has(name))) {
        rejectUnsupported("identifier is not supported");
      }
      return;
    }
    case "value":
      return;
    case "list":
      for (const item of requireAstArray(node.args, "list")) {
        visitMemoFilterAst(item, boundIds);
      }
      return;
    case "&&":
    case "||":
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const args = binaryAstArgs(node);
      if (!args) rejectUnsupported(`${node.op} requires two operands`);
      if (
        ["<", "<=", ">", ">="].includes(node.op) &&
        isStringOrderingOperand(args[0])
      ) {
        rejectUnsupported("string ordering is not supported");
      }
      visitMemoFilterAst(args[0], boundIds);
      visitMemoFilterAst(args[1], boundIds);
      return;
    }
    case "+":
    case "-":
    case "*":
    case "/":
    case "%": {
      const args = binaryAstArgs(node);
      if (!args) rejectUnsupported(`${node.op} requires two operands`);
      visitMemoFilterAst(args[0], boundIds);
      visitMemoFilterAst(args[1], boundIds);
      return;
    }
    case "!_":
      if (!isAstNode(node.args))
        rejectUnsupported("NOT requires one condition");
      visitMemoFilterAst(node.args, boundIds);
      return;
    case "call":
      validateCallSurface(node, boundIds);
      return;
    case "rcall":
      validateReceiverCallSurface(node, boundIds);
      return;
    default:
      rejectUnsupported(`operator ${node.op} is not supported`);
  }
}

function validateCallSurface(node: MemoFilterAst, boundIds: Set<string>) {
  const parts = callParts(node);
  if (!parts) rejectUnsupported("malformed function call");

  if (
    parts.name === "flaremo_tag_in" ||
    parts.name === "flaremo_sets_contains" ||
    parts.name === "flaremo_sets_intersects" ||
    parts.name === "flaremo_sets_equivalent"
  ) {
    if (parts.args.length !== 2) {
      rejectUnsupported(`${parts.name} requires tags and a string list`);
    }
    const receiver = requireAstArg(parts.args, 0, parts.name);
    const candidates = requireAstArg(parts.args, 1, parts.name);
    if (identifierName(receiver) !== "tags" || !isStringList(candidates)) {
      rejectUnsupported(`${parts.name} requires tags and a string list`);
    }
    visitMemoFilterAst(receiver, boundIds);
    return;
  }

  if (parts.name === "size") {
    if (parts.args.length !== 1) {
      rejectUnsupported("size requires one argument");
    }
    const receiver = requireAstArg(parts.args, 0, "size");
    if (!new Set(["content", "tags"]).has(identifierName(receiver) ?? "")) {
      rejectUnsupported("size is only supported for content and tags");
    }
    visitMemoFilterAst(receiver, boundIds);
    return;
  }

  if (parts.name === "timestamp" || parts.name === "duration") {
    if (parts.args.length !== 1) {
      rejectUnsupported(`${parts.name} requires one literal`);
    }
    const literal = requireAstArg(parts.args, 0, parts.name);
    if (parts.name === "timestamp") {
      const stringValue = stringLiteral(literal);
      if (stringValue !== undefined) {
        validateTimestampLiteral(stringValue);
      } else if (!isIntegerLiteral(literal)) {
        rejectUnsupported(
          "timestamp requires an RFC3339 string or epoch integer",
        );
      }
    } else {
      const stringValue = stringLiteral(literal);
      if (stringValue === undefined) {
        rejectUnsupported("duration requires a literal string");
      }
      validateDurationLiteral(stringValue);
    }
    return;
  }

  rejectUnsupported(`function ${parts.name} is not supported`);
}

function validateReceiverCallSurface(
  node: MemoFilterAst,
  boundIds: Set<string>,
) {
  const parts = receiverCallParts(node);
  if (!parts) rejectUnsupported("malformed receiver call");

  if (
    parts.name === "exists" ||
    parts.name === "all" ||
    parts.name === "exists_one"
  ) {
    if (parts.args.length !== 2) {
      rejectUnsupported(`${parts.name} is only supported for tags`);
    }
    const iteratorArg = requireAstArg(parts.args, 0, parts.name);
    const predicate = requireAstArg(parts.args, 1, parts.name);
    if (
      identifierName(parts.receiver) !== "tags" ||
      identifierName(iteratorArg) === undefined
    ) {
      rejectUnsupported(`${parts.name} is only supported for tags`);
    }
    const iterator = identifierName(iteratorArg);
    if (!iterator || iterator === "tag") {
      rejectUnsupported("tag comprehension iterator is not valid");
    }
    visitMemoFilterAst(parts.receiver, boundIds);
    const nestedIds = new Set(boundIds);
    nestedIds.add(iterator);
    visitMemoFilterAst(predicate, nestedIds);
    return;
  }

  const receiverName = identifierName(parts.receiver);
  if (parts.name === "size") {
    if (parts.args.length !== 0) {
      rejectUnsupported("size requires no arguments when used as a method");
    }
    if (receiverName !== "content" && receiverName !== "tags") {
      rejectUnsupported("size is only supported for content and tags");
    }
    visitMemoFilterAst(parts.receiver, boundIds);
    return;
  }

  if (memoFilterTimestampMethods.has(parts.name)) {
    if (receiverName !== "created_ts" && receiverName !== "updated_ts") {
      rejectUnsupported(`${parts.name} is only supported for timestamp fields`);
    }
    if (parts.args.length !== 0) {
      rejectUnsupported(`${parts.name} does not accept a timezone argument`);
    }
    visitMemoFilterAst(parts.receiver, boundIds);
    return;
  }

  if (
    parts.name !== "flaremo_contains" &&
    parts.name !== "flaremo_startsWith" &&
    parts.name !== "flaremo_endsWith" &&
    parts.name !== "flaremo_matches"
  ) {
    rejectUnsupported(`method ${parts.name} is not supported`);
  }
  if (receiverName !== "content" && !boundIds.has(receiverName ?? "")) {
    rejectUnsupported("text methods only support content and tag iterators");
  }
  if (parts.args.length !== 1) {
    rejectUnsupported(`${parts.name} requires one string literal`);
  }
  const literal = stringLiteral(requireAstArg(parts.args, 0, parts.name));
  if (literal === undefined) {
    rejectUnsupported(`${parts.name} requires a literal string`);
  }
  if (parts.name === "flaremo_matches") validateRegexPattern(literal);
  visitMemoFilterAst(parts.receiver, boundIds);
}

const memoFilterTimestampMethods = new Set([
  "getDate",
  "getDayOfMonth",
  "getDayOfWeek",
  "getDayOfYear",
  "getFullYear",
  "getHours",
  "getMinutes",
  "getMonth",
  "getSeconds",
]);

function requireAstArray(value: unknown, label: string): MemoFilterAst[] {
  if (!Array.isArray(value) || !value.every(isAstNode)) {
    rejectUnsupported(`${label} arguments are not valid`);
  }
  return value;
}

function requireAstArg(
  args: MemoFilterAst[],
  index: number,
  label: string,
): MemoFilterAst {
  const arg = args[index];
  if (!arg) rejectUnsupported(`${label} arguments are not valid`);
  return arg;
}

function binaryAstArgs(
  node: MemoFilterAst,
): [MemoFilterAst, MemoFilterAst] | undefined {
  if (
    !Array.isArray(node.args) ||
    node.args.length !== 2 ||
    !isAstNode(node.args[0]) ||
    !isAstNode(node.args[1])
  ) {
    return undefined;
  }
  return [node.args[0], node.args[1]];
}

function callParts(
  node: MemoFilterAst,
): { name: string; args: MemoFilterAst[] } | undefined {
  if (node.op !== "call" || !Array.isArray(node.args)) return undefined;
  const [name, args] = node.args;
  if (
    typeof name !== "string" ||
    !Array.isArray(args) ||
    !args.every(isAstNode)
  ) {
    return undefined;
  }
  return { name, args };
}

function receiverCallParts(
  node: MemoFilterAst,
):
  | { name: string; receiver: MemoFilterAst; args: MemoFilterAst[] }
  | undefined {
  if (node.op !== "rcall" || !Array.isArray(node.args)) return undefined;
  const [name, receiver, args] = node.args;
  if (
    typeof name !== "string" ||
    !isAstNode(receiver) ||
    !Array.isArray(args) ||
    !args.every(isAstNode)
  ) {
    return undefined;
  }
  return { name, receiver, args };
}

function isStringOrderingOperand(node: MemoFilterAst) {
  return node.op === "id" && memoFilterStringFields.has(String(node.args));
}

function stringLiteral(node: MemoFilterAst) {
  return node.op === "value" && typeof node.args === "string"
    ? node.args
    : undefined;
}

function isIntegerLiteral(node: MemoFilterAst) {
  return (
    node.op === "value" &&
    ((typeof node.args === "number" && Number.isSafeInteger(node.args)) ||
      typeof node.args === "bigint")
  );
}

function identifierName(node: unknown) {
  return isAstNode(node) && node.op === "id" && typeof node.args === "string"
    ? node.args
    : undefined;
}

function isStringList(node: MemoFilterAst) {
  return (
    node.op === "list" &&
    Array.isArray(node.args) &&
    node.args.every((item) => isAstNode(item) && typeof item.args === "string")
  );
}

function validateTimestampLiteral(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    rejectUnsupported("timestamp requires a valid RFC3339 literal");
  }
}

function validateDurationLiteral(value: string) {
  if (
    !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:ns|us|µs|ms|s|m|h)(?:(?:\d+(?:\.\d+)?|\.\d+)(?:ns|us|µs|ms|s|m|h))*$/.test(
      value,
    )
  ) {
    rejectUnsupported("duration requires a valid literal");
  }
}

function validateRegexPattern(pattern: string) {
  if (pattern.length > MAX_MEMO_FILTER_REGEX_LENGTH) {
    rejectUnsupported("regex literal is too long");
  }
  if (/\\(?:[1-9]\d*|k<)|\(\?/.test(pattern)) {
    rejectUnsupported("regex uses an unsupported construct");
  }
  if (/\((?:[^()\\]|\\.)*[+*{](?:[^()\\]|\\.)*\)[+*{]/.test(pattern)) {
    rejectUnsupported("regex contains nested quantifiers");
  }
  if (memoFilterRegexCache.has(pattern)) return;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    rejectUnsupported("regex is invalid");
  }
  if (memoFilterRegexCache.size >= MAX_MEMO_FILTER_REGEX_CACHE_ENTRIES) {
    const oldest = memoFilterRegexCache.keys().next().value;
    if (oldest !== undefined) memoFilterRegexCache.delete(oldest);
  }
  memoFilterRegexCache.set(pattern, regex);
}

function getMemoFilterRegex(pattern: string) {
  const cached = memoFilterRegexCache.get(pattern);
  if (cached) return cached;
  validateRegexPattern(pattern);
  const compiled = memoFilterRegexCache.get(pattern);
  if (!compiled) throw new Error("Memos filter regex was not compiled");
  return compiled;
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

function isAstNode(value: unknown): value is MemoFilterAst {
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
