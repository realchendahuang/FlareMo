import {
  type CreateMemoInput,
  createMemoSchema,
  type ListMemosQuery,
  listMemosQuerySchema,
} from "@flaremo/contracts";
import { createMemo, getMemoById, listMemos } from "@flaremo/domain";
import {
  memosToListResponse,
  memoToDto,
  parseMemosResourceName,
} from "@flaremo/memos";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { getRequestContext, type HonoBindings } from "../context";
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
            version: "0.1.0",
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
                  q: { type: "string" },
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
              description: "Search memos by text query.",
              inputSchema: {
                type: "object",
                required: ["q"],
                properties: {
                  q: { type: "string" },
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
      const result = await callTool(c, call.name, call.arguments ?? {});
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
  c: Context<HonoBindings>,
  name: string,
  args: Record<string, unknown>,
) {
  const { db, user } = await getRequestContext(c);

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
