import { FLAREMO_API_VERSION } from "./openapi";

type JsonSchema = Record<string, unknown>;

const json = (schema: JsonSchema) => ({
  "application/json": { schema },
});

const response = (description: string, schema: JsonSchema) => ({
  description,
  content: json(schema),
});

const emptyResponse = (description: string) => ({ description });

const bearerSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];

const memoName = {
  name: "memo",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "A memo resource name or memo id.",
};

const attachmentName = {
  name: "attachment",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "An attachment resource name or attachment id.",
};

const userName = {
  name: "user",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "The current user resource name, for example users/owner.",
};

const currentMemo = {
  type: "object",
  required: ["content"],
  properties: {
    name: { type: "string" },
    state: {
      type: "string",
      enum: ["STATE_UNSPECIFIED", "NORMAL", "ARCHIVED"],
    },
    creator: { type: "string" },
    createTime: { type: "string", format: "date-time" },
    updateTime: { type: "string", format: "date-time" },
    content: { type: "string" },
    visibility: {
      type: "string",
      enum: ["VISIBILITY_UNSPECIFIED", "PRIVATE", "PROTECTED", "PUBLIC"],
    },
    tags: { type: "array", items: { type: "string" } },
    pinned: { type: "boolean" },
    attachments: {
      type: "array",
      items: { $ref: "#/components/schemas/Attachment" },
    },
    relations: {
      type: "array",
      items: { $ref: "#/components/schemas/MemoRelation" },
    },
    reactions: { type: "array", items: { type: "object" } },
    property: { $ref: "#/components/schemas/MemoProperty" },
    snippet: { type: "string" },
    location: { $ref: "#/components/schemas/Location" },
  },
};

const memoRequest = {
  type: "object",
  required: ["memo"],
  properties: {
    memo: currentMemo,
    memoId: {
      type: "string",
      description: "Not supported; FlareMo generates ids.",
    },
  },
};

const attachment = {
  type: "object",
  required: ["filename", "type"],
  properties: {
    name: { type: "string" },
    createTime: { type: "string", format: "date-time" },
    filename: { type: "string" },
    content: {
      type: "string",
      format: "byte",
      description: "Base64-encoded input bytes.",
    },
    externalLink: { type: "string", format: "uri" },
    type: { type: "string" },
    size: {
      type: "string",
      description: "Protobuf JSON int64 represented as a decimal string.",
    },
    memo: { type: "string" },
  },
};

const attachmentRequest = {
  type: "object",
  required: ["attachment"],
  properties: {
    attachment,
    attachmentId: {
      type: "string",
      description: "Not supported; FlareMo generates ids.",
    },
  },
};

const currentUser = {
  type: "object",
  properties: {
    name: { type: "string" },
    role: { type: "string", enum: ["ROLE_UNSPECIFIED", "USER", "ADMIN"] },
    username: { type: "string" },
    email: { type: "string", format: "email" },
    displayName: { type: "string" },
    avatarUrl: { type: "string", format: "uri" },
    state: { type: "string", enum: ["STATE_UNSPECIFIED", "NORMAL"] },
    createTime: { type: "string", format: "date-time" },
    updateTime: { type: "string", format: "date-time" },
  },
};

const error = {
  type: "object",
  required: ["code", "message", "details"],
  properties: {
    code: { type: "integer" },
    message: { type: "string" },
    details: { type: "array", items: { type: "object" } },
  },
};

const secured = (input: Record<string, unknown>) => ({
  ...input,
  security: bearerSecurity,
});

