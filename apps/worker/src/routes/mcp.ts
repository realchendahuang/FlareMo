import {
  type CreateMemoInput,
  createMemoSchema,
  FLAREMO_API_VERSION,
  type ListMemosQuery,
  listMemosQuerySchema,
} from "@flaremo/contracts";
import type { AttachmentRow, MemoRow, UserRow } from "@flaremo/db";
import {
  bindMemoAttachments,
  createMemo,
  createMemoComment,
  createShortcut,
  deleteMemoReaction,
  deleteShortcut,
  finalizeAttachmentDelete,
  getAttachmentById,
  getMemoById,
  getShortcut,
  hardDeleteMemo,
  listAttachments,
  listMemoAttachments,
  listMemoComments,
  listMemoReactions,
  listMemoRelations,
  listMemos,
  listShortcuts,
  markAttachmentDeleting,
  markMemoAttachmentsDeleting,
  moveMemoToTrash,
  replaceMemoRelations,
  updateMemo,
  updateShortcut,
  upsertMemoReaction,
} from "@flaremo/domain";
import {
  currentAttachmentToDto,
  currentMemoToDto,
  currentReactionToDto,
  currentShortcutToDto,
  currentUserToDto,
  memosToListResponse,
  memoToDto,
  parseMemosResourceName,
} from "@flaremo/memos";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  getRequestContext,
  type HonoBindings,
  type ReturnTypeOfRequestContext,
} from "../context";
import type { FlareMoEnv } from "../env";
import { jsonError } from "../http";

export const mcpApi = new Hono<HonoBindings>();

const mcpRequestSchema = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

const toolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

mcpApi.post("/mcp", async (c) => {
  try {
    const authContext = await getRequestContext(c);
    const request = mcpRequestSchema.parse(await c.req.json());
    const id = request.id ?? null;

    if (request.method === "initialize") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "FlareMo",
            version: FLAREMO_API_VERSION,
          },
        },
      });
    }

    if (request.method === "tools/list") {
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "list_memos",
              description: "List memos from the current FlareMo instance.",
              inputSchema: {
                type: "object",
                properties: {
                  page_size: { type: "integer", minimum: 1, maximum: 100 },
                  q: {
                    type: "string",
                    description:
                      "Full-text terms plus optional filters: has:attachment, is:pinned, before:YYYY-MM-DD, after:YYYY-MM-DD, and in:timeline|archive|trash.",
                  },
                  tag: { type: "string" },
                  state: {
                    type: "string",
                    enum: ["normal", "archived", "trashed", "deleted"],
                  },
                },
              },
            },
            {
              name: "create_memo",
              description: "Create a memo in the current FlareMo instance.",
              inputSchema: {
                type: "object",
                required: ["content"],
                properties: {
                  content: { type: "string" },
                  visibility: {
                    type: "string",
                    enum: ["private", "protected", "public"],
                  },
                  source: { type: "string" },
                },
              },
            },
            {
              name: "get_memo",
              description: "Get a memo by id or resource name.",
              inputSchema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                },
              },
            },
            {
              name: "search_memos",
              description:
                "Search memos by full-text terms and optional has:attachment, is:pinned, date, or scope filters.",
              inputSchema: {
                type: "object",
                required: ["q"],
                properties: {
                  q: {
                    type: "string",
                    description:
                      "Full-text terms plus optional filters: has:attachment, is:pinned, before:YYYY-MM-DD, after:YYYY-MM-DD, and in:timeline|archive|trash.",
                  },
                  page_size: { type: "integer", minimum: 1, maximum: 100 },
                },
              },
            },
          ],
        },
      });
    }

    if (request.method === "tools/call") {
      const call = toolCallSchema.parse(request.params);
      const result = await callTool(
        authContext,
        call.name,
        call.arguments ?? {},
      );
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      });
    }

    return c.json(
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: "Method not found",
        },
      },
      404,
    );
  } catch (error) {
    return jsonError(c, error);
  }
});

async function callTool(
  context: ReturnTypeOfRequestContext,
  name: string,
  args: Record<string, unknown>,
) {
  const { db, user } = context;

  if (name === "list_memos") {
    const query = listMemosQuerySchema.parse(args) as ListMemosQuery;
    const result = await listMemos(db, user, query);
    return memosToListResponse({ ...result, user });
  }

  if (name === "search_memos") {
    const query = listMemosQuerySchema.parse({
      ...args,
      q: args.q,
      page_size: args.page_size ?? 30,
    }) as ListMemosQuery;
    const result = await listMemos(db, user, query);
    return memosToListResponse({ ...result, user });
  }

  if (name === "create_memo") {
    const input = createMemoSchema.parse({
      ...args,
      source: args.source ?? "mcp",
    }) as CreateMemoInput;
    const memo = await createMemo(db, user, input);
    return memoToDto(memo, user);
  }

  if (name === "get_memo") {
    const input = z.object({ name: z.string() }).parse(args);
    const memo = await getMemoById(
      db,
      user,
      parseMemosResourceName(input.name),
    );
    return memoToDto(memo, user);
  }

  return {
    error: {
      message: `Unknown tool: ${name}`,
    },
  };
}

