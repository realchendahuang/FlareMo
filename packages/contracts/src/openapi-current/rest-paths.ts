import {
  attachmentFilename,
  attachmentName,
  attachmentRequest,
  binaryMessage,
  currentMemo,
  emptyResponse,
  error,
  json,
  memoName,
  memoRequest,
  optionalReadSecurity,
  response,
  secured,
  userName,
} from "./shared";

export const restPaths = {
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
  "/api/v1/auth/signup": {
    post: {
      operationId: "signUpCurrent",
      summary: "Register a compatible member (email provider must be off)",
      tags: ["Auth"],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" },
            email: { type: "string", format: "email" },
            displayName: { type: "string" },
          },
        }),
      },
      responses: {
        "201": response("Registered user plus native tokens.", {
          type: "object",
          properties: {
            user: { $ref: "#/components/schemas/User" },
            accessToken: { type: "string" },
            accessTokenExpiresAt: { type: "string", format: "date-time" },
          },
        }),
        "403": response(
          "Registration is closed, or email verification is required.",
          error,
        ),
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
  "/api/v1/shares/{shareToken}/memo": {
    get: {
      operationId: "getSharedMemoCurrent",
      summary: "Get the memo behind a public share token",
      tags: ["Shares"],
      parameters: [
        {
          name: "shareToken",
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
          description: "Partial attachment bytes for a valid Range request.",
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
    post: secured({
      operationId: "createUserCurrent",
      summary: "Create a member (instance owner only)",
      tags: ["Users"],
      requestBody: {
        required: true,
        content: json({
          type: "object",
          required: ["username", "password"],
          properties: {
            username: { type: "string" },
            password: { type: "string" },
            displayName: { type: "string" },
          },
        }),
      },
      responses: {
        "201": response("Created user.", { $ref: "#/components/schemas/User" }),
        "401": response("Unauthenticated.", error),
        "403": response("Caller is not the instance owner.", error),
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
    delete: secured({
      operationId: "deleteUserCurrent",
      summary: "Remove a member and hand their shared notes to the owner",
      tags: ["Users"],
      parameters: [userName],
      responses: {
        "200": emptyResponse("Member removed."),
        "401": response("Unauthenticated.", error),
        "403": response("Caller is not the instance owner.", error),
        "404": response("User not found.", error),
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
  "/api/v1/export/tasks": {
    get: secured({
      operationId: "listExportTasks",
      summary: "List chunked export/import tasks",
      tags: ["ImportExport"],
      responses: {
        "200": response("Tasks.", {
          type: "object",
          properties: { tasks: { type: "array", items: { type: "object" } } },
        }),
        "401": response("Unauthenticated.", error),
      },
    }),
    post: secured({
      operationId: "createExportTask",
      summary: "Start a chunked export",
      tags: ["ImportExport"],
      responses: {
        "202": response("Export task accepted.", { type: "object" }),
        "401": response("Unauthenticated.", error),
      },
    }),
  },
  "/api/v1/export/tasks/{id}": {
    get: secured({
      operationId: "getExportTask",
      summary: "Poll one export/import task",
      tags: ["ImportExport"],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": response("Task state.", { type: "object" }),
        "404": response("Not found.", error),
      },
    }),
  },
  "/api/v1/export/tasks/{id}/manifest": {
    get: secured({
      operationId: "getExportTaskManifest",
      summary: "Download the export manifest",
      tags: ["ImportExport"],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "200": {
          description: "NDJSON manifest.",
          content: { "application/x-ndjson": { schema: { type: "string" } } },
        },
        "409": response("Export has not completed yet.", error),
        "404": response("Artifact missing.", error),
      },
    }),
  },
  "/api/v1/export/tasks/{id}/data/{chunk}": {
    get: secured({
      operationId: "getExportTaskChunk",
      summary: "Download one NDJSON data chunk",
      tags: ["ImportExport"],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        {
          name: "chunk",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "NDJSON chunk.",
          content: { "application/x-ndjson": { schema: { type: "string" } } },
        },
        "409": response("Export has not completed yet.", error),
        "404": response("Chunk missing.", error),
      },
    }),
  },
  "/api/v1/export/tasks/{id}/attachments/{attachmentId}": {
    get: secured({
      operationId: "getExportTaskAttachment",
      summary: "Download one attachment from an export",
      tags: ["ImportExport"],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        {
          name: "attachmentId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description: "Attachment bytes.",
          content: {
            "application/octet-stream": { schema: { type: "string" } },
          },
        },
        "404": response("Attachment missing.", error),
      },
    }),
  },
  "/api/v1/import/tasks": {
    post: secured({
      operationId: "createImportTask",
      summary: "Start a chunked import",
      tags: ["ImportExport"],
      requestBody: {
        required: true,
        content: json({ type: "object" }),
      },
      responses: {
        "202": response("Import task accepted.", { type: "object" }),
        "413": response("An attachment exceeds the upload budget.", error),
      },
    }),
  },
  "/api/v1/import/tasks/{id}/retry": {
    post: secured({
      operationId: "retryImportTask",
      summary: "Retry a failed import from its stored bundle",
      tags: ["ImportExport"],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        "202": response("Import task accepted.", { type: "object" }),
        "400": response("The task cannot be retried.", error),
        "404": response("Task not found.", error),
        "409": response("The task is not in a failed state.", error),
        "410": response("The stored bundle has expired.", error),
      },
    }),
  },
  "/api/v1/openapi.json": {
    get: {
      operationId: "getCurrentOpenApiDocument",
      summary: "This document",
      tags: ["MCP"],
      responses: {
        "200": response("OpenAPI document.", { type: "object" }),
        "401": response("Unauthenticated.", error),
      },
    },
  },
};

// "/mcp" follows the Connect RPC stubs in the assembled document, so it is a
// separate export spread last to preserve the original paths key order.
export const mcpPaths = {
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
};
