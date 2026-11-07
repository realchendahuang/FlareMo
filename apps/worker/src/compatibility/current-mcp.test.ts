import type { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppTestHarness } from "../test-support/app";
import { createTestRuntime, TEST_PASSWORD } from "../test-support/runtime";
import { bootstrapAndSignIn } from "../test-support/sign-in";

let mf: Miniflare;
let env: Env;
let sessionCookie: string;

const { fetchCurrent } = createAppTestHarness(() => ({ env, sessionCookie }));

describe("Current wire MCP surface", () => {
  beforeEach(async () => {
    ({ runtime: mf, env } = await createTestRuntime({
      name: "flaremo-memos-compat",
      suffix: "source",
    }));
    sessionCookie = await bootstrapAndSignIn(env);
  });

  afterEach(async () => {
    await mf.dispose();
  });

  it("drives the MCP tool surface with a personal access token", async () => {
    // Setup only: a signed-in bearer plus one memo and one PAT, exactly the
    // credentials the original combined test had in scope when it reached the
    // MCP section.
    const signInResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/auth/signin",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://flaremo.test",
        },
        body: JSON.stringify({
          passwordCredentials: {
            username: "owner",
            password: TEST_PASSWORD,
          },
        }),
      },
      { authenticated: false },
    );
    const signIn = (await signInResponse.json()) as { accessToken: string };
    const bearer = { authorization: `Bearer ${signIn.accessToken}` };

    const createdResponse = await fetchCurrent(
      "http://flaremo.test/api/v1/memos",
      {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({
          memo: {
            content: "current wire memo #current",
            visibility: "PUBLIC",
            property: { hasLink: true },
            location: { placeholder: "Shanghai" },
          },
        }),
      },
    );
    const created = (await createdResponse.json()) as { name: string };

    const patCreate = await fetchCurrent(
      "http://flaremo.test/api/v1/users/owner/personalAccessTokens",
      {
        method: "POST",
        headers: { ...bearer, "content-type": "application/json" },
        body: JSON.stringify({
          description: "current test token",
          // Omitted lifetime uses the finite 365-day server default.
        }),
      },
    );
    const patPayload = (await patCreate.json()) as {
      token: string;
      personalAccessToken: { expiresAt?: string };
    };
    const pat = { token: patPayload.token };
    // An omitted compatibility lifetime uses the finite 365-day default; an
    // explicit permanent token requires the separate notes-only opt-in below.
    const expiresAt = Date.parse(
      patPayload.personalAccessToken.expiresAt ?? "invalid",
    );
    expect(expiresAt).toBeGreaterThan(Date.now() + 364 * 24 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThan(Date.now() + 366 * 24 * 60 * 60 * 1000);
    // A compatibility-created token defaults to notes and may not enter the
    // owner-only admin surface.
    const adminAttempt = await fetchCurrent(
      "http://flaremo.test/api/app/admin/settings",
      { headers: { authorization: `Bearer ${pat.token}` } },
    );
    expect(adminAttempt.status).toBe(403);

    const mcpHeaders = {
      authorization: `Bearer ${pat.token}`,
      "content-type": "application/json",
      accept: "application/json",
    };
    const initialize = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      }),
    });
    expect(initialize.status).toBe(200);
    expect(await initialize.json()).toMatchObject({
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
      },
    });

    const tools = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });
    const toolNames = (
      (await tools.json()) as {
        result: { tools: Array<{ name: string }> };
      }
    ).result.tools.map((tool) => tool.name);
    expect(toolNames).toContain("memo_list_memos");
    expect(toolNames).not.toContain("list_memos");

    const toolCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "memo_create_memo",
          arguments: { body: { content: "created through current MCP" } },
        },
      }),
    });
    expect(toolCall.status).toBe(200);
    expect(await toolCall.json()).toMatchObject({
      result: {
        structuredContent: {
          content: "created through current MCP",
        },
      },
    });

    const commentCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "memo_create_memo_comment",
          arguments: { name: created.name, content: "MCP comment" },
        },
      }),
    });
    const commentBody = (await commentCall.json()) as {
      result: { structuredContent: { name: string; parent: string } };
    };
    expect(commentBody.result.structuredContent).toMatchObject({
      name: expect.stringMatching(/^memos\//),
      parent: created.name,
    });

    const commentsCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "memo_list_memo_comments",
          arguments: { name: created.name },
        },
      }),
    });
    expect(await commentsCall.json()).toMatchObject({
      result: {
        structuredContent: {
          memos: [expect.objectContaining({ content: "MCP comment" })],
        },
      },
    });

    const reactionCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "memo_upsert_memo_reaction",
          arguments: { name: created.name, reactionType: "👍" },
        },
      }),
    });
    const reactionBody = (await reactionCall.json()) as {
      result: { structuredContent: { name: string; reactionType: string } };
    };
    expect(reactionBody.result.structuredContent).toMatchObject({
      name: expect.stringContaining("/reactions/"),
      reactionType: "👍",
    });

    const reactionListCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "memo_list_memo_reactions",
          arguments: { name: created.name },
        },
      }),
    });
    expect(await reactionListCall.json()).toMatchObject({
      result: {
        structuredContent: {
          reactions: [expect.objectContaining({ reactionType: "👍" })],
        },
      },
    });

    const shortcutCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "shortcut_create_shortcut",
          arguments: {
            title: "MCP shortcut",
            filter: 'content.contains("MCP")',
          },
        },
      }),
    });
    const shortcutBody = (await shortcutCall.json()) as {
      result: { structuredContent: { name: string; title: string } };
    };
    expect(shortcutBody.result.structuredContent).toMatchObject({
      name: expect.stringMatching(/^users\/owner\/shortcuts\//),
      title: "MCP shortcut",
    });

    const shortcutName = shortcutBody.result.structuredContent.name;
    const shortcutUpdateCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "shortcut_update_shortcut",
          arguments: {
            name: shortcutName,
            title: "Updated MCP shortcut",
            updateMask: "title",
          },
        },
      }),
    });
    expect(await shortcutUpdateCall.json()).toMatchObject({
      result: {
        structuredContent: {
          name: shortcutName,
          title: "Updated MCP shortcut",
        },
      },
    });

    const shortcutGetCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "shortcut_get_shortcut",
          arguments: { name: shortcutName },
        },
      }),
    });
    expect(await shortcutGetCall.json()).toMatchObject({
      result: { structuredContent: { name: shortcutName } },
    });

    const shortcutDeleteCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: {
          name: "shortcut_delete_shortcut",
          arguments: { name: shortcutName },
        },
      }),
    });
    expect(await shortcutDeleteCall.json()).toMatchObject({
      result: { structuredContent: { ok: true } },
    });

    const reactionId = reactionBody.result.structuredContent.name
      .split("/")
      .at(-1);
    const reactionDeleteCall = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "memo_delete_memo_reaction",
          arguments: { name: created.name, reaction: reactionId },
        },
      }),
    });
    expect(await reactionDeleteCall.json()).toMatchObject({
      result: { structuredContent: { ok: true } },
    });

    const toolError = await fetchCurrent("http://flaremo.test/mcp", {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "not_a_real_tool", arguments: {} },
      }),
    });
    expect(await toolError.json()).toMatchObject({
      result: {
        isError: true,
        content: [{ type: "text" }],
      },
    });
  });
});