/*
 * This app is intentionally separate from mcpApi above. The latter is the
 * original /api/v1/mcp JSON-RPC subset and is kept for existing clients. The
 * app below is the stateless Streamable HTTP surface that the main Worker can
 * mount at /mcp without changing the legacy route.
 */
export const mcpStreamableApi = new Hono<HonoBindings>();

type JsonObject = Record<string, unknown>;
type McpId = string | number | null;

const STREAMABLE_PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"] as const;
const DEFAULT_STREAMABLE_PROTOCOL_VERSION = STREAMABLE_PROTOCOL_VERSIONS[0];

const streamableMcpRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

const streamableToolCallSchema = z.object({
  name: z.string().trim().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

const currentMemoBodySchema = {
  type: "object",
  required: ["content"],
  properties: {
    name: { type: "string", description: "Memos resource name." },
    content: { type: "string" },
    visibility: {
      type: "string",
      enum: [
        "VISIBILITY_UNSPECIFIED",
        "PRIVATE",
        "PROTECTED",
        "PUBLIC",
        "private",
        "protected",
        "public",
      ],
    },
    state: {
      type: "string",
      enum: [
        "STATE_UNSPECIFIED",
        "NORMAL",
        "ARCHIVED",
        "TRASHED",
        "DELETED",
        "normal",
        "archived",
        "trashed",
        "deleted",
      ],
    },
    pinned: { type: "boolean" },
    tags: { type: "array", items: { type: "string" } },
    payload: { type: "object", additionalProperties: true },
    property: { type: "object", additionalProperties: true },
    location: {},
    source: { type: "string" },
  },
  additionalProperties: true,
};

const resourceNameInput = {
  type: "string",
  minLength: 1,
  description: "A Memos resource name, for example memos/<id>.",
};

const streamableTools: Array<{
  name: string;
  description: string;
  inputSchema: JsonObject;
}> = [
  {
    name: "memo_list_memos",
    description:
      "List the current user's memos. Supports the FlareMo-backed subset of the current Memos list contract.",
    inputSchema: {
      type: "object",
      properties: {
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        pageToken: { type: "string" },
        state: {
          type: "string",
          enum: [
            "STATE_UNSPECIFIED",
            "NORMAL",
            "ARCHIVED",
            "TRASHED",
            "DELETED",
          ],
        },
        orderBy: {
          type: "string",
          description:
            "One supported ordering such as create_time desc or update_time asc.",
        },
        filter: {
          type: "string",
          description:
            "A Memos CEL expression evaluated against the memo resource.",
        },
        showDeleted: { type: "boolean" },
        q: { type: "string" },
        tag: { type: "string" },
        page_size: { type: "integer", minimum: 1, maximum: 100 },
        page_token: { type: "string" },
        include_deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_create_memo",
    description:
      "Create a memo for the authenticated FlareMo user. The current Memos body shape is supported.",
    inputSchema: {
      type: "object",
      properties: {
        body: currentMemoBodySchema,
        content: { type: "string" },
        visibility: currentMemoBodySchema.properties.visibility,
        state: currentMemoBodySchema.properties.state,
        pinned: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        payload: { type: "object", additionalProperties: true },
        property: { type: "object", additionalProperties: true },
        location: {},
        source: { type: "string" },
        memoId: { type: "string" },
        memo_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_get_memo",
    description: "Get one memo by its Memos resource name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_update_memo",
    description:
      "Update a memo using the current Memos body/updateMask shape or the equivalent direct fields.",
    inputSchema: {
      type: "object",
      properties: {
        memo: resourceNameInput,
        name: resourceNameInput,
        body: currentMemoBodySchema,
        updateMask: { type: "string" },
        update_mask: { type: "string" },
        content: { type: "string" },
        visibility: currentMemoBodySchema.properties.visibility,
        state: currentMemoBodySchema.properties.state,
        pinned: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        payload: { type: "object", additionalProperties: true },
        property: { type: "object", additionalProperties: true },
        location: {},
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_delete_memo",
    description:
      "Move a memo to trash, or permanently delete it when force is explicitly true.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        force: { type: "boolean" },
        hard: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_list_memo_attachments",
    description: "List ready attachments bound to one memo.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        pageToken: { type: "string" },
        page_size: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_set_memo_attachments",
    description:
      "Replace the attachment set of a memo. Each attachment is a resource name or an object containing name.",
    inputSchema: {
      type: "object",
      required: ["name", "attachments"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        attachments: {
          type: "array",
          maxItems: 100,
          items: {
            anyOf: [
              { type: "string" },
              {
                type: "object",
                required: ["name"],
                properties: { name: resourceNameInput },
                additionalProperties: true,
              },
            ],
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_list_memo_relations",
    description: "List relations owned by one memo.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        pageToken: { type: "string" },
        page_size: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_set_memo_relations",
    description:
      "Replace all relations owned by one memo using current Memos relation objects or the FlareMo-compatible shape.",
    inputSchema: {
      type: "object",
      required: ["name", "relations"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        relations: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            required: ["relatedMemo", "type"],
            properties: {
              memo: { type: "object", additionalProperties: true },
              relatedMemo: { type: "object", additionalProperties: true },
              related_memo: resourceNameInput,
              type: {
                type: "string",
                enum: [
                  "TYPE_UNSPECIFIED",
                  "REFERENCE",
                  "COMMENT",
                  "reference",
                  "comment",
                ],
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_list_memo_comments",
    description: "List comments attached to one memo.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        pageToken: { type: "string" },
        orderBy: { type: "string", example: "create_time desc" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_create_memo_comment",
    description: "Create a comment memo attached to one parent memo.",
    inputSchema: {
      type: "object",
      required: ["name", "content"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        body: { type: "object", additionalProperties: true },
        comment: { type: "object", additionalProperties: true },
        content: { type: "string" },
        visibility: { type: "string" },
        payload: { type: "object", additionalProperties: true },
        source: { type: "string" },
        commentId: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_list_memo_reactions",
    description: "List reactions attached to one memo.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        pageToken: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_upsert_memo_reaction",
    description: "Create or idempotently upsert the current user's reaction.",
    inputSchema: {
      type: "object",
      required: ["name", "reactionType"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        reaction: { type: "object", additionalProperties: true },
        contentId: { type: "string" },
        reactionType: { type: "string" },
        reaction_type: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memo_delete_memo_reaction",
    description: "Delete one reaction owned by the current user.",
    inputSchema: {
      type: "object",
      required: ["name", "reaction"],
      properties: {
        name: resourceNameInput,
        memo: resourceNameInput,
        reaction: resourceNameInput,
      },
      additionalProperties: false,
    },
  },
  {
    name: "shortcut_list_shortcuts",
    description: "List shortcuts for the authenticated current user.",
    inputSchema: {
      type: "object",
      properties: { parent: resourceNameInput, user: resourceNameInput },
      additionalProperties: false,
    },
  },
  {
    name: "shortcut_create_shortcut",
    description: "Create or validate a shortcut for the current user.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        filter: { type: "string" },
        shortcut: { type: "object", additionalProperties: true },
        validateOnly: { type: "boolean" },
        validate_only: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "shortcut_get_shortcut",
    description: "Get one shortcut by its resource name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: resourceNameInput },
      additionalProperties: false,
    },
  },
  {
    name: "shortcut_update_shortcut",
    description: "Update a shortcut using an optional updateMask.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: resourceNameInput,
        shortcut: { type: "object", additionalProperties: true },
        title: { type: "string" },
        filter: { type: "string" },
        updateMask: { type: "string" },
        update_mask: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "shortcut_delete_shortcut",
    description: "Delete one shortcut owned by the current user.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: resourceNameInput },
      additionalProperties: false,
    },
  },
  {
    name: "attachment_list_attachments",
    description:
      "List ready attachments. FlareMo supports pageSize and optional memo filtering; unsupported current-Memos filters return a tool error.",
    inputSchema: {
      type: "object",
      properties: {
        pageSize: { type: "integer", minimum: 1, maximum: 100 },
        pageToken: { type: "string" },
        filter: { type: "string" },
        orderBy: { type: "string" },
        memo: resourceNameInput,
        page_size: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "attachment_get_attachment",
    description: "Get one attachment by its Memos resource name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        attachment: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "attachment_delete_attachment",
    description: "Delete one attachment and its R2 object.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        attachment: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "auth_get_current_user",
    description:
      "Return the authenticated FlareMo user's current-user resource.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

mcpStreamableApi.post("/", async (c) => {
  let context: ReturnTypeOfRequestContext;
  try {
    // This deliberately delegates PAT parsing, Origin checks, and session
    // authentication to the same boundary as every other private route.
    context = await getRequestContext(c);
  } catch (error) {
    return jsonError(c, error);
  }

  let rawRequest: unknown;
  try {
    rawRequest = await c.req.json();
  } catch {
    return streamableProtocolError(c, null, -32700, "Parse error");
  }

  const parsedRequest = streamableMcpRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    const method = isJsonObject(rawRequest) ? rawRequest.method : undefined;
    if (method === "tools/call") {
      return streamableToolError(
        c,
        requestIdOf(rawRequest),
        formatZodError(parsedRequest.error),
      );
    }
    return streamableProtocolError(
      c,
      requestIdOf(rawRequest),
      -32600,
      formatZodError(parsedRequest.error),
    );
  }

  const request = parsedRequest.data;
  const id = request.id ?? null;

  if (request.method === "initialize") {
    return c.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiatedProtocolVersion(request.params),
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "memos",
          version: FLAREMO_API_VERSION,
        },
      },
    });
  }

  if (request.method === "notifications/initialized") {
    // MCP notifications have no JSON-RPC response. 202 is the stateless
    // Streamable HTTP acknowledgement and avoids manufacturing a response id.
    if (request.id === undefined) return new Response(null, { status: 202 });
    return c.json({ jsonrpc: "2.0", id, result: {} });
  }

  if (request.method === "tools/list") {
    return c.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: streamableTools.map((tool) => ({
          ...tool,
          outputSchema: {
            type: "object",
            additionalProperties: true,
          },
        })),
      },
    });
  }

  if (request.method === "tools/call") {
    const parsedCall = streamableToolCallSchema.safeParse(request.params);
    if (!parsedCall.success) {
      return streamableToolError(c, id, formatZodError(parsedCall.error));
    }

    try {
      const value = await callStreamableTool(
        context,
        c.env,
        parsedCall.data.name,
        parsedCall.data.arguments ?? {},
      );
      return streamableToolSuccess(c, id, value);
    } catch (error) {
      return streamableToolError(c, id, readableError(error));
    }
  }

  return streamableProtocolError(c, id, -32601, "Method not found");
});

function streamableProtocolError(
  c: Context<HonoBindings>,
  id: McpId,
  code: number,
  message: string,
) {
  return c.json({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function streamableToolSuccess(
  c: Context<HonoBindings>,
  id: McpId,
  value: unknown,
) {
  const structuredContent = normalizeStructuredContent(value);
  return c.json({
    jsonrpc: "2.0",
    id,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify(structuredContent),
        },
      ],
      structuredContent,
    },
  });
}

function streamableToolError(
  c: Context<HonoBindings>,
  id: McpId,
  message: string,
) {
  return c.json({
    jsonrpc: "2.0",
    id,
    result: {
      isError: true,
      content: [{ type: "text", text: message }],
      structuredContent: { error: { message } },
    },
  });
}

function requestIdOf(value: unknown): McpId {
  if (!isJsonObject(value)) return null;
  const id = value.id;
  return typeof id === "string" || typeof id === "number" || id === null
    ? id
    : null;
}

function negotiatedProtocolVersion(params: JsonObject | undefined) {
  const requested = params?.protocolVersion;
  return typeof requested === "string" &&
    STREAMABLE_PROTOCOL_VERSIONS.includes(
      requested as (typeof STREAMABLE_PROTOCOL_VERSIONS)[number],
    )
    ? requested
    : DEFAULT_STREAMABLE_PROTOCOL_VERSION;
}

function normalizeStructuredContent(value: unknown): JsonObject {
  if (value === null || value === undefined) return { ok: true };
  if (isJsonObject(value)) return value;
  if (Array.isArray(value)) return { result: value };
  return { result: value };
}

async function callStreamableTool(
  context: ReturnTypeOfRequestContext,
  env: FlareMoEnv,
  name: string,
  args: JsonObject,
) {
  switch (name) {
    case "memo_list_memos":
      return streamableListMemos(context, args);
    case "memo_create_memo":
      return streamableCreateMemo(context, args);
    case "memo_get_memo":
      return streamableGetMemo(context, args);
    case "memo_update_memo":
      return streamableUpdateMemo(context, args);
    case "memo_delete_memo":
      return streamableDeleteMemo(context, env, args);
    case "memo_list_memo_attachments":
      return streamableListMemoAttachments(context, args);
    case "memo_set_memo_attachments":
      return streamableSetMemoAttachments(context, args);
    case "memo_list_memo_relations":
      return streamableListMemoRelations(context, args);
    case "memo_set_memo_relations":
      return streamableSetMemoRelations(context, args);
    case "memo_list_memo_comments":
      return streamableListMemoComments(context, args);
    case "memo_create_memo_comment":
      return streamableCreateMemoComment(context, args);
    case "memo_list_memo_reactions":
      return streamableListMemoReactions(context, args);
    case "memo_upsert_memo_reaction":
      return streamableUpsertMemoReaction(context, args);
    case "memo_delete_memo_reaction":
      return streamableDeleteMemoReaction(context, args);
    case "shortcut_list_shortcuts":
      return streamableListShortcuts(context, args);
    case "shortcut_create_shortcut":
      return streamableCreateShortcut(context, args);
    case "shortcut_get_shortcut":
      return streamableGetShortcut(context, args);
    case "shortcut_update_shortcut":
      return streamableUpdateShortcut(context, args);
    case "shortcut_delete_shortcut":
      return streamableDeleteShortcut(context, args);
    case "attachment_list_attachments":
      return streamableListAttachments(context, args);
    case "attachment_get_attachment":
      return streamableGetAttachment(context, args);
    case "attachment_delete_attachment":
      return streamableDeleteAttachment(context, env, args);
    case "auth_get_current_user":
      return { user: currentUserToMemosDto(context) };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function streamableListMemos(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const filter = optionalString(args, "filter");

  const query = listMemosQuerySchema.parse({
    page_size: pageSize(args),
    page_token: optionalString(args, "pageToken", "page_token"),
    order_by: normalizeOrderBy(
      optionalString(args, "orderBy") ?? "created_at desc",
    ),
    state: normalizeMemoState(optionalString(args, "state")),
    q: optionalString(args, "q"),
    tag: optionalString(args, "tag"),
    filter,
    include_deleted:
      optionalBoolean(args, "showDeleted") ??
      optionalBoolean(args, "include_deleted") ??
      false,
  }) as ListMemosQuery;
  const result = await listMemos(context.db, context.user, query);
  return {
    memos: result.memos.map((memo) =>
      memoToCurrentMemosDto(memo, context.user),
    ),
    ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
  };
}

async function streamableCreateMemo(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const input = mergedMemoInput(args);
  assertUnsupportedMemoCollections(input);
  const suppliedMemoId = firstDefined(input.memoId, input.memo_id);
  if (suppliedMemoId !== undefined) {
    throw new Error(
      "memoId is not supported by FlareMo's domain service; omit it so the server can generate the resource name.",
    );
  }

  const createInput = createMemoSchema.parse({
    content: requiredString(input.content, "content"),
    visibility: normalizeVisibility(input.visibility),
    payload: memoPayloadFromInput(input),
    source: optionalString(input, "source") ?? "mcp",
  }) as CreateMemoInput;
  let memo = await createMemo(context.db, context.user, createInput);

  const followUp: Parameters<typeof updateMemo>[3] = {};
  const state = normalizeMemoState(
    firstDefined(input.state, input.status) as string | undefined,
  );
  if (state !== undefined) followUp.status = state;
  const pinned = optionalBoolean(input, "pinned");
  if (pinned !== undefined) followUp.pinned = pinned;
  if (Object.keys(followUp).length > 0) {
    memo = await updateMemo(context.db, context.user, memo.id, followUp);
  }
  return memoToCurrentMemosDto(memo, context.user);
}

async function streamableGetMemo(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const name = resourceName(args, "memo", "name");
  const memo = await getMemoById(
    context.db,
    context.user,
    parseMemosResourceName(name),
  );
  return memoToCurrentMemosDto(memo, context.user);
}

async function streamableUpdateMemo(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const input = mergedMemoInput(args);
  assertUnsupportedMemoCollections(input);
  const name = resourceName(args, "memo", "name", input);
  const updateMask = optionalString(args, "updateMask", "update_mask");
  const mutation = memoMutationFromInput(input, {
    updateMask,
    allowEmpty: false,
  });
  const memo = await updateMemo(
    context.db,
    context.user,
    parseMemosResourceName(name),
    mutation,
  );
  return memoToCurrentMemosDto(memo, context.user);
}

async function streamableDeleteMemo(
  context: ReturnTypeOfRequestContext,
  env: FlareMoEnv,
  args: JsonObject,
) {
  const name = resourceName(args, "memo", "name");
  const id = parseMemosResourceName(name);
  const force =
    optionalBoolean(args, "force") ?? optionalBoolean(args, "hard") ?? false;
  if (!force) {
    await moveMemoToTrash(context.db, context.user, id);
    return { ok: true };
  }

  const attachments = await markMemoAttachmentsDeleting(
    context.db,
    context.user,
    id,
  );
  const objectKeys = attachments
    .filter((attachment) => attachment.state !== "missing")
    .map((attachment) => attachment.r2Key);
  if (objectKeys.length > 0) {
    await env.ATTACHMENTS.delete(objectKeys);
  }
  await hardDeleteMemo(context.db, context.user, id);
  return { ok: true };
}

async function streamableListMemoAttachments(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const pageToken = optionalString(args, "pageToken");
  if (pageToken)
    throw new Error("pageToken is not supported for memo attachments.");
  const rows = await listMemoAttachments(
    context.db,
    context.user,
    parseMemosResourceName(resourceName(args, "memo", "name")),
  );
  const size = pageSize(args);
  return {
    attachments: rows.slice(0, size).map(attachmentToCurrentMemosDto),
  };
}

async function streamableSetMemoAttachments(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const rawAttachments = args.attachments;
  if (!Array.isArray(rawAttachments) || rawAttachments.length > 100) {
    throw new Error("attachments must be an array with at most 100 entries.");
  }
  const names = rawAttachments.map((attachment, index) => {
    if (typeof attachment === "string") return attachment;
    if (isJsonObject(attachment)) {
      return requiredString(attachment.name, `attachments[${index}].name`);
    }
    throw new Error(`attachments[${index}] must be a resource name or object.`);
  });
  await bindMemoAttachments(
    context.db,
    context.user,
    parseMemosResourceName(resourceName(args, "memo", "name")),
    names,
  );
  return { ok: true };
}

async function streamableListMemoRelations(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const pageToken = optionalString(args, "pageToken");
  if (pageToken)
    throw new Error("pageToken is not supported for memo relations.");
  const rows = await listMemoRelations(
    context.db,
    context.user,
    parseMemosResourceName(resourceName(args, "memo", "name")),
  );
  return { relations: rows.map(relationToCurrentMemosDto) };
}

async function streamableSetMemoRelations(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const rawRelations = args.relations;
  if (!Array.isArray(rawRelations) || rawRelations.length > 100) {
    throw new Error("relations must be an array with at most 100 entries.");
  }
  const targetName = parseMemosResourceName(resourceName(args, "memo", "name"));
  const relations = rawRelations.map((rawRelation, index) => {
    if (!isJsonObject(rawRelation)) {
      throw new Error(`relations[${index}] must be an object.`);
    }
    const relatedMemo = rawRelation.relatedMemo;
    const relatedName = isJsonObject(relatedMemo)
      ? requiredString(relatedMemo.name, `relations[${index}].relatedMemo.name`)
      : requiredString(
          firstDefined(rawRelation.related_memo, relatedMemo),
          `relations[${index}].relatedMemo`,
        );
    const sourceMemo = rawRelation.memo;
    if (isJsonObject(sourceMemo) && sourceMemo.name !== undefined) {
      const sourceName = requiredString(
        sourceMemo.name,
        `relations[${index}].memo.name`,
      );
      if (parseMemosResourceName(sourceName) !== targetName) {
        throw new Error(`relations[${index}].memo must match the target memo.`);
      }
    }
    return {
      related_memo: relatedName,
      type: normalizeRelationType(rawRelation.type),
    };
  });
  await replaceMemoRelations(context.db, context.user, targetName, {
    relations,
  });
  return { ok: true };
}

async function streamableListMemoComments(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const parentName = normalizeMemoName(resourceName(args, "memo", "name"));
  const result = await listMemoComments(context.db, context.user, parentName, {
    pageSize: pageSize(args),
    pageToken: optionalString(args, "pageToken", "page_token"),
    orderBy: optionalString(args, "orderBy", "order_by"),
  });
  return {
    memos: result.memos.map((memo) =>
      currentMemoToDto(memo, context.user, { parent: parentName }),
    ),
    ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
  };
}

async function streamableCreateMemoComment(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const parentName = normalizeMemoName(resourceName(args, "memo", "name"));
  const input = mergedResourceInput(args, "body", "comment");
  const content = requiredString(input.content, "content");
  const created = await createMemoComment(
    context.db,
    context.user,
    parentName,
    {
      content,
      visibility: normalizeVisibility(input.visibility),
      payload: memoPayloadFromInput(input),
      source: optionalString(input, "source") ?? "mcp",
      ...(optionalString(input, "commentId", "comment_id")
        ? { commentId: optionalString(input, "commentId", "comment_id") }
        : {}),
    },
  );
  return currentMemoToDto(created, context.user, { parent: parentName });
}

async function streamableListMemoReactions(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const memoName = normalizeMemoName(resourceName(args, "memo", "name"));
  const result = await listMemoReactions(context.db, context.user, memoName, {
    pageSize: pageSize(args),
    pageToken: optionalString(args, "pageToken", "page_token"),
  });
  return {
    reactions: result.reactions.map(currentReactionToDto),
    ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}),
  };
}

async function streamableUpsertMemoReaction(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const memoName = normalizeMemoName(resourceName(args, "memo", "name"));
  const input = mergedResourceInput(args, "reaction");
  const reactionType = requiredString(
    firstDefined(input.reactionType, input.reaction_type),
    "reactionType",
  );
  const contentId = optionalString(input, "contentId", "content_id");
  const reaction = await upsertMemoReaction(
    context.db,
    context.user,
    memoName,
    {
      reactionType,
      ...(contentId ? { contentId } : {}),
    },
  );
  return currentReactionToDto(reaction);
}

async function streamableDeleteMemoReaction(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const memoName = normalizeMemoName(resourceName(args, "memo", "name"));
  const reactionId = requiredString(args.reaction, "reaction");
  const reactionName = reactionId.includes("/reactions/")
    ? reactionId
    : `${memoName}/reactions/${reactionId.replace(/^reactions\//, "")}`;
  await deleteMemoReaction(context.db, context.user, {
    name: reactionName,
    memoName,
  });
  return { ok: true };
}

async function streamableListShortcuts(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const parentName = optionalString(args, "parent", "user") ?? context.user.id;
  const shortcuts = await listShortcuts(context.db, context.user, {
    parentName,
  });
  return { shortcuts: shortcuts.map(currentShortcutToDto) };
}

async function streamableCreateShortcut(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const input = mergedResourceInput(args, "shortcut");
  const title = requiredString(input.title, "title");
  const filter = optionalString(input, "filter") ?? "";
  const validateOnly =
    optionalBoolean(args, "validateOnly") ??
    optionalBoolean(args, "validate_only") ??
    false;
  const shortcut = await createShortcut(context.db, context.user, {
    parentName: context.user.id,
    title,
    filter,
    validateOnly,
  });
  return currentShortcutToDto(shortcut);
}

async function streamableGetShortcut(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const name = resourceName(args, "name", "shortcut");
  return currentShortcutToDto(
    await getShortcut(context.db, context.user, { name }),
  );
}

async function streamableUpdateShortcut(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const input = mergedResourceInput(args, "shortcut");
  const name = requiredString(firstDefined(args.name, input.name), "name");
  const title = optionalString(input, "title");
  const filter = optionalString(input, "filter");
  const updateMask = optionalString(args, "updateMask", "update_mask");
  const shortcut = await updateShortcut(context.db, context.user, {
    name,
    ...(title !== undefined ? { title } : {}),
    ...(filter !== undefined ? { filter } : {}),
    ...(updateMask !== undefined ? { updateMask } : {}),
  });
  return currentShortcutToDto(shortcut);
}

async function streamableDeleteShortcut(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  await deleteShortcut(context.db, context.user, {
    name: resourceName(args, "name", "shortcut"),
  });
  return { ok: true };
}

async function streamableListAttachments(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const pageToken = optionalString(args, "pageToken");
  if (pageToken) throw new Error("pageToken is not supported for attachments.");
  const filter = optionalString(args, "filter");
  if (filter) throw new Error("Attachment filter is not supported by FlareMo.");
  const orderBy = optionalString(args, "orderBy");
  if (orderBy)
    throw new Error("Attachment orderBy is not supported by FlareMo.");
  const memo = optionalString(args, "memo");
  const rows = await listAttachments(context.db, context.user, {
    memoId: memo,
    pageSize: pageSize(args),
  });
  return { attachments: rows.map(attachmentToCurrentMemosDto) };
}

async function streamableGetAttachment(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const name = resourceName(args, "attachment", "name");
  const attachment = await getAttachmentById(context.db, context.user, name);
  return attachmentToCurrentMemosDto(attachment);
}

async function streamableDeleteAttachment(
  context: ReturnTypeOfRequestContext,
  env: FlareMoEnv,
  args: JsonObject,
) {
  const name = resourceName(args, "attachment", "name");
  const attachment = await markAttachmentDeleting(
    context.db,
    context.user,
    name,
  );
  await env.ATTACHMENTS.delete(attachment.r2Key);
  await finalizeAttachmentDelete(context.db, context.user, attachment.id);
  return { ok: true };
}

function mergedMemoInput(args: JsonObject): JsonObject {
  const body = args.body;
  const memoArgument = args.memo;
  const memoObject = isJsonObject(memoArgument) ? memoArgument : {};
  if (body !== undefined && !isJsonObject(body)) {
    throw new Error("body must be an object.");
  }
  return {
    ...args,
    ...memoObject,
    ...(isJsonObject(body) ? body : {}),
  };
}

function mergedResourceInput(args: JsonObject, ...keys: string[]): JsonObject {
  const result = { ...args };
  for (const key of keys) {
    const value = args[key];
    if (value === undefined) continue;
    if (!isJsonObject(value)) {
      throw new Error(`${key} must be an object.`);
    }
    Object.assign(result, value);
  }
  return result;
}

function assertUnsupportedMemoCollections(input: JsonObject) {
  if (input.attachments !== undefined) {
    throw new Error(
      "Memo attachments must be changed with memo_set_memo_attachments.",
    );
  }
  if (input.relations !== undefined) {
    throw new Error(
      "Memo relations must be changed with memo_set_memo_relations.",
    );
  }
}

function memoPayloadFromInput(input: JsonObject) {
  const payloadValue = input.payload;
  if (payloadValue !== undefined && !isJsonObject(payloadValue)) {
    throw new Error("payload must be an object.");
  }
  const payload: JsonObject = isJsonObject(payloadValue)
    ? { ...payloadValue }
    : {};
  if (input.tags !== undefined) {
    if (
      !Array.isArray(input.tags) ||
      input.tags.some((tag) => typeof tag !== "string")
    ) {
      throw new Error("tags must be an array of strings.");
    }
    payload.tags = input.tags;
  }
  if (input.property !== undefined) {
    if (!isJsonObject(input.property))
      throw new Error("property must be an object.");
    payload.property = input.property;
  }
  if (input.location !== undefined) payload.location = input.location;
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function memoMutationFromInput(
  input: JsonObject,
  options: { allowEmpty: boolean; updateMask?: string },
) {
  const updateMask = options.updateMask
    ? normalizeUpdateMask(options.updateMask)
    : undefined;
  const mutation: Record<string, unknown> = {};
  const isFieldRequested = (field: string) => {
    if (!updateMask) return true;
    if (updateMask.has(field)) return true;
    if (field === "status" && updateMask.has("state")) return true;
    if (
      field === "payload" &&
      ["tags", "property", "location"].some((payloadField) =>
        updateMask.has(payloadField),
      )
    ) {
      return true;
    }
    return false;
  };
  const setIfRequested = (field: string, value: unknown) => {
    if (value === undefined) return;
    if (!isFieldRequested(field)) return;
    mutation[field] = value;
  };

  setIfRequested(
    "content",
    input.content === undefined
      ? undefined
      : requiredString(input.content, "content"),
  );
  setIfRequested("visibility", normalizeVisibility(input.visibility, true));
  const state = normalizeMemoState(
    firstDefined(input.state, input.status) as string | undefined,
  );
  setIfRequested("status", state);
  setIfRequested("pinned", optionalBoolean(input, "pinned"));

  const hasPayloadInput =
    input.payload !== undefined ||
    input.tags !== undefined ||
    input.property !== undefined ||
    input.location !== undefined;
  if (hasPayloadInput) {
    setIfRequested("payload", memoPayloadFromInput(input));
  }

  if (updateMask) {
    for (const field of updateMask) {
      if (
        ![
          "content",
          "visibility",
          "status",
          "state",
          "pinned",
          "payload",
          "tags",
          "property",
          "location",
        ].includes(field)
      ) {
        throw new Error(`Update field "${field}" is not supported by FlareMo.`);
      }
    }
    if (updateMask.has("state")) {
      if (mutation.status === undefined) {
        throw new Error(
          "updateMask includes state but no state value was provided.",
        );
      }
    }
    if (
      updateMask.has("tags") ||
      updateMask.has("property") ||
      updateMask.has("location")
    ) {
      if (!hasPayloadInput) {
        throw new Error(
          "updateMask includes payload fields but no value was provided.",
        );
      }
    }
  }

  if (!options.allowEmpty && Object.keys(mutation).length === 0) {
    throw new Error("At least one supported memo field must be updated.");
  }
  return mutation as Parameters<typeof updateMemo>[3];
}

function normalizeUpdateMask(value: string) {
  const fields = new Set<string>();
  for (const rawField of value.split(",")) {
    const field = rawField.trim().replace(/^memo\./, "");
    if (field) fields.add(field);
  }
  if (fields.size === 0)
    throw new Error("updateMask must name at least one field.");
  return fields;
}

function normalizeOrderBy(value: string) {
  const match =
    /^(created_at|created_time|create_time|updated_at|updated_time|update_time)\s+(asc|desc)$/i.exec(
      value.trim(),
    );
  if (!match) {
    throw new Error(
      "orderBy must be one supported single-field order such as create_time desc.",
    );
  }
  const field = match[1]?.toLowerCase() ?? "";
  const direction = match[2]?.toLowerCase() ?? "";
  return `${field.startsWith("update") ? "updated_at" : "created_at"} ${direction}`;
}

function pageSize(args: JsonObject) {
  const raw = firstDefined(args.pageSize, args.page_size);
  if (raw === undefined) return 50;
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new Error("pageSize must be an integer.");
  }
  if (raw < 1 || raw > 100) {
    throw new Error("pageSize must be between 1 and 100.");
  }
  return raw;
}

function resourceName(
  args: JsonObject,
  primary: string,
  secondary: string,
  additional?: JsonObject,
) {
  const value = firstDefined(
    args[primary],
    args[secondary],
    additional?.[primary],
    additional?.[secondary],
  );
  return requiredString(value, primary);
}

function optionalString(args: JsonObject, ...names: string[]) {
  for (const name of names) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw new Error(`${name} must be a string.`);
    return value;
  }
  return undefined;
}

function optionalBoolean(args: JsonObject, name: string) {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function firstDefined<T>(...values: Array<T | undefined>) {
  return values.find((value) => value !== undefined);
}

function normalizeMemoName(value: string) {
  return value.startsWith("memos/") ? value : `memos/${value}`;
}

function normalizeVisibility(
  value: unknown,
  optional = false,
): "private" | "protected" | "public" | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    return "private";
  }
  if (typeof value !== "string")
    throw new Error("visibility must be a string.");
  const normalized = value.toLowerCase();
  if (normalized === "visibility_unspecified")
    return optional ? undefined : "private";
  if (
    normalized === "private" ||
    normalized === "protected" ||
    normalized === "public"
  )
    return normalized;
  throw new Error(`Unsupported visibility "${value}".`);
}

function normalizeMemoState(value: string | undefined) {
  if (value === undefined || value === "STATE_UNSPECIFIED") return undefined;
  const normalized = value.toLowerCase();
  if (["normal", "archived", "trashed", "deleted"].includes(normalized)) {
    return normalized as "normal" | "archived" | "trashed" | "deleted";
  }
  throw new Error(`Unsupported memo state "${value}".`);
}

function normalizeRelationType(value: unknown): "reference" | "comment" {
  if (value === undefined || value === null || value === "TYPE_UNSPECIFIED") {
    return "reference" as const;
  }
  if (typeof value !== "string")
    throw new Error("relation type must be a string.");
  const normalized = value.toLowerCase();
  if (normalized === "reference" || normalized === "comment") {
    return normalized as "reference" | "comment";
  }
  throw new Error(`Unsupported relation type "${value}".`);
}

function memoToCurrentMemosDto(memo: MemoRow, user: UserRow) {
  return currentMemoToDto(memo, user);
}

function attachmentToCurrentMemosDto(attachment: AttachmentRow) {
  return currentAttachmentToDto(attachment);
}

function relationToCurrentMemosDto(
  relation: Awaited<ReturnType<typeof listMemoRelations>>[number],
) {
  return {
    memo: { name: relation.memoId },
    relatedMemo: { name: relation.relatedMemoId },
    type: relation.type.toUpperCase(),
    createTime: relation.createdAt,
  };
}

function currentUserToMemosDto(context: ReturnTypeOfRequestContext) {
  return currentUserToDto(context.user);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readableError(error: unknown) {
  if (error instanceof z.ZodError) return formatZodError(error);
  if (error instanceof Error && error.message) return error.message;
  return "Tool call failed.";
}

function formatZodError(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "request";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
