import {
  bootstrapInputSchema,
  checkpointInputSchema,
  FLAREMO_API_VERSION,
  forgetInputSchema,
  linkInputSchema,
  recallInputSchema,
  rememberInputSchema,
} from "@flaremo/contracts";
import {
  assertMonthlyQuota,
  bootstrapMemory,
  checkpointMemory,
  createMemory,
  estimateTokenCount,
  forgetMemory,
  incrementUsageCounter,
  linkMemory,
  type MemoryActor,
  recallMemories,
  rememberInputToWrite,
} from "@flaremo/domain";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  getRequestContext,
  type HonoBindings,
  type ReturnTypeOfRequestContext,
} from "../context";
import { createEmbeddingProvider, createVectorIndex } from "../embedding";
import { jsonError } from "../http";

export const memoryMcpApi = new Hono<HonoBindings>();

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

// The agent-facing memory MCP exposes a deliberately small surface. The six
// tools encode the write/recall policy in their descriptions so behavior stays
// consistent across Claude Code, Codex, Pi, and any other client that connects
// to this endpoint — no external system prompt is required.
const memoryTools: Array<{
  name: string;
  description: string;
  inputSchema: JsonObject;
}> = [
  {
    name: "memory_bootstrap",
    description:
      "Restore long-term context at the start of a session. Returns the user's " +
      "global and project core memories, important active decisions and " +
      "constraints, and recent relevant lessons, capped by a character budget. " +
      "Call once when entering a new project or important session; do not call " +
      "on every turn.",
    inputSchema: {
      type: "object",
      required: ["agent"],
      properties: {
        agent: {
          type: "string",
          description: "The calling agent, e.g. codex.",
        },
        project_key: {
          type: "string",
          description: "Project identifier, e.g. github:owner/repo.",
        },
        workspace_key: { type: "string" },
        cwd: {
          type: "string",
          description: "Current working directory, context only.",
        },
        task: {
          type: "string",
          description: "A short description of the task.",
        },
        max_items: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memory_recall",
    description:
      "Search long-term memory for relevant facts, decisions, preferences, or " +
      "lessons. Results are scoped to global plus the requested project/workspace " +
      "and the calling agent; cross-project recall is not allowed. Use when the " +
      "task involves historical decisions, user preferences, project constraints, " +
      "or past failures.",
    inputSchema: {
      type: "object",
      required: ["query", "agent"],
      properties: {
        query: { type: "string", description: "Natural-language query." },
        agent: { type: "string" },
        project_key: { type: "string" },
        workspace_key: { type: "string" },
        types: {
          type: "array",
          items: {
            type: "string",
            enum: ["semantic", "episodic", "procedural"],
          },
        },
        kinds: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "preference",
              "fact",
              "decision",
              "constraint",
              "entity",
              "event",
              "outcome",
              "lesson",
              "procedure",
            ],
          },
        },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memory_remember",
    description:
      "Save a single atomic long-term fact. One memory = one stable conclusion " +
      "(e.g. 'FlareMo uses D1'); long-form content belongs in a memo, not a " +
      "memory. Only record what has future value across sessions. Never store " +
      "secrets, tokens, passwords, cookies, or authorization headers. Agents " +
      "record as observed or inferred only — they can never lock or confirm a " +
      "memory, and they cannot overwrite a memory the user confirmed or locked.",
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string", maxLength: 4000 },
        type: {
          type: "string",
          enum: ["semantic", "episodic", "procedural"],
          default: "semantic",
        },
        kind: {
          type: "string",
          enum: [
            "preference",
            "fact",
            "decision",
            "constraint",
            "entity",
            "event",
            "outcome",
            "lesson",
            "procedure",
          ],
          default: "fact",
        },
        scope_type: {
          type: "string",
          enum: ["global", "workspace", "project", "agent"],
          default: "global",
        },
        scope_key: { type: "string" },
        tier: { type: "string", enum: ["core", "normal"], default: "normal" },
        importance: { type: "integer", minimum: 0, maximum: 100, default: 50 },
        confidence: { type: "integer", minimum: 0, maximum: 100, default: 50 },
        verification: {
          type: "string",
          enum: ["inferred", "observed"],
          default: "observed",
        },
        source_agent: { type: "string" },
        source_session: { type: "string" },
        source_ref: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memory_checkpoint",
    description:
      "Distill a finished piece of work into long-term lessons. Creates one " +
      "episodic summary plus the given atomic memories, linked together. Call " +
      "after completing an important feature, design, investigation, or decision. " +
      "Each item must be an atomic conclusion, not chat history or a todo.",
    inputSchema: {
      type: "object",
      required: ["agent", "summary", "items"],
      properties: {
        agent: { type: "string" },
        project_key: { type: "string" },
        scope_type: {
          type: "string",
          enum: ["global", "workspace", "project", "agent"],
          default: "project",
        },
        scope_key: { type: "string" },
        summary: { type: "string", maxLength: 4000 },
        items: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            required: ["content"],
            properties: {
              content: { type: "string", maxLength: 4000 },
              type: {
                type: "string",
                enum: ["semantic", "episodic", "procedural"],
                default: "semantic",
              },
              kind: {
                type: "string",
                enum: [
                  "preference",
                  "fact",
                  "decision",
                  "constraint",
                  "entity",
                  "event",
                  "outcome",
                  "lesson",
                  "procedure",
                ],
                default: "fact",
              },
              importance: {
                type: "integer",
                minimum: 0,
                maximum: 100,
                default: 50,
              },
            },
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memory_link",
    description:
      "Link a memory to another memory (e.g. supersedes, contradicts, supports) " +
      "or to an external resource such as a memo. A supersedes link retires the " +
      "older memory from active recall without deleting its history.",
    inputSchema: {
      type: "object",
      required: ["memory_id"],
      properties: {
        memory_id: { type: "string" },
        related_memory_id: { type: "string" },
        relation_type: {
          type: "string",
          enum: [
            "related_to",
            "supports",
            "contradicts",
            "supersedes",
            "depends_on",
            "part_of",
          ],
          default: "related_to",
        },
        resource_type: {
          type: "string",
          enum: ["memo", "session", "github", "url", "document", "other"],
        },
        resource_ref: { type: "string" },
        resource_relation_type: {
          type: "string",
          enum: ["derived_from", "evidence", "references", "promoted_to"],
          default: "references",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "memory_forget",
    description:
      "Retire a memory that is now incorrect, superseded, or irrelevant. Agents " +
      "never hard-delete: this archives or supersedes the memory so the user can " +
      "still review it. Only the user can permanently delete a memory from the " +
      "FlareMo UI.",
    inputSchema: {
      type: "object",
      required: ["memory_id"],
      properties: {
        memory_id: { type: "string" },
        reason: {
          type: "string",
          enum: ["incorrect", "superseded", "expired", "irrelevant"],
          default: "superseded",
        },
      },
      additionalProperties: false,
    },
  },
];

memoryMcpApi.post("/", async (c) => {
  let context: ReturnTypeOfRequestContext;
  try {
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
        capabilities: { tools: {} },
        serverInfo: { name: "memory", version: FLAREMO_API_VERSION },
      },
    });
  }

  if (request.method === "notifications/initialized") {
    if (request.id === undefined) return new Response(null, { status: 202 });
    return c.json({ jsonrpc: "2.0", id, result: {} });
  }

  if (request.method === "tools/list") {
    return c.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: memoryTools.map((tool) => ({
          ...tool,
          outputSchema: { type: "object", additionalProperties: true },
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
      const value = await callMemoryTool(
        c,
        context,
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

function resolveAgent(args: JsonObject): MemoryActor {
  const name = optionalString(args, "agent", "source_agent") ?? "agent";
  return { type: "agent", name };
}

async function callMemoryTool(
  c: Context<HonoBindings>,
  context: ReturnTypeOfRequestContext,
  name: string,
  args: JsonObject,
) {
  const { db, user } = context;
  switch (name) {
    case "memory_bootstrap": {
      const input = bootstrapInputSchema.parse(args);
      return bootstrapMemory(db, user, {
        agent: input.agent,
        projectKey: input.project_key,
        workspaceKey: input.workspace_key,
        maxItems: input.max_items,
      });
    }
    case "memory_recall": {
      const input = recallInputSchema.parse(args);
      const provider = createEmbeddingProvider(c.env);
      const index = createVectorIndex(c.env, "memory");
      if (provider && index) {
        await assertMonthlyQuota(
          context.db,
          context.limits.semanticSearchQueriesPerMonth,
          "search_queries",
          "Monthly semantic search quota exceeded",
        );
        c.executionCtx.waitUntil(
          Promise.all([
            incrementUsageCounter(
              context.db,
              context.user,
              "queried_dims",
              provider.dimensions,
            ).catch(() => undefined),
            incrementUsageCounter(
              context.db,
              context.user,
              "search_queries",
              1,
            ).catch(() => undefined),
            incrementUsageCounter(
              context.db,
              context.user,
              "embedding_tokens",
              estimateTokenCount([input.query]),
            ).catch(() => undefined),
          ]),
        );
      }
      return recallMemories(
        db,
        user,
        {
          query: input.query,
          agent: input.agent,
          projectKey: input.project_key,
          workspaceKey: input.workspace_key,
          types: input.types,
          kinds: input.kinds,
          limit: input.limit,
        },
        provider && index ? { provider, index } : undefined,
      );
    }
    case "memory_remember": {
      const input = rememberInputSchema.parse(args);
      const result = await createMemory(
        db,
        user,
        resolveAgent(args),
        rememberInputToWrite(input),
      );
      return result;
    }
    case "memory_checkpoint": {
      const input = checkpointInputSchema.parse(args);
      return checkpointMemory(db, user, resolveAgent(args), input);
    }
    case "memory_link": {
      const input = linkInputSchema.parse(args);
      return linkMemory(db, user, resolveAgent(args), {
        memoryId: normalizeMemoryId(input.memory_id),
        relatedMemoryId: input.related_memory_id
          ? normalizeMemoryId(input.related_memory_id)
          : undefined,
        relationType: input.relation_type,
        resourceType: input.resource_type,
        resourceRef: input.resource_ref,
        resourceRelationType: input.resource_relation_type,
      });
    }
    case "memory_forget": {
      const input = forgetInputSchema.parse(args);
      return forgetMemory(
        db,
        user,
        resolveAgent(args),
        normalizeMemoryId(input.memory_id),
        {
          reason: input.reason,
        },
      );
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function normalizeMemoryId(value: string) {
  return value.startsWith("memories/") ? value : `memories/${value}`;
}

// --- protocol helpers (mirror mcp.ts) --------------------------------------

function streamableProtocolError(
  c: Context<HonoBindings>,
  id: McpId,
  code: number,
  message: string,
) {
  return c.json({ jsonrpc: "2.0", id, error: { code, message } });
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
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
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

function optionalString(args: JsonObject, ...names: string[]) {
  for (const name of names) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw new Error(`${name} must be a string.`);
    return value;
  }
  return undefined;
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