export function createCurrentOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "FlareMo current Memos-compatible API",
      version: FLAREMO_API_VERSION,
      description:
        "The default /api/v1 wire format is the current Memos camelCase/protobuf-JSON subset. FlareMo uses Better Auth cookie sessions and opaque session-backed access tokens or memos_pat_ PATs. The legacy FlareMo snake_case wire is available only with X-FlareMo-Wire: legacy or application/vnd.flaremo.legacy+json.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Auth" },
      { name: "Memos" },
      { name: "Attachments" },
      { name: "Relations" },
      { name: "Shares" },
      { name: "Users" },
      { name: "MCP" },
    ],
    paths: {
      "/api/v1/auth/me": {
        get: secured({
          operationId: "getCurrentUser",
          summary: "Get the current user",
          tags: ["Auth"],
          responses: {
            "200": response("Current user.", {
              type: "object",
              properties: { user: { $ref: "#/components/schemas/User" } },
            }),
            "401": response("Unauthenticated.", error),
          },
        }),
      },
      "/api/v1/auth/signin": {
        post: {
          operationId: "signIn",
          summary: "Sign in with Better Auth-backed credentials",
          tags: ["Auth"],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["passwordCredentials"],
              properties: {
                passwordCredentials: {
                  type: "object",
                  required: ["username", "password"],
                  properties: {
                    username: { type: "string" },
                    password: { type: "string", format: "password" },
                  },
                },
              },
            }),
          },
          responses: {
            "200": response("Signed-in user and opaque access token.", {
              type: "object",
              properties: {
                user: { $ref: "#/components/schemas/User" },
                accessToken: { type: "string" },
                accessTokenExpiresAt: { type: "string", format: "date-time" },
              },
            }),
            "401": response("Invalid credentials.", error),
          },
        },
      },
      "/api/v1/auth/refresh": {
        post: secured({
          operationId: "refreshToken",
          summary: "Refresh the Better Auth-backed session facade",
          tags: ["Auth"],
          responses: {
            "200": response("Access token.", {
              type: "object",
              properties: {
                accessToken: { type: "string" },
                expiresAt: { type: "string", format: "date-time" },
              },
            }),
            "401": response("Unauthenticated.", error),
          },
        }),
      },
      "/api/v1/auth/signout": {
        post: secured({
          operationId: "signOut",
          summary: "Sign out and revoke the current session",
          tags: ["Auth"],
          responses: {
            "200": emptyResponse("Signed out."),
            "401": response("Unauthenticated.", error),
          },
        }),
      },
      "/api/v1/memos": {
        get: secured({
          operationId: "listMemosCurrent",
          summary: "List memos",
          tags: ["Memos"],
          parameters: [
            {
              name: "pageSize",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100 },
            },
            { name: "pageToken", in: "query", schema: { type: "string" } },
            {
              name: "state",
              in: "query",
              schema: {
                type: "string",
                enum: ["STATE_UNSPECIFIED", "NORMAL", "ARCHIVED"],
              },
            },
            {
              name: "orderBy",
              in: "query",
              schema: { type: "string", example: "create_time desc" },
            },
            {
              name: "filter",
              in: "query",
              schema: { type: "string" },
              description:
                "Supported subset: content.contains, tags.exists, pinned == true, visibility == enum.",
            },
            { name: "showDeleted", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": response("Memos.", {
              type: "object",
              properties: {
                memos: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Memo" },
                },
                nextPageToken: { type: "string" },
              },
            }),
            "400": response("Invalid argument.", error),
          },
        }),
        post: secured({
          operationId: "createMemoCurrent",
          summary: "Create a memo",
          tags: ["Memos"],
          requestBody: { required: true, content: json(memoRequest) },
          responses: {
            "200": response("Created memo.", {
              $ref: "#/components/schemas/Memo",
            }),
            "400": response("Invalid argument.", error),
          },
        }),
      },
      "/api/v1/memos/{memo}": {
        get: secured({
          operationId: "getMemoCurrent",
          summary: "Get a memo",
          tags: ["Memos"],
          parameters: [memoName],
          responses: {
            "200": response("Memo.", { $ref: "#/components/schemas/Memo" }),
            "404": response("Not found.", error),
          },
        }),
        patch: secured({
          operationId: "updateMemoCurrent",
          summary: "Update a memo",
          tags: ["Memos"],
          parameters: [
            memoName,
            {
              name: "updateMask",
              in: "query",
              required: true,
              schema: { type: "string" },
              description: "Comma-separated allowlisted fields.",
            },
          ],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["memo"],
              properties: { memo: currentMemo },
            }),
          },
          responses: {
            "200": response("Updated memo.", {
              $ref: "#/components/schemas/Memo",
            }),
            "400": response("Invalid argument.", error),
          },
        }),
        delete: secured({
          operationId: "deleteMemoCurrent",
          summary: "Delete a memo",
          tags: ["Memos"],
          parameters: [
            memoName,
            { name: "force", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": emptyResponse("Deleted."),
            "404": response("Not found.", error),
          },
        }),
      },
      "/api/v1/memos/{memo}/attachments": {
        get: secured({
          operationId: "listMemoAttachmentsCurrent",
          summary: "List memo attachments",
          tags: ["Attachments"],
          parameters: [memoName],
          responses: {
            "200": response("Attachments.", {
              type: "object",
              properties: {
                attachments: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Attachment" },
                },
              },
            }),
          },
        }),
        patch: secured({
          operationId: "setMemoAttachmentsCurrent",
          summary: "Replace memo attachments",
          tags: ["Attachments"],
          parameters: [memoName],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["attachments"],
              properties: {
                name: { type: "string" },
                attachments: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Attachment" },
                },
              },
            }),
          },
          responses: { "200": emptyResponse("Attachments replaced.") },
        }),
      },
      "/api/v1/memos/{memo}/relations": {
        get: secured({
          operationId: "listMemoRelationsCurrent",
          summary: "List memo relations",
          tags: ["Relations"],
          parameters: [memoName],
          responses: {
            "200": response("Relations.", {
              type: "object",
              properties: {
                relations: {
                  type: "array",
                  items: { $ref: "#/components/schemas/MemoRelation" },
                },
              },
            }),
          },
        }),
        patch: secured({
          operationId: "setMemoRelationsCurrent",
          summary: "Replace memo relations",
          tags: ["Relations"],
          parameters: [memoName],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["relations"],
              properties: {
                name: { type: "string" },
                relations: {
                  type: "array",
                  items: { $ref: "#/components/schemas/MemoRelation" },
                },
              },
            }),
          },
          responses: { "200": emptyResponse("Relations replaced.") },
        }),
      },
      "/api/v1/memos/{memo}/shares": {
        get: secured({
          operationId: "listMemoSharesCurrent",
          summary: "List memo shares",
          tags: ["Shares"],
          parameters: [memoName],
          responses: {
            "200": response("Shares.", {
              type: "object",
              properties: {
                memoShares: {
                  type: "array",
                  items: { $ref: "#/components/schemas/MemoShare" },
                },
              },
            }),
          },
        }),
        post: secured({
          operationId: "createMemoShareCurrent",
          summary: "Create a memo share",
          tags: ["Shares"],
          parameters: [memoName],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                parent: { type: "string" },
                memoShare: { $ref: "#/components/schemas/MemoShare" },
              },
            }),
          },
          responses: {
            "200": response("Share.", {
              $ref: "#/components/schemas/MemoShare",
            }),
          },
        }),
      },
      "/api/v1/memos/{memo}/shares/{share}": {
        delete: secured({
          operationId: "deleteMemoShareCurrent",
          summary: "Delete a memo share",
          tags: ["Shares"],
          parameters: [
            memoName,
            {
              name: "share",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": emptyResponse("Share deleted.") },
        }),
      },
      "/api/v1/shares/{share_id}": {
        get: {
          operationId: "getMemoByShareCurrent",
          summary: "Get a memo by public share token",
          tags: ["Shares"],
          parameters: [
            {
              name: "share_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": response("Shared memo.", {
              $ref: "#/components/schemas/Memo",
            }),
            "404": response("Not found.", error),
          },
        },
      },
      "/api/v1/attachments": {
        get: secured({
          operationId: "listAttachmentsCurrent",
          summary: "List attachments",
          tags: ["Attachments"],
          parameters: [
            {
              name: "pageSize",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100 },
            },
            { name: "memo", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": response("Attachments.", {
              type: "object",
              properties: {
                attachments: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Attachment" },
                },
              },
            }),
          },
        }),
        post: secured({
          operationId: "createAttachmentCurrent",
          summary: "Create an attachment from base64 JSON",
          tags: ["Attachments"],
          requestBody: { required: true, content: json(attachmentRequest) },
          responses: {
            "200": response("Attachment.", {
              $ref: "#/components/schemas/Attachment",
            }),
          },
        }),
      },
      "/api/v1/attachments/{attachment}": {
        get: secured({
          operationId: "getAttachmentCurrent",
          summary: "Get attachment metadata",
          tags: ["Attachments"],
          parameters: [attachmentName],
          responses: {
            "200": response("Attachment.", {
              $ref: "#/components/schemas/Attachment",
            }),
          },
        }),
        patch: secured({
          operationId: "updateAttachmentCurrent",
          summary: "Bind an attachment to a memo",
          tags: ["Attachments"],
          parameters: [
            attachmentName,
            {
              name: "updateMask",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["memo"] },
            },
          ],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                attachment: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    memo: { type: "string" },
                  },
                },
              },
            }),
          },
          responses: {
            "200": response("Attachment.", {
              $ref: "#/components/schemas/Attachment",
            }),
          },
        }),
        delete: secured({
          operationId: "deleteAttachmentCurrent",
          summary: "Delete an attachment",
          tags: ["Attachments"],
          parameters: [attachmentName],
          responses: { "200": emptyResponse("Deleted.") },
        }),
      },
      "/api/v1/users": {
        get: secured({
          operationId: "listUsersCurrent",
          summary: "List the current user",
          tags: ["Users"],
          responses: {
            "200": response("Users.", {
              type: "object",
              properties: {
                users: {
                  type: "array",
                  items: { $ref: "#/components/schemas/User" },
                },
              },
            }),
          },
        }),
      },
      "/api/v1/users/{user}": {
        get: secured({
          operationId: "getUserCurrent",
          summary: "Get the current user",
          tags: ["Users"],
          parameters: [userName],
          responses: {
            "200": response("User.", { $ref: "#/components/schemas/User" }),
          },
        }),
      },
      "/api/v1/users/{user}/personalAccessTokens": {
        get: secured({
          operationId: "listPersonalAccessTokensCurrent",
          summary: "List personal access tokens",
          tags: ["Users"],
          parameters: [userName],
          responses: {
            "200": response("Personal access tokens.", {
              type: "object",
              properties: {
                personalAccessTokens: {
                  type: "array",
                  items: { $ref: "#/components/schemas/PersonalAccessToken" },
                },
                totalSize: { type: "integer" },
              },
            }),
          },
        }),
        post: secured({
          operationId: "createPersonalAccessTokenCurrent",
          summary: "Create a personal access token",
          tags: ["Users"],
          parameters: [userName],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                description: { type: "string" },
                expiresInDays: { type: "integer", minimum: 0, maximum: 365 },
              },
            }),
          },
          responses: {
            "200": response("Token metadata and one-time token value.", {
              type: "object",
              properties: {
                personalAccessToken: {
                  $ref: "#/components/schemas/PersonalAccessToken",
                },
                token: { type: "string" },
              },
            }),
          },
        }),
      },
      "/api/v1/users/{user}/personalAccessTokens/{token}": {
        delete: secured({
          operationId: "deletePersonalAccessTokenCurrent",
          summary: "Revoke a personal access token",
          tags: ["Users"],
          parameters: [
            userName,
            {
              name: "token",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": emptyResponse("Token revoked.") },
        }),
      },
      "/mcp": {
        post: secured({
          operationId: "mcpStreamableHttp",
          summary: "Stateless current Memos MCP Streamable HTTP endpoint",
          tags: ["MCP"],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                jsonrpc: { type: "string", enum: ["2.0"] },
                id: {},
                method: { type: "string" },
                params: { type: "object" },
              },
            }),
          },
          responses: {
            "200": response("JSON-RPC response.", { type: "object" }),
            "202": emptyResponse("Notification accepted."),
          },
        }),
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "memos_pat_ or Better Auth session token",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "flaremo.session_token",
        },
      },
      schemas: {
        Memo: currentMemo,
        MemoProperty: {
          type: "object",
          properties: {
            hasLink: { type: "boolean" },
            hasTaskList: { type: "boolean" },
            hasCode: { type: "boolean" },
            hasIncompleteTasks: { type: "boolean" },
            title: { type: "string" },
          },
        },
        Location: {
          type: "object",
          properties: {
            placeholder: { type: "string" },
            latitude: { type: "number" },
            longitude: { type: "number" },
          },
        },
        Attachment: attachment,
        MemoRelation: {
          type: "object",
          properties: {
            memo: {
              type: "object",
              properties: {
                name: { type: "string" },
                snippet: { type: "string" },
              },
            },
            relatedMemo: {
              type: "object",
              properties: {
                name: { type: "string" },
                snippet: { type: "string" },
              },
            },
            type: {
              type: "string",
              enum: ["TYPE_UNSPECIFIED", "REFERENCE", "COMMENT"],
            },
          },
        },
        MemoShare: {
          type: "object",
          properties: {
            name: { type: "string" },
            createTime: { type: "string", format: "date-time" },
            expireTime: { type: "string", format: "date-time", nullable: true },
          },
        },
        User: currentUser,
        PersonalAccessToken: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            expiresAt: { type: "string", format: "date-time", nullable: true },
            lastUsedAt: { type: "string", format: "date-time", nullable: true },
          },
        },
        Error: error,
      },
    },
    "x-flaremo-legacy-wire": {
      header: "X-FlareMo-Wire: legacy",
      accept: "application/vnd.flaremo.legacy+json",
      document: "/openapi.json",
    },
  };
}
