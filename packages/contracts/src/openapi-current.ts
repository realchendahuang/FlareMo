import { FLAREMO_API_VERSION } from "./openapi";

type JsonSchema = Record<string, unknown>;

const json = (schema: JsonSchema) => ({
  "application/json": { schema },
});

const binaryMessage = {
  schema: { type: "string", format: "binary" },
};

const connectContent = (schema: JsonSchema) => ({
  ...json(schema),
  "application/proto": binaryMessage,
  "application/grpc": binaryMessage,
  "application/grpc+proto": binaryMessage,
  "application/grpc-web": binaryMessage,
  "application/grpc-web+proto": binaryMessage,
  "application/grpc-web-text": binaryMessage,
  "application/grpc-web-text+proto": binaryMessage,
});

const connectResponseContent = (schema: JsonSchema) => ({
  ...connectContent(schema),
});

const response = (description: string, schema: JsonSchema) => ({
  description,
  content: json(schema),
});

const emptyResponse = (description: string) => ({ description });

const bearerSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];
const optionalReadSecurity = [...bearerSecurity, {}];

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

const attachmentFilename = {
  name: "filename",
  in: "path",
  required: true,
  schema: { type: "string" },
  description:
    "The filename segment used by the official Memos Web URL; object lookup uses the attachment resource name.",
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
    reactions: {
      type: "array",
      items: { $ref: "#/components/schemas/MemoReaction" },
    },
    parent: { type: "string" },
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

const memoReaction = {
  type: "object",
  required: ["name", "creator", "contentId", "reactionType", "createTime"],
  properties: {
    name: { type: "string" },
    creator: { type: "string" },
    contentId: { type: "string" },
    reactionType: { type: "string" },
    createTime: { type: "string", format: "date-time" },
  },
};

const shortcut = {
  type: "object",
  required: ["name", "title"],
  properties: {
    name: { type: "string" },
    title: { type: "string" },
    filter: { type: "string" },
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
  security: input.security ?? bearerSecurity,
});

const connectOperation = (
  operationId: string,
  summary: string,
  security: unknown[] | undefined = undefined,
) =>
  secured({
    operationId,
    summary,
    tags: ["Connect"],
    ...(security ? { security } : {}),
    parameters: [
      {
        name: "connect-protocol-version",
        in: "header",
        required: false,
        schema: { type: "string", example: "1" },
        description:
          "Accepted for compatibility metadata. The current implementation supports JSON plus unary protobuf, gRPC, and gRPC-Web protobuf transports for the documented method subset.",
      },
    ],
    requestBody: {
      required: true,
      content: connectContent({ type: "object", additionalProperties: true }),
    },
    responses: {
      "200": {
        description: "Connect response message.",
        content: connectResponseContent({
          type: "object",
          additionalProperties: true,
        }),
      },
      "400": response("Invalid argument.", error),
      "401": response("Unauthenticated.", error),
      "415": response(
        "Only the documented JSON or protobuf unary media types are supported.",
        error,
      ),
      "501": response("Method is not implemented.", error),
    },
  });

export function createCurrentOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "FlareMo current Memos-compatible API",
      version: FLAREMO_API_VERSION,
      description:
        "The default /api/v1 wire format is the current Memos camelCase/protobuf-JSON subset. Better Auth remains the identity source; the Memos-compatible signin facade issues an HS256 native Memos access JWT and a rotating memos_refresh HttpOnly cookie. Existing Better Auth session bearers and memos_pat_ PATs remain accepted. This is not a claim of complete Memos Server, protobuf Connect, native gRPC, or third-party-client parity. The legacy FlareMo snake_case wire is available only with X-FlareMo-Wire: legacy or application/vnd.flaremo.legacy+json.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Auth" },
      { name: "Memos" },
      { name: "Attachments" },
      { name: "Relations" },
      { name: "Social" },
      { name: "Realtime" },
      { name: "Connect" },
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
            "200": response(
              "Signed-in user, native Memos HS256 access JWT, and a memos_refresh HttpOnly cookie.",
              {
                type: "object",
                properties: {
                  user: { $ref: "#/components/schemas/User" },
                  accessToken: {
                    type: "string",
                    description:
                      "Native Memos-compatible JWT with issuer memos and user.access-token audience.",
                  },
                  accessTokenExpiresAt: { type: "string", format: "date-time" },
                },
              },
            ),
            "401": response("Invalid credentials.", error),
          },
        },
      },
      "/api/v1/auth/refresh": {
        post: secured({
          operationId: "refreshToken",
          summary: "Rotate the native Memos refresh cookie",
          tags: ["Auth"],
          security: [
            { memosRefreshCookie: [] },
            { bearerAuth: [] },
            { cookieAuth: [] },
          ],
          responses: {
            "200": response("Rotated native Memos access token.", {
              type: "object",
              properties: {
                accessToken: {
                  type: "string",
                  description:
                    "Native Memos-compatible HS256 JWT. The refresh token itself is never returned in JSON.",
                },
                accessTokenExpiresAt: { type: "string", format: "date-time" },
                expiresAt: {
                  type: "string",
                  format: "date-time",
                  deprecated: true,
                },
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
          security: optionalReadSecurity,
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
          security: optionalReadSecurity,
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
          security: optionalReadSecurity,
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
          security: optionalReadSecurity,
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
      "/api/v1/memos/{memo}/comments": {
        get: secured({
          operationId: "listMemoCommentsCurrent",
          summary: "List comments represented as child memos",
          tags: ["Social"],
          security: optionalReadSecurity,
          parameters: [
            memoName,
            {
              name: "pageSize",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 1000 },
            },
            { name: "pageToken", in: "query", schema: { type: "string" } },
            {
              name: "orderBy",
              in: "query",
              schema: { type: "string", example: "create_time desc" },
            },
          ],
          responses: {
            "200": response("Comment memos.", {
              type: "object",
              properties: {
                memos: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Memo" },
                },
                nextPageToken: { type: "string" },
                totalSize: { type: "integer" },
              },
            }),
          },
        }),
        post: secured({
          operationId: "createMemoCommentCurrent",
          summary: "Create a comment memo",
          tags: ["Social"],
          parameters: [memoName],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["content"],
              properties: {
                content: { type: "string" },
                visibility: { type: "string" },
                payload: { type: "object", additionalProperties: true },
                commentId: { type: "string" },
              },
            }),
          },
          responses: {
            "200": response("Created comment memo.", {
              $ref: "#/components/schemas/Memo",
            }),
          },
        }),
      },
      "/api/v1/memos/{memo}/reactions": {
        get: secured({
          operationId: "listMemoReactionsCurrent",
          summary: "List reactions on a memo",
          tags: ["Social"],
          security: optionalReadSecurity,
          parameters: [
            memoName,
            {
              name: "pageSize",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 1000 },
            },
            { name: "pageToken", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": response("Memo reactions.", {
              type: "object",
              properties: {
                reactions: {
                  type: "array",
                  items: { $ref: "#/components/schemas/MemoReaction" },
                },
                nextPageToken: { type: "string" },
                totalSize: { type: "integer" },
              },
            }),
          },
        }),
        post: secured({
          operationId: "upsertMemoReactionCurrent",
          summary: "Create or upsert the current user's reaction",
          tags: ["Social"],
          parameters: [memoName],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["reactionType"],
              properties: {
                contentId: { type: "string" },
                reactionType: { type: "string" },
              },
            }),
          },
          responses: {
            "200": response("Reaction.", {
              $ref: "#/components/schemas/MemoReaction",
            }),
          },
        }),
      },
      "/api/v1/memos/{memo}/reactions/{reaction}": {
        delete: secured({
          operationId: "deleteMemoReactionCurrent",
          summary: "Delete the current user's reaction",
          tags: ["Social"],
          parameters: [
            memoName,
            {
              name: "reaction",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": emptyResponse("Reaction deleted.") },
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
      "/file/attachments/{attachment}/{filename}": {
        get: secured({
          operationId: "getMemosAttachmentFile",
          summary: "Serve a Memos Web-compatible attachment file URL",
          description:
            "Private requests require Better Auth/PAT/native access authentication. An unauthenticated request is allowed only when share_token identifies a valid, unexpired share for the attachment's memo. The filename is a compatibility path segment and is not used to select an R2 object.",
          tags: ["Attachments"],
          security: optionalReadSecurity,
          parameters: [
            attachmentName,
            attachmentFilename,
            {
              name: "share_token",
              in: "query",
              schema: { type: "string" },
              description:
                "Optional public-share token used by the Memos Web share view.",
            },
            {
              name: "thumbnail",
              in: "query",
              schema: { type: "boolean" },
              description:
                "Currently returns the original object; image thumbnail generation is not implemented.",
            },
          ],
          responses: {
            "200": {
              description: "Attachment bytes.",
              content: { "application/octet-stream": binaryMessage },
            },
            "206": {
              description:
                "Partial attachment bytes for a valid Range request.",
              content: { "application/octet-stream": binaryMessage },
            },
            "304": emptyResponse("Attachment has not changed."),
            "401": response("Authentication required.", error),
            "404": response("Attachment or share not found.", error),
          },
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
      "/api/v1/users/{user}/shortcuts": {
        get: secured({
          operationId: "listShortcutsCurrent",
          summary: "List shortcuts for the current user",
          tags: ["Social"],
          parameters: [userName],
          responses: {
            "200": response("Shortcuts.", {
              type: "object",
              properties: {
                shortcuts: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Shortcut" },
                },
              },
            }),
          },
        }),
        post: secured({
          operationId: "createShortcutCurrent",
          summary: "Create or validate a shortcut",
          tags: ["Social"],
          parameters: [
            userName,
            {
              name: "validateOnly",
              in: "query",
              schema: { type: "boolean" },
            },
          ],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              required: ["title"],
              properties: {
                title: { type: "string" },
                filter: { type: "string" },
              },
            }),
          },
          responses: {
            "200": response("Shortcut.", {
              $ref: "#/components/schemas/Shortcut",
            }),
          },
        }),
      },
      "/api/v1/users/{user}/shortcuts/{shortcut}": {
        get: secured({
          operationId: "getShortcutCurrent",
          summary: "Get a shortcut",
          tags: ["Social"],
          parameters: [
            userName,
            {
              name: "shortcut",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": response("Shortcut.", {
              $ref: "#/components/schemas/Shortcut",
            }),
          },
        }),
        patch: secured({
          operationId: "updateShortcutCurrent",
          summary: "Update a shortcut",
          tags: ["Social"],
          parameters: [
            userName,
            {
              name: "shortcut",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "updateMask",
              in: "query",
              required: true,
              schema: { type: "string", example: "title,filter" },
            },
          ],
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                name: { type: "string" },
                title: { type: "string" },
                filter: { type: "string" },
              },
            }),
          },
          responses: {
            "200": response("Updated shortcut.", {
              $ref: "#/components/schemas/Shortcut",
            }),
          },
        }),
        delete: secured({
          operationId: "deleteShortcutCurrent",
          summary: "Delete a shortcut",
          tags: ["Social"],
          parameters: [
            userName,
            {
              name: "shortcut",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": emptyResponse("Shortcut deleted.") },
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
      "/api/v1/sse": {
        get: secured({
          operationId: "memoSseCurrent",
          summary: "Open the authenticated Memos-compatible SSE stream",
          tags: ["Realtime"],
          responses: {
            "200": {
              description:
                "Authenticated text/event-stream backed by a D1 event outbox. New connections start at the current cursor; Last-Event-ID requests replay the currently retained memo/comment/reaction event subset. The Worker polls D1 and sends connected/heartbeat comments.",
              content: {
                "text/event-stream": {
                  schema: { type: "string" },
                },
              },
            },
            "401": response("Unauthenticated.", error),
          },
        }),
      },
      "/memos.api.v1.MemoService/CreateMemo": {
        post: connectOperation("connectCreateMemo", "Create a memo"),
      },
      "/memos.api.v1.MemoService/ListMemos": {
        post: connectOperation(
          "connectListMemos",
          "List memos",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.MemoService/GetMemo": {
        post: connectOperation(
          "connectGetMemo",
          "Get a memo",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.MemoService/UpdateMemo": {
        post: connectOperation("connectUpdateMemo", "Update a memo"),
      },
      "/memos.api.v1.MemoService/DeleteMemo": {
        post: connectOperation("connectDeleteMemo", "Delete a memo"),
      },
      "/memos.api.v1.MemoService/SetMemoAttachments": {
        post: connectOperation(
          "connectSetMemoAttachments",
          "Replace memo attachments",
        ),
      },
      "/memos.api.v1.MemoService/ListMemoAttachments": {
        post: connectOperation(
          "connectListMemoAttachments",
          "List memo attachments",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.MemoService/SetMemoRelations": {
        post: connectOperation(
          "connectSetMemoRelations",
          "Replace memo relations",
        ),
      },
      "/memos.api.v1.MemoService/ListMemoRelations": {
        post: connectOperation(
          "connectListMemoRelations",
          "List memo relations",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.MemoService/CreateMemoComment": {
        post: connectOperation(
          "connectCreateMemoComment",
          "Create a memo comment",
        ),
      },
      "/memos.api.v1.MemoService/ListMemoComments": {
        post: connectOperation(
          "connectListMemoComments",
          "List memo comments",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.MemoService/ListMemoReactions": {
        post: connectOperation(
          "connectListMemoReactions",
          "List memo reactions",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.MemoService/UpsertMemoReaction": {
        post: connectOperation(
          "connectUpsertMemoReaction",
          "Upsert a memo reaction",
        ),
      },
      "/memos.api.v1.MemoService/DeleteMemoReaction": {
        post: connectOperation(
          "connectDeleteMemoReaction",
          "Delete a memo reaction",
        ),
      },
      "/memos.api.v1.MemoService/CreateMemoShare": {
        post: connectOperation("connectCreateMemoShare", "Create a memo share"),
      },
      "/memos.api.v1.MemoService/ListMemoShares": {
        post: connectOperation("connectListMemoShares", "List memo shares"),
      },
      "/memos.api.v1.MemoService/DeleteMemoShare": {
        post: connectOperation("connectDeleteMemoShare", "Delete a memo share"),
      },
      "/memos.api.v1.MemoService/GetSharedMemo": {
        post: connectOperation("connectGetSharedMemo", "Get a shared memo", []),
      },
      "/memos.api.v1.MemoService/GetMemoByShare": {
        post: connectOperation(
          "connectGetMemoByShare",
          "Get a memo by share token",
          [],
        ),
      },
      "/memos.api.v1.MemoService/GetLinkMetadata": {
        post: connectOperation(
          "connectGetLinkMetadata",
          "Get link metadata",
          [],
        ),
      },
      "/memos.api.v1.MemoService/BatchGetLinkMetadata": {
        post: connectOperation(
          "connectBatchGetLinkMetadata",
          "Get link metadata for multiple URLs",
          [],
        ),
      },
      "/memos.api.v1.AuthService/GetCurrentUser": {
        post: connectOperation("connectGetCurrentUser", "Get the current user"),
      },
      "/memos.api.v1.AuthService/SignIn": {
        post: connectOperation("connectSignIn", "Sign in", []),
      },
      "/memos.api.v1.AuthService/RefreshToken": {
        post: connectOperation("connectRefreshToken", "Refresh token", []),
      },
      "/memos.api.v1.AuthService/SignOut": {
        post: connectOperation("connectSignOut", "Sign out"),
      },
      "/memos.api.v1.ShortcutService/ListShortcuts": {
        post: connectOperation("connectListShortcuts", "List shortcuts"),
      },
      "/memos.api.v1.ShortcutService/GetShortcut": {
        post: connectOperation("connectGetShortcut", "Get a shortcut"),
      },
      "/memos.api.v1.ShortcutService/CreateShortcut": {
        post: connectOperation("connectCreateShortcut", "Create a shortcut"),
      },
      "/memos.api.v1.ShortcutService/UpdateShortcut": {
        post: connectOperation("connectUpdateShortcut", "Update a shortcut"),
      },
      "/memos.api.v1.ShortcutService/DeleteShortcut": {
        post: connectOperation("connectDeleteShortcut", "Delete a shortcut"),
      },
      "/memos.api.v1.AttachmentService/CreateAttachment": {
        post: connectOperation(
          "connectCreateAttachment",
          "Create an attachment",
        ),
      },
      "/memos.api.v1.AttachmentService/ListAttachments": {
        post: connectOperation("connectListAttachments", "List attachments"),
      },
      "/memos.api.v1.AttachmentService/GetAttachment": {
        post: connectOperation("connectGetAttachment", "Get an attachment"),
      },
      "/memos.api.v1.AttachmentService/UpdateAttachment": {
        post: connectOperation(
          "connectUpdateAttachment",
          "Update an attachment",
        ),
      },
      "/memos.api.v1.AttachmentService/DeleteAttachment": {
        post: connectOperation(
          "connectDeleteAttachment",
          "Delete an attachment",
        ),
      },
      "/memos.api.v1.AttachmentService/BatchDeleteAttachments": {
        post: connectOperation(
          "connectBatchDeleteAttachments",
          "Delete multiple attachments",
        ),
      },
      "/memos.api.v1.UserService/ListUsers": {
        post: connectOperation("connectListUsers", "List users"),
      },
      "/memos.api.v1.UserService/BatchGetUsers": {
        post: connectOperation("connectBatchGetUsers", "Get multiple users"),
      },
      "/memos.api.v1.UserService/GetUser": {
        post: connectOperation("connectGetUser", "Get a user"),
      },
      "/memos.api.v1.UserService/UpdateUser": {
        post: connectOperation("connectUpdateUser", "Update a user"),
      },
      "/memos.api.v1.UserService/GetUserStats": {
        post: connectOperation("connectGetUserStats", "Get user statistics"),
      },
      "/memos.api.v1.UserService/ListAllUserStats": {
        post: connectOperation(
          "connectListAllUserStats",
          "List user statistics",
        ),
      },
      "/memos.api.v1.UserService/GetUserSetting": {
        post: connectOperation("connectGetUserSetting", "Get a user setting"),
      },
      "/memos.api.v1.UserService/ListUserSettings": {
        post: connectOperation("connectListUserSettings", "List user settings"),
      },
      "/memos.api.v1.UserService/UpdateUserSetting": {
        post: connectOperation(
          "connectUpdateUserSetting",
          "Update a user setting",
        ),
      },
      "/memos.api.v1.UserService/ListLinkedIdentities": {
        post: connectOperation(
          "connectListLinkedIdentities",
          "List linked identities",
        ),
      },
      "/memos.api.v1.UserService/GetLinkedIdentity": {
        post: connectOperation(
          "connectGetLinkedIdentity",
          "Get a linked identity",
        ),
      },
      "/memos.api.v1.UserService/CreateLinkedIdentity": {
        post: connectOperation(
          "connectCreateLinkedIdentity",
          "Create a linked identity",
        ),
      },
      "/memos.api.v1.UserService/DeleteLinkedIdentity": {
        post: connectOperation(
          "connectDeleteLinkedIdentity",
          "Delete a linked identity",
        ),
      },
      "/memos.api.v1.UserService/ListPersonalAccessTokens": {
        post: connectOperation(
          "connectListPersonalAccessTokens",
          "List personal access tokens",
        ),
      },
      "/memos.api.v1.UserService/CreatePersonalAccessToken": {
        post: connectOperation(
          "connectCreatePersonalAccessToken",
          "Create a personal access token",
        ),
      },
      "/memos.api.v1.UserService/DeletePersonalAccessToken": {
        post: connectOperation(
          "connectDeletePersonalAccessToken",
          "Delete a personal access token",
        ),
      },
      "/memos.api.v1.UserService/ListUserWebhooks": {
        post: connectOperation("connectListUserWebhooks", "List user webhooks"),
      },
      "/memos.api.v1.UserService/ListUserNotifications": {
        post: connectOperation(
          "connectListUserNotifications",
          "List user notifications",
        ),
      },
      "/memos.api.v1.InstanceService/GetInstanceProfile": {
        post: connectOperation(
          "connectGetInstanceProfile",
          "Get the instance profile",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.InstanceService/GetInstanceSetting": {
        post: connectOperation(
          "connectGetInstanceSetting",
          "Get an instance setting",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.InstanceService/BatchGetInstanceSettings": {
        post: connectOperation(
          "connectBatchGetInstanceSettings",
          "Get multiple instance settings",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.InstanceService/UpdateInstanceSetting": {
        post: connectOperation(
          "connectUpdateInstanceSetting",
          "Update an instance setting",
        ),
      },
      "/memos.api.v1.InstanceService/GetInstanceStats": {
        post: connectOperation(
          "connectGetInstanceStats",
          "Get instance statistics",
        ),
      },
      "/memos.api.v1.InstanceService/TestInstanceEmailSetting": {
        post: connectOperation(
          "connectTestInstanceEmailSetting",
          "Test instance email settings",
        ),
      },
      "/memos.api.v1.IdentityProviderService/ListIdentityProviders": {
        post: connectOperation(
          "connectListIdentityProviders",
          "List identity providers",
          optionalReadSecurity,
        ),
      },
      "/memos.api.v1.AIService/Transcribe": {
        post: connectOperation("connectTranscribe", "Transcribe audio"),
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
          bearerFormat:
            "Memos native HS256 JWT, memos_pat_ PAT, or legacy Better Auth session bearer",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "flaremo.session_token",
        },
        memosRefreshCookie: {
          type: "apiKey",
          in: "cookie",
          name: "memos_refresh",
          description:
            "HttpOnly rotating Memos refresh JWT cookie. It is set by signin and consumed by refresh; the refresh token is never returned in JSON.",
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
        MemoReaction: memoReaction,
        Shortcut: shortcut,
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
