import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedRequestContext = vi.hoisted(() => ({
  getRequestContext: vi.fn(),
}));

vi.mock("./context", () => ({
  getRequestContext: mockedRequestContext.getRequestContext,
}));

import { mcpApi, mcpStreamableApi } from "./routes/mcp";

const app = new Hono();
app.route("/mcp", mcpStreamableApi);

const legacyApp = new Hono();
legacyApp.route("/api/v1", mcpApi);

describe("stateless Streamable HTTP MCP", () => {
  beforeEach(() => {
    mockedRequestContext.getRequestContext.mockResolvedValue({});
  });

  it.each([
    "2025-03-26",
    "2024-11-05",
  ])("negotiates protocol version %s with JSON responses", async (protocolVersion) => {
    const response = await post(app, "/mcp", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "memos" },
      },
    });
    expect(response.headers.has("mcp-session-id")).toBe(false);
  });

  it("acknowledges initialized notifications without creating a session", async () => {
    const response = await post(app, "/mcp", {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });

  it("lists only the current Memos-prefixed tools", async () => {
    const response = await post(app, "/mcp", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const body = (await response.json()) as {
      result: { tools: Array<{ name: string; inputSchema: unknown }> };
    };

    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "memo_list_memos",
      "memo_create_memo",
      "memo_get_memo",
      "memo_update_memo",
      "memo_delete_memo",
      "memo_list_memo_attachments",
      "memo_set_memo_attachments",
      "memo_list_memo_relations",
      "memo_set_memo_relations",
      "memo_list_memo_comments",
      "memo_create_memo_comment",
      "memo_list_memo_reactions",
      "memo_upsert_memo_reaction",
      "memo_delete_memo_reaction",
      "shortcut_list_shortcuts",
      "shortcut_create_shortcut",
      "shortcut_get_shortcut",
      "shortcut_update_shortcut",
      "shortcut_delete_shortcut",
      "attachment_list_attachments",
      "attachment_get_attachment",
      "attachment_delete_attachment",
      "auth_get_current_user",
    ]);
    expect(body.result.tools.every((tool) => tool.inputSchema)).toBe(true);
  });

  it("returns tool failures as an MCP result instead of a JSON-RPC error", async () => {
    const response = await post(app, "/mcp", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "not_a_real_tool",
        arguments: {},
      },
    });
    const body = (await response.json()) as {
      error?: unknown;
      result: {
        isError: boolean;
        content: Array<{ type: string; text: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]).toMatchObject({ type: "text" });
    expect(body.result.content[0].text).toContain("Unknown tool");
  });

  it("keeps malformed tools/call params in the tool result envelope", async () => {
    const response = await post(app, "/mcp", {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: null,
    });
    const body = (await response.json()) as {
      error?: unknown;
      result: { isError: boolean; content: Array<{ text: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("params");
  });

  it("keeps the legacy JSON-RPC tool names on /api/v1/mcp", async () => {
    const response = await post(legacyApp, "/api/v1/mcp", {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
    });
    const body = (await response.json()) as {
      result: { tools: Array<{ name: string }> };
    };

    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      "list_memos",
      "create_memo",
      "get_memo",
      "search_memos",
    ]);
  });
});

async function post(target: Hono, path: string, payload: unknown) {
  return target.request(`http://flaremo.test${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer memos_pat_test",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
