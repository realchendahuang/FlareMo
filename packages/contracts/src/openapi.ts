import { toJSONSchema, z } from "zod";
import {
  attachmentDtoSchema,
  bindMemoAttachmentsSchema,
  createMemoSchema,
  createShareSchema,
  importBundleSchema,
  importResultSchema,
  listAttachmentsResponseSchema,
  listMemoRelationsResponseSchema,
  listMemosResponseSchema,
  memoDtoSchema,
  patchMemoRelationsSchema,
  publicShareDtoSchema,
  shareDtoSchema,
  updateMemoSchema,
} from "./memos";

export const FLAREMO_API_VERSION = "0.1.4";

type JsonSchema = Record<string, unknown>;

type OpenApiOperation = {
  operationId: string;
  summary: string;
  tags: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
};

const jsonContent = (schema: JsonSchema) => ({
  "application/json": {
    schema,
  },
});

const jsonResponse = (description: string, schema: JsonSchema) => ({
  description,
  content: jsonContent(schema),
});

const binaryResponse = (description: string) => ({
  description,
  content: {
    "application/octet-stream": {
      schema: {
        type: "string",
        format: "binary",
      },
    },
  },
});

const jsonRequest = (schema: JsonSchema) => ({
  required: true,
  content: jsonContent(schema),
});

const multipartRequest = () => ({
  required: true,
  content: {
    "multipart/form-data": {
      schema: {
        type: "object",
        required: ["file"],
        properties: {
          file: {
            type: "string",
            format: "binary",
          },
          memo: {
            type: "string",
            description: "Optional memo resource name, for example memos/{id}.",
          },
        },
      },
    },
  },
});

const memoNameParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description:
    "Memo id or resource name. Both {id} and memos/{id} are accepted.",
};

const attachmentNameParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description:
    "Attachment id or resource name. Both {id} and attachments/{id} are accepted.",
};

const shareTokenParam = {
  name: "share_id",
  in: "path",
  required: true,
  schema: { type: "string" },
};

const listMemoParams = [
  {
    name: "page_size",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 100 },
  },
  { name: "page_token", in: "query", schema: { type: "string" } },
  { name: "order_by", in: "query", schema: { type: "string" } },
  {
    name: "state",
    in: "query",
    schema: {
      type: "string",
      enum: ["normal", "archived", "trashed", "deleted"],
    },
  },
  { name: "q", in: "query", schema: { type: "string" } },
  { name: "tag", in: "query", schema: { type: "string" } },
  { name: "include_deleted", in: "query", schema: { type: "boolean" } },
];

const schemas = {
  Attachment: toJSONSchema(attachmentDtoSchema) as JsonSchema,
  BindMemoAttachmentsRequest: toJSONSchema(
    bindMemoAttachmentsSchema,
  ) as JsonSchema,
  CreateMemoRequest: toJSONSchema(createMemoSchema) as JsonSchema,
  CreateShareRequest: toJSONSchema(createShareSchema) as JsonSchema,
  ImportBundle: toJSONSchema(importBundleSchema) as JsonSchema,
  ImportResult: toJSONSchema(importResultSchema) as JsonSchema,
  ListAttachmentsResponse: toJSONSchema(
    listAttachmentsResponseSchema,
  ) as JsonSchema,
  ListMemoRelationsResponse: toJSONSchema(
    listMemoRelationsResponseSchema,
  ) as JsonSchema,
  ListMemosResponse: toJSONSchema(listMemosResponseSchema) as JsonSchema,
  Memo: toJSONSchema(memoDtoSchema) as JsonSchema,
  PatchMemoRelationsRequest: toJSONSchema(
    patchMemoRelationsSchema,
  ) as JsonSchema,
  PublicShare: toJSONSchema(publicShareDtoSchema) as JsonSchema,
  Share: toJSONSchema(shareDtoSchema) as JsonSchema,
  UpdateMemoRequest: toJSONSchema(updateMemoSchema) as JsonSchema,
};

const operation = (input: OpenApiOperation) => input;

