import { FLAREMO_API_VERSION } from "@flaremo/contracts/constants";
import { ValidationError } from "@flaremo/domain";
import {
  getRequestContext,
  type ReturnTypeOfRequestContext,
} from "../../context";
import type { FlareMoEnv } from "../../env";
import { jsonError } from "../../http";
import {
  formatZodError,
  isJsonObject,
  type JsonObject,
  negotiatedProtocolVersion,
  requestIdOf,
  streamableMcpRequestSchema,
  streamableToolCallSchema,
  streamableToolError,
} from "../../mcp-protocol";
import { currentUserToMemosDto } from "./input";
import {
  mcpStreamableApi,
  readableError,
  streamableProtocolError,
  streamableToolSuccess,
} from "./protocol";
import { streamableTools } from "./tool-schemas";
import {
  streamableDeleteAttachment,
  streamableGetAttachment,
  streamableListAttachments,
} from "./tools/attachments";
import {
  streamableCreateMemoComment,
  streamableDeleteMemoReaction,
  streamableListMemoAttachments,
  streamableListMemoComments,
  streamableListMemoReactions,
  streamableListMemoRelations,
  streamableSetMemoAttachments,
  streamableSetMemoRelations,
  streamableUpsertMemoReaction,
} from "./tools/memo-subresources";
import {
  streamableCreateMemo,
  streamableDeleteMemo,
  streamableGetMemo,
  streamableListMemos,
  streamableUpdateMemo,
} from "./tools/memos";
import {
  streamableCreateShortcut,
  streamableDeleteShortcut,
  streamableGetShortcut,
  streamableListShortcuts,
  streamableUpdateShortcut,
} from "./tools/shortcuts";

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
      throw new ValidationError(`Unknown tool: ${name}`);
  }
}

export { mcpStreamableApi };
