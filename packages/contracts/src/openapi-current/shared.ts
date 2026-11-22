type JsonSchema = Record<string, unknown>;

export const json = (schema: JsonSchema) => ({
  "application/json": { schema },
});

export const binaryMessage = {
  schema: { type: "string", format: "binary" },
};

export const connectContent = (schema: JsonSchema) => ({
  ...json(schema),
  "application/proto": binaryMessage,
  "application/grpc": binaryMessage,
  "application/grpc+proto": binaryMessage,
  "application/grpc-web": binaryMessage,
  "application/grpc-web+proto": binaryMessage,
  "application/grpc-web-text": binaryMessage,
  "application/grpc-web-text+proto": binaryMessage,
});

export const connectResponseContent = (schema: JsonSchema) => ({
  ...connectContent(schema),
});

export const response = (description: string, schema: JsonSchema) => ({
  description,
  content: json(schema),
});

export const emptyResponse = (description: string) => ({ description });

export const bearerSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];
export const optionalReadSecurity = [...bearerSecurity, {}];

export const memoName = {
  name: "memo",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "A memo resource name or memo id.",
};

export const attachmentName = {
  name: "attachment",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "An attachment resource name or attachment id.",
};

export const attachmentFilename = {
  name: "filename",
  in: "path",
  required: true,
  schema: { type: "string" },
  description:
    "The filename segment used by the official Memos Web URL; object lookup uses the attachment resource name.",
};

export const userName = {
  name: "user",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "The current user resource name, for example users/owner.",
};

export const currentMemo = {
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

export const memoRequest = {
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

export const attachment = {
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

export const attachmentRequest = {
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

export const currentUser = {
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

export const memoReaction = {
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

export const shortcut = {
  type: "object",
  required: ["name", "title"],
  properties: {
    name: { type: "string" },
    title: { type: "string" },
    filter: { type: "string" },
  },
};

export const error = {
  type: "object",
  required: ["code", "message", "details"],
  properties: {
    code: { type: "integer" },
    message: { type: "string" },
    details: { type: "array", items: { type: "object" } },
  },
};

export const secured = (input: Record<string, unknown>) => ({
  ...input,
  security: input.security ?? bearerSecurity,
});

export const connectOperation = (
  operationId: string,
  summary: string,
  security?: unknown[],
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