export function createOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "FlareMo Memos-compatible API",
      version: FLAREMO_API_VERSION,
      description:
        "Memos-compatible API for a Cloudflare-native personal knowledge management system. Production access is handled by Cloudflare Access.",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "Memos" },
      { name: "Attachments" },
      { name: "Relations" },
      { name: "Shares" },
      { name: "ImportExport" },
      { name: "MCP" },
    ],
    paths: {
      "/api/v1/memos": {
        get: operation({
          operationId: "listMemos",
          summary: "List memos",
          tags: ["Memos"],
          parameters: listMemoParams,
          responses: {
            "200": jsonResponse("Memo list.", schemas.ListMemosResponse),
          },
        }),
        post: operation({
          operationId: "createMemo",
          summary: "Create a memo",
          tags: ["Memos"],
          requestBody: jsonRequest(schemas.CreateMemoRequest),
          responses: { "201": jsonResponse("Created memo.", schemas.Memo) },
        }),
      },
      "/api/v1/memos/{id}": {
        get: operation({
          operationId: "getMemo",
          summary: "Get a memo",
          tags: ["Memos"],
          parameters: [memoNameParam],
          responses: { "200": jsonResponse("Memo.", schemas.Memo) },
        }),
        patch: operation({
          operationId: "updateMemo",
          summary: "Update a memo",
          tags: ["Memos"],
          parameters: [memoNameParam],
          requestBody: jsonRequest(schemas.UpdateMemoRequest),
          responses: { "200": jsonResponse("Updated memo.", schemas.Memo) },
        }),
        delete: operation({
          operationId: "deleteMemo",
          summary: "Move a memo to trash or hard-delete it",
          tags: ["Memos"],
          parameters: [
            memoNameParam,
            { name: "hard", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": jsonResponse(
              "Deleted memo or delete result.",
              toJSONSchema(z.unknown()) as JsonSchema,
            ),
          },
        }),
      },
      "/api/v1/memos/{id}/attachments": {
        get: operation({
          operationId: "listMemoAttachments",
          summary: "List memo attachments",
          tags: ["Attachments"],
          parameters: [memoNameParam],
          responses: {
            "200": jsonResponse(
              "Memo attachments.",
              schemas.ListAttachmentsResponse,
            ),
          },
        }),
        patch: operation({
          operationId: "setMemoAttachments",
          summary: "Bind attachments to a memo",
          tags: ["Attachments"],
          parameters: [memoNameParam],
          requestBody: jsonRequest(schemas.BindMemoAttachmentsRequest),
          responses: {
            "200": jsonResponse(
              "Bound attachments.",
              schemas.ListAttachmentsResponse,
            ),
          },
        }),
      },
      "/api/v1/memos/{id}/relations": {
        get: operation({
          operationId: "listMemoRelations",
          summary: "List memo relations",
          tags: ["Relations"],
          parameters: [memoNameParam],
          responses: {
            "200": jsonResponse(
              "Memo relations.",
              schemas.ListMemoRelationsResponse,
            ),
          },
        }),
        patch: operation({
          operationId: "setMemoRelations",
          summary: "Replace memo relations",
          tags: ["Relations"],
          parameters: [memoNameParam],
          requestBody: jsonRequest(schemas.PatchMemoRelationsRequest),
          responses: {
            "200": jsonResponse(
              "Memo relations.",
              schemas.ListMemoRelationsResponse,
            ),
          },
        }),
      },
      "/api/v1/memos/{id}/shares": {
        post: operation({
          operationId: "createMemoShare",
          summary: "Create a share token for a memo",
          tags: ["Shares"],
          parameters: [memoNameParam],
          requestBody: jsonRequest(schemas.CreateShareRequest),
          responses: { "201": jsonResponse("Share.", schemas.Share) },
        }),
      },
      "/api/v1/shares/{share_id}": {
        get: operation({
          operationId: "getShare",
          summary: "Get a share by token or id",
          tags: ["Shares"],
          parameters: [shareTokenParam],
          responses: { "200": jsonResponse("Share.", schemas.Share) },
        }),
      },
      "/api/public/shares/{token}": {
        get: operation({
          operationId: "getPublicShare",
          summary: "Get public share content by token",
          tags: ["Shares"],
          parameters: [
            {
              name: "token",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": jsonResponse("Public share content.", schemas.PublicShare),
          },
        }),
      },
      "/api/v1/attachments": {
        get: operation({
          operationId: "listAttachments",
          summary: "List attachments",
          tags: ["Attachments"],
          parameters: [
            { name: "memo", in: "query", schema: { type: "string" } },
            {
              name: "page_size",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100 },
            },
          ],
          responses: {
            "200": jsonResponse(
              "Attachments.",
              schemas.ListAttachmentsResponse,
            ),
          },
        }),
        post: operation({
          operationId: "uploadAttachment",
          summary: "Upload an attachment",
          tags: ["Attachments"],
          requestBody: multipartRequest(),
          responses: { "201": jsonResponse("Attachment.", schemas.Attachment) },
        }),
      },
      "/api/v1/attachments/{id}": {
        get: operation({
          operationId: "getAttachment",
          summary: "Get attachment metadata",
          tags: ["Attachments"],
          parameters: [attachmentNameParam],
          responses: { "200": jsonResponse("Attachment.", schemas.Attachment) },
        }),
        delete: operation({
          operationId: "deleteAttachment",
          summary: "Delete an attachment",
          tags: ["Attachments"],
          parameters: [attachmentNameParam],
          responses: {
            "200": jsonResponse(
              "Delete result.",
              toJSONSchema(z.object({ ok: z.literal(true) })) as JsonSchema,
            ),
          },
        }),
      },
      "/api/v1/attachments/{id}/blob": {
        get: operation({
          operationId: "downloadAttachment",
          summary: "Download attachment binary",
          tags: ["Attachments"],
          parameters: [attachmentNameParam],
          responses: { "200": binaryResponse("Attachment body.") },
        }),
      },
      "/api/v1/export": {
        get: operation({
          operationId: "exportData",
          summary: "Export FlareMo data",
          tags: ["ImportExport"],
          responses: {
            "200": jsonResponse("Export bundle.", schemas.ImportBundle),
          },
        }),
      },
      "/api/v1/import": {
        post: operation({
          operationId: "importData",
          summary: "Import FlareMo data",
          tags: ["ImportExport"],
          requestBody: jsonRequest(schemas.ImportBundle),
          responses: {
            "200": jsonResponse("Import result.", schemas.ImportResult),
          },
        }),
      },
      "/api/v1/mcp": {
        post: operation({
          operationId: "mcpJsonRpc",
          summary: "MCP JSON-RPC endpoint",
          tags: ["MCP"],
          requestBody: jsonRequest(
            toJSONSchema(z.record(z.string(), z.unknown())) as JsonSchema,
          ),
          responses: {
            "200": jsonResponse(
              "JSON-RPC response.",
              toJSONSchema(z.record(z.string(), z.unknown())) as JsonSchema,
            ),
          },
        }),
      },
      "/openapi.json": {
        get: operation({
          operationId: "getOpenApi",
          summary: "Get OpenAPI document",
          tags: ["ImportExport"],
          responses: {
            "200": jsonResponse(
              "OpenAPI document.",
              toJSONSchema(z.record(z.string(), z.unknown())) as JsonSchema,
            ),
          },
        }),
      },
    },
    components: {
      schemas,
    },
  };
}
