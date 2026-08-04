/**
 * Memos protobuf transport codec.
 *
 * The message descriptors are generated from the pinned upstream Memos proto
 * snapshot in memos-generated/. The small hand-written codec below remains as
 * a compatibility fallback for FlareMo's historical GetSharedMemo alias and
 * for error/status framing; normal upstream request/response messages go
 * through the generated descriptor runtime so oneof, timestamps, enums,
 * repeated fields, and optional fields follow the upstream schema.
 */

import type { DescMessage, JsonValue } from "@bufbuild/protobuf";
import { fromBinary, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { AIService } from "./memos-generated/api/v1/ai_service_pb";
import { AttachmentService } from "./memos-generated/api/v1/attachment_service_pb";
import { AuthService } from "./memos-generated/api/v1/auth_service_pb";
import { IdentityProviderService } from "./memos-generated/api/v1/idp_service_pb";
import { InstanceService } from "./memos-generated/api/v1/instance_service_pb";
import { MemoService } from "./memos-generated/api/v1/memo_service_pb";
import { ShortcutService } from "./memos-generated/api/v1/shortcut_service_pb";
import { UserService } from "./memos-generated/api/v1/user_service_pb";

type GeneratedUnaryMethod = {
  input: DescMessage;
  output: DescMessage;
  methodKind: string;
};

type GeneratedService = {
  method: Record<string, GeneratedUnaryMethod>;
};

const generatedServices: Record<string, GeneratedService> = {
  "memos.api.v1.AIService": AIService,
  "memos.api.v1.AttachmentService": AttachmentService,
  "memos.api.v1.AuthService": AuthService,
  "memos.api.v1.IdentityProviderService": IdentityProviderService,
  "memos.api.v1.InstanceService": InstanceService,
  "memos.api.v1.MemoService": MemoService,
  "memos.api.v1.ShortcutService": ShortcutService,
  "memos.api.v1.UserService": UserService,
};

export type ProtoMessage = Record<string, unknown>;

export type BinaryTransport =
  | "connect-proto"
  | "grpc-proto"
  | "grpc-web-proto"
  | "grpc-web-text-proto";

/**
 * Normalize a handler response to the canonical protobuf-JSON shape.
 *
 * The domain handlers keep the historical oneof representation
 * (`{ case, value }`) internally. The generated runtime and upstream Memos
 * clients use the protobuf-JSON representation (`{ generalSetting: {...} }`).
 * Running the value through the generated descriptor makes the boundary
 * validate field names and apply the official enum, timestamp, int64, bytes,
 * and oneof rules for both JSON and binary transports.
 */
export function normalizeMemosJsonResponse(
  service: string,
  method: string,
  value: unknown,
): unknown {
  const descriptor = getGeneratedUnaryMethod(service, method);
  if (!descriptor) return toProtoJsonValue(value);

  try {
    const canonical = toCanonicalProtoJsonValue(value);
    // Validate through the generated schema, but return the canonical input
    // rather than toJson's default-omitting output. The existing FlareMo
    // Connect facade deliberately includes selected default-valued fields
    // such as `needsSetup: false`, and omitting them would be a needless
    // compatibility regression for JSON clients.
    fromJson(descriptor.output, canonical);
    return canonical;
  } catch (error) {
    throw new ProtoCodecError(
      `Failed to normalize generated protobuf JSON response for ${service}/${method}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function detectBinaryTransport(
  contentType: string,
): BinaryTransport | undefined {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/proto") return "connect-proto";
  // Native gRPC commonly uses application/grpc while gRPC-Web uses the
  // explicit +proto subtype. Memos uses protobuf as its wire codec, so both
  // media-type forms select the same unary protobuf framing.
  if (
    mediaType === "application/grpc" ||
    mediaType === "application/grpc+proto"
  ) {
    return "grpc-proto";
  }
  if (
    mediaType === "application/grpc-web" ||
    mediaType === "application/grpc-web+proto"
  ) {
    return "grpc-web-proto";
  }
  if (
    mediaType === "application/grpc-web-text" ||
    mediaType === "application/grpc-web-text+proto"
  ) {
    return "grpc-web-text-proto";
  }
  return undefined;
}

export function decodeBinaryRequest(
  service: string,
  method: string,
  input: Uint8Array,
  transport: BinaryTransport,
) {
  const payload =
    transport === "connect-proto"
      ? input
      : decodeGrpcUnaryFrame(
          transport === "grpc-web-text-proto" ? decodeBase64(input) : input,
        );
  return decodeRequestMessage(service, method, payload);
}

export function encodeBinaryResponse(
  service: string,
  method: string,
  value: unknown,
  transport: BinaryTransport,
): Uint8Array | string {
  const payload = encodeResponseMessage(service, method, value);
  if (transport === "connect-proto") return payload;
  const framed =
    transport === "grpc-web-proto" || transport === "grpc-web-text-proto"
      ? encodeGrpcWebResponse(payload, 0)
      : encodeGrpcUnaryFrame(payload);
  return transport === "grpc-web-text-proto" ? encodeBase64(framed) : framed;
}

export function encodeBinaryError(
  message: string,
  transport: BinaryTransport,
  code = 3,
) {
  // google.rpc.Status: code=1, message=2. The HTTP status and transport
  // headers remain authoritative for Connect/gRPC clients, but the body must
  // carry the same status code instead of always pretending every failure is
  // INVALID_ARGUMENT.
  const status = new ProtoWriter().int32(1, code).string(2, message).finish();
  if (transport === "connect-proto") return status;
  // gRPC-Web application errors are carried in a trailers-only frame. A
  // protobuf google.rpc.Status data frame would be interpreted as a normal
  // response message by generated browser clients.
  const framed =
    transport === "grpc-web-proto" || transport === "grpc-web-text-proto"
      ? encodeGrpcWebTrailerFrame(code, message)
      : encodeGrpcUnaryFrame(status);
  return transport === "grpc-web-text-proto" ? encodeBase64(framed) : framed;
}

/**
 * Decode a unary response with the same wire framing rules used by the
 * Worker. This is intentionally exported for contract tests and local
 * compatibility probes; request handlers never need to decode their own
 * response. Keeping the inverse here makes binary tests assert message
 * fields, rather than only checking that a response contains some text.
 */
export function decodeBinaryResponse(
  service: string,
  method: string,
  input: Uint8Array,
  transport: BinaryTransport,
): ProtoMessage {
  const payload =
    transport === "connect-proto"
      ? input
      : transport === "grpc-web-proto" || transport === "grpc-web-text-proto"
        ? decodeGrpcWebUnaryResponse(
            transport === "grpc-web-text-proto" ? decodeBase64(input) : input,
          )
        : decodeGrpcUnaryFrame(input);
  return decodeResponseMessage(service, method, payload);
}

function decodeResponseMessage(
  service: string,
  method: string,
  payload: Uint8Array,
): ProtoMessage {
  const generated = decodeGeneratedMessage(service, method, payload, "output");
  if (generated) return generated;

  const reader = new ProtoReader(payload);
  if (service === "memos.api.v1.MemoService") {
    switch (method) {
      case "CreateMemo":
      case "GetMemo":
      case "UpdateMemo":
      case "CreateMemoComment":
      case "GetSharedMemo":
      case "GetMemoByShare":
        return decodeMemo(reader);
      case "ListMemos":
      case "ListMemoComments":
        return decodeListResponse(reader, "memos", decodeMemo, {
          totalSize: method === "ListMemoComments",
        });
      case "ListMemoAttachments":
        return decodeListResponse(reader, "attachments", decodeAttachment);
      case "ListMemoRelations":
        return decodeListResponse(reader, "relations", decodeRelation);
      case "ListMemoReactions":
        return decodeListResponse(reader, "reactions", decodeReaction, {
          totalSize: true,
        });
      case "ListMemoShares":
        return decodeListResponse(reader, "memoShares", decodeMemoShare);
      case "BatchGetLinkMetadata":
        return decodeListResponse(reader, "linkMetadata", decodeLinkMetadata);
      case "CreateMemoShare":
        return decodeMemoShare(reader);
      case "GetLinkMetadata":
        return decodeLinkMetadata(reader);
      default:
        return {};
    }
  }
  if (service === "memos.api.v1.AuthService") {
    const response: ProtoMessage = {};
    while (!reader.done) {
      const [field, wire] = reader.tag();
      if (method === "GetCurrentUser" && field === 1) {
        response.user = decodeUser(reader.message(wire));
      } else if (method === "SignIn" && field === 1) {
        response.user = decodeUser(reader.message(wire));
      } else if (method === "SignIn" && field === 2) {
        response.accessToken = reader.string(wire);
      } else if (method === "SignIn" && field === 3) {
        response.accessTokenExpiresAt = decodeTimestamp(reader.message(wire));
      } else if (method === "RefreshToken" && field === 1) {
        response.accessToken = reader.string(wire);
      } else if (method === "RefreshToken" && field === 2) {
        response.expiresAt = decodeTimestamp(reader.message(wire));
      } else {
        reader.skip(wire);
      }
    }
    return response;
  }
  if (service === "memos.api.v1.ShortcutService") {
    if (method === "ListShortcuts") {
      return decodeListResponse(reader, "shortcuts", decodeShortcut);
    }
    if (method === "DeleteShortcut") return {};
    return decodeShortcut(reader);
  }
  if (service === "memos.api.v1.AttachmentService") {
    if (method === "ListAttachments") {
      return decodeListResponse(reader, "attachments", decodeAttachment, {
        totalSize: true,
      });
    }
    if (method === "DeleteAttachment" || method === "BatchDeleteAttachments") {
      return {};
    }
    return decodeAttachment(reader);
  }
  if (service === "memos.api.v1.UserService") {
    switch (method) {
      case "GetUser":
      case "CreateUser":
      case "UpdateUser":
        return decodeUser(reader);
      case "ListUsers":
      case "BatchGetUsers":
        return decodeListResponse(reader, "users", decodeUser, {
          totalSize: true,
        });
      case "ListAllUserStats":
        return decodeListResponse(reader, "stats", decodeUserStats);
      case "GetUserStats":
        return decodeUserStats(reader);
      case "GetUserSetting":
      case "UpdateUserSetting":
        return decodeUserSetting(reader);
      case "ListUserSettings":
        return decodeListResponse(reader, "settings", decodeUserSetting, {
          totalSize: true,
        });
      case "ListLinkedIdentities":
        return decodeListResponse(
          reader,
          "linkedIdentities",
          decodeLinkedIdentity,
        );
      case "GetLinkedIdentity":
      case "CreateLinkedIdentity":
        return decodeLinkedIdentity(reader);
      case "ListPersonalAccessTokens":
        return decodeListResponse(
          reader,
          "personalAccessTokens",
          decodePersonalAccessToken,
          { totalSize: true },
        );
      case "CreatePersonalAccessToken": {
        const response: ProtoMessage = {};
        while (!reader.done) {
          const [field, wire] = reader.tag();
          if (field === 1)
            response.personalAccessToken = decodePersonalAccessToken(
              reader.message(wire),
            );
          else if (field === 2) response.token = reader.string(wire);
          else reader.skip(wire);
        }
        return response;
      }
      case "ListUserWebhooks":
        return decodeListResponse(reader, "webhooks", decodeWebhook);
      case "CreateUserWebhook":
      case "UpdateUserWebhook":
        return decodeWebhook(reader);
      case "GetUserWebhookSigningSecret": {
        const response: ProtoMessage = {};
        while (!reader.done) {
          const [field, wire] = reader.tag();
          if (field === 1) response.signingSecret = reader.string(wire);
          else reader.skip(wire);
        }
        return response;
      }
      case "ListUserNotifications":
        return decodeListResponse(reader, "notifications", decodeNotification);
      case "UpdateUserNotification":
        return decodeNotification(reader);
      default:
        return {};
    }
  }
  if (service === "memos.api.v1.InstanceService") {
    if (method === "GetInstanceProfile") return decodeInstanceProfile(reader);
    if (method === "GetInstanceSetting" || method === "UpdateInstanceSetting") {
      return decodeInstanceSetting(reader);
    }
    if (method === "BatchGetInstanceSettings") {
      return decodeListResponse(reader, "settings", decodeInstanceSetting);
    }
    if (method === "GetInstanceStats") return decodeInstanceStats(reader);
    return {};
  }
  if (service === "memos.api.v1.IdentityProviderService") {
    if (method === "ListIdentityProviders") {
      return decodeListResponse(
        reader,
        "identityProviders",
        decodeIdentityProvider,
      );
    }
    if (
      method === "GetIdentityProvider" ||
      method === "CreateIdentityProvider"
    ) {
      return decodeIdentityProvider(reader);
    }
    return {};
  }
  if (service === "memos.api.v1.AIService" && method === "Transcribe") {
    const response: ProtoMessage = {};
    while (!reader.done) {
      const [field, wire] = reader.tag();
      if (field === 1) response.text = reader.string(wire);
      else reader.skip(wire);
    }
    return response;
  }
  throw new ProtoCodecError(`Unsupported protobuf service: ${service}`);
}

function getGeneratedUnaryMethod(
  service: string,
  method: string,
): GeneratedUnaryMethod | undefined {
  const serviceDescriptor = generatedServices[service];
  if (!serviceDescriptor) return undefined;
  const localName = method.charAt(0).toLowerCase() + method.slice(1);
  const descriptor = serviceDescriptor.method[localName];
  return descriptor?.methodKind === "unary" ? descriptor : undefined;
}

function decodeGeneratedMessage(
  service: string,
  method: string,
  payload: Uint8Array,
  direction: "input" | "output",
): ProtoMessage | undefined {
  const descriptor = getGeneratedUnaryMethod(service, method);
  if (!descriptor) return undefined;

  try {
    const message = fromBinary(
      direction === "input" ? descriptor.input : descriptor.output,
      payload,
    );
    const json = toJson(
      direction === "input" ? descriptor.input : descriptor.output,
      message,
    );
    if (!isProtoMessage(json)) {
      throw new Error("generated protobuf JSON value is not an object");
    }
    return json;
  } catch (error) {
    throw new ProtoCodecError(
      `Failed to decode generated protobuf ${direction} for ${service}/${method}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function encodeGeneratedResponse(
  service: string,
  method: string,
  value: unknown,
): Uint8Array | undefined {
  const descriptor = getGeneratedUnaryMethod(service, method);
  if (!descriptor) return undefined;

  try {
    const message = fromJson(
      descriptor.output,
      toCanonicalProtoJsonValue(value),
    );
    return toBinary(descriptor.output, message);
  } catch (error) {
    throw new ProtoCodecError(
      `Failed to encode generated protobuf response for ${service}/${method}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function toProtoJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return encodeBase64(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toProtoJsonValue(item));
  }
  if (typeof value === "object") {
    const object: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) object[key] = toProtoJsonValue(item);
    }
    return object;
  }
  return null;
}

function toCanonicalProtoJsonValue(value: unknown): JsonValue {
  return canonicalizeLegacyOneof(toProtoJsonValue(value));
}

function canonicalizeLegacyOneof(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeLegacyOneof(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, JsonValue>;
    if (
      typeof record.case === "string" &&
      record.case.length > 0 &&
      Object.hasOwn(record, "value")
    ) {
      return {
        [record.case]: canonicalizeLegacyOneof(record.value ?? null),
      };
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(record)) {
      if (
        key === "value" &&
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        typeof (item as Record<string, JsonValue>).case === "string" &&
        Object.hasOwn(item, "value")
      ) {
        const oneof = item as Record<string, JsonValue>;
        result[oneof.case as string] = canonicalizeLegacyOneof(
          oneof.value ?? null,
        );
        continue;
      }
      result[key] = canonicalizeLegacyOneof(item);
    }
    return result;
  }
  return value;
}

function isProtoMessage(value: unknown): value is ProtoMessage {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function decodeListResponse(
  reader: ProtoReader,
  itemKey: string,
  decoder: (reader: ProtoReader) => ProtoMessage,
  options: { totalSize?: boolean } = {},
) {
  const response: ProtoMessage = { [itemKey]: [] };
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) {
      const values = response[itemKey];
      if (!Array.isArray(values)) response[itemKey] = [];
      (response[itemKey] as ProtoMessage[]).push(decoder(reader.message(wire)));
    } else if (field === 2) {
      response.nextPageToken = reader.string(wire);
    } else if (field === 3 && options.totalSize) {
      response.totalSize = reader.int32(wire);
    } else {
      reader.skip(wire);
    }
  }
  return response;
}

function decodeRequestMessage(
  service: string,
  method: string,
  payload: Uint8Array,
): ProtoMessage {
  const generated = decodeGeneratedMessage(service, method, payload, "input");
  if (generated) return generated;

  if (service === "memos.api.v1.MemoService") {
    return decodeMemoServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.AuthService") {
    return decodeAuthServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.ShortcutService") {
    return decodeShortcutServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.AttachmentService") {
    return decodeAttachmentServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.UserService") {
    return decodeUserServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.InstanceService") {
    return decodeInstanceServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.IdentityProviderService") {
    return decodeIdentityProviderServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.AIService") {
    return decodeAiServiceRequest(method, payload);
  }
  throw new ProtoCodecError(`Unsupported protobuf service: ${service}`);
}

function encodeResponseMessage(
  service: string,
  method: string,
  value: unknown,
): Uint8Array {
  const generated = encodeGeneratedResponse(service, method, value);
  if (generated) return generated;

  const body = asRecord(value);
  if (service === "memos.api.v1.MemoService") {
    switch (method) {
      case "CreateMemo":
      case "GetMemo":
      case "UpdateMemo":
      case "CreateMemoComment":
      case "GetSharedMemo":
      case "GetMemoByShare":
        return encodeMemo(body);
      case "ListMemos":
        return encodeList(body.memos, encodeMemo, body.nextPageToken);
      case "ListMemoComments":
        return encodeList(
          body.memos,
          encodeMemo,
          body.nextPageToken,
          body.totalSize,
        );
      case "ListMemoAttachments":
        return encodeList(
          body.attachments,
          encodeAttachment,
          body.nextPageToken,
        );
      case "ListMemoRelations":
        return encodeList(body.relations, encodeRelation, body.nextPageToken);
      case "ListMemoReactions":
        return encodeList(
          body.reactions,
          encodeReaction,
          body.nextPageToken,
          body.totalSize,
        );
      case "UpsertMemoReaction":
        return encodeReaction(body);
      case "ListMemoShares":
        return encodeList(body.memoShares, encodeMemoShare);
      case "BatchGetLinkMetadata":
        return encodeList(body.linkMetadata, encodeLinkMetadata);
      case "CreateMemoShare":
        return encodeMemoShare(body);
      case "GetLinkMetadata":
        return encodeLinkMetadata(body);
      case "DeleteMemo":
      case "SetMemoAttachments":
      case "SetMemoRelations":
      case "DeleteMemoReaction":
      case "DeleteMemoShare":
        return new Uint8Array();
      default:
        throw new ProtoCodecError(`Unsupported protobuf method: ${method}`);
    }
  }
  if (service === "memos.api.v1.AuthService") {
    switch (method) {
      case "GetCurrentUser":
        return new ProtoWriter().message(1, encodeUser(body.user)).finish();
      case "SignIn":
        return new ProtoWriter()
          .message(1, encodeUser(body.user))
          .string(2, stringValue(body.accessToken))
          .message(3, encodeTimestamp(body.accessTokenExpiresAt))
          .finish();
      case "RefreshToken":
        return new ProtoWriter()
          .string(1, stringValue(body.accessToken))
          .message(2, encodeTimestamp(body.expiresAt))
          .finish();
      case "SignOut":
        return new Uint8Array();
      default:
        throw new ProtoCodecError(`Unsupported protobuf method: ${method}`);
    }
  }
  if (service === "memos.api.v1.ShortcutService") {
    switch (method) {
      case "ListShortcuts":
        return encodeList(body.shortcuts, encodeShortcut);
      case "GetShortcut":
      case "CreateShortcut":
      case "UpdateShortcut":
        return encodeShortcut(body);
      case "DeleteShortcut":
        return new Uint8Array();
      default:
        throw new ProtoCodecError(`Unsupported protobuf method: ${method}`);
    }
  }
  if (service === "memos.api.v1.AttachmentService") {
    switch (method) {
      case "CreateAttachment":
      case "GetAttachment":
      case "UpdateAttachment":
        return encodeAttachment(body);
      case "ListAttachments":
        return encodeList(
          body.attachments,
          encodeAttachment,
          body.nextPageToken,
          body.totalSize,
        );
      case "DeleteAttachment":
      case "BatchDeleteAttachments":
        return new Uint8Array();
      default:
        throw new ProtoCodecError(`Unsupported protobuf method: ${method}`);
    }
  }
  if (service === "memos.api.v1.UserService") {
    switch (method) {
      case "GetUser":
      case "CreateUser":
      case "UpdateUser":
        return encodeUser(body);
      case "ListUsers":
      case "BatchGetUsers":
        return encodeList(
          body.users,
          encodeUser,
          body.nextPageToken,
          body.totalSize,
        );
      case "ListAllUserStats":
        return encodeList(body.stats, encodeUserStats);
      case "GetUserStats":
        return encodeUserStats(body);
      case "GetUserSetting":
      case "UpdateUserSetting":
        return encodeUserSetting(body);
      case "ListUserSettings":
        return encodeList(
          body.settings,
          encodeUserSetting,
          body.nextPageToken,
          body.totalSize,
        );
      case "ListLinkedIdentities":
        return encodeList(body.linkedIdentities, encodeLinkedIdentity);
      case "GetLinkedIdentity":
      case "CreateLinkedIdentity":
        return encodeLinkedIdentity(body);
      case "ListPersonalAccessTokens":
        return encodeList(
          body.personalAccessTokens,
          encodePersonalAccessToken,
          body.nextPageToken,
          body.totalSize,
        );
      case "CreatePersonalAccessToken":
        return new ProtoWriter()
          .message(1, encodePersonalAccessToken(body.personalAccessToken))
          .string(2, stringValue(body.token))
          .finish();
      case "ListUserWebhooks":
        return encodeList(body.webhooks, encodeWebhook);
      case "CreateUserWebhook":
      case "UpdateUserWebhook":
        return encodeWebhook(body);
      case "GetUserWebhookSigningSecret":
        return new ProtoWriter()
          .string(1, stringValue(body.signingSecret))
          .finish();
      case "ListUserNotifications":
        return encodeList(
          body.notifications,
          encodeNotification,
          body.nextPageToken,
        );
      case "UpdateUserNotification":
        return encodeNotification(body);
      case "DeleteUser":
      case "DeleteLinkedIdentity":
      case "DeletePersonalAccessToken":
      case "DeleteUserWebhook":
      case "DeleteUserNotification":
        return new Uint8Array();
      default:
        throw new ProtoCodecError(`Unsupported protobuf method: ${method}`);
    }
  }
  if (service === "memos.api.v1.InstanceService") {
    switch (method) {
      case "GetInstanceProfile":
        return encodeInstanceProfile(body);
      case "GetInstanceSetting":
      case "UpdateInstanceSetting":
        return encodeInstanceSetting(body);
      case "BatchGetInstanceSettings":
        return encodeList(body.settings, encodeInstanceSetting);
      case "GetInstanceStats":
        return encodeInstanceStats(body);
      case "TestInstanceEmailSetting":
        return new Uint8Array();
      default:
        throw new ProtoCodecError(`Unsupported protobuf method: ${method}`);
    }
  }
  if (service === "memos.api.v1.IdentityProviderService") {
    switch (method) {
      case "ListIdentityProviders":
        return encodeList(body.identityProviders, encodeIdentityProvider);
      case "GetIdentityProvider":
      case "CreateIdentityProvider":
      case "UpdateIdentityProvider":
        return encodeIdentityProvider(body);
      case "DeleteIdentityProvider":
        return new Uint8Array();
      default:
        throw new ProtoCodecError(`Unsupported protobuf method: ${method}`);
    }
  }
  if (service === "memos.api.v1.AIService") {
    if (method === "Transcribe") {
      return new ProtoWriter().string(1, stringValue(body.text)).finish();
    }
    throw new ProtoCodecError(`Unsupported protobuf method: ${method}`);
  }
  throw new ProtoCodecError(`Unsupported protobuf service: ${service}`);
}

function decodeMemoServiceRequest(method: string, bytes: Uint8Array) {
  const reader = new ProtoReader(bytes);
  const body: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    switch (method) {
      case "CreateMemo":
        if (field === 1) body.memo = decodeMemo(reader.message(wire));
        else if (field === 2) body.memoId = reader.string(wire);
        else reader.skip(wire);
        break;
      case "ListMemos":
        decodeListMemosField(body, field, wire, reader);
        break;
      case "GetMemo":
      case "DeleteMemo":
      case "ListMemoAttachments":
      case "ListMemoRelations":
      case "ListMemoComments":
      case "ListMemoReactions":
      case "DeleteMemoShare":
        decodeNameAndPagingField(body, field, wire, reader, method);
        break;
      case "UpdateMemo":
        if (field === 1) body.memo = decodeMemo(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else reader.skip(wire);
        break;
      case "SetMemoAttachments":
        if (field === 1) body.name = reader.string(wire);
        else if (field === 2)
          push(body, "attachments", decodeAttachment(reader.message(wire)));
        else reader.skip(wire);
        break;
      case "SetMemoRelations":
        if (field === 1) body.name = reader.string(wire);
        else if (field === 2)
          push(body, "relations", decodeRelation(reader.message(wire)));
        else reader.skip(wire);
        break;
      case "CreateMemoComment":
        if (field === 1) body.name = reader.string(wire);
        else if (field === 2) body.comment = decodeMemo(reader.message(wire));
        else if (field === 3) body.commentId = reader.string(wire);
        else reader.skip(wire);
        break;
      case "UpsertMemoReaction":
        if (field === 1) body.name = reader.string(wire);
        else if (field === 2)
          body.reaction = decodeReaction(reader.message(wire));
        else reader.skip(wire);
        break;
      case "DeleteMemoReaction":
        if (field === 1) body.name = reader.string(wire);
        else reader.skip(wire);
        break;
      case "CreateMemoShare":
        if (field === 1) body.parent = reader.string(wire);
        else if (field === 2)
          body.memoShare = decodeMemoShare(reader.message(wire));
        else reader.skip(wire);
        break;
      case "ListMemoShares":
        if (field === 1) body.parent = reader.string(wire);
        else reader.skip(wire);
        break;
      case "GetSharedMemo":
      case "GetMemoByShare":
        if (field === 1)
          body[method === "GetMemoByShare" ? "shareId" : "shareToken"] =
            reader.string(wire);
        else reader.skip(wire);
        break;
      case "GetLinkMetadata":
        if (field === 1) body.url = reader.string(wire);
        else reader.skip(wire);
        break;
      case "BatchGetLinkMetadata":
        if (field === 1) push(body, "urls", reader.string(wire));
        else reader.skip(wire);
        break;
      default:
        reader.skip(wire);
    }
  }
  return body;
}

function decodeAuthServiceRequest(method: string, bytes: Uint8Array) {
  if (method !== "SignIn") return {};
  const reader = new ProtoReader(bytes);
  const body: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) {
      const credentials = decodePasswordCredentials(reader.message(wire));
      body.passwordCredentials = credentials;
    } else {
      reader.skip(wire);
    }
  }
  return body;
}

function decodeShortcutServiceRequest(method: string, bytes: Uint8Array) {
  const reader = new ProtoReader(bytes);
  const body: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    switch (method) {
      case "ListShortcuts":
        if (field === 1) body.parent = reader.string(wire);
        else reader.skip(wire);
        break;
      case "GetShortcut":
      case "DeleteShortcut":
        if (field === 1) body.name = reader.string(wire);
        else reader.skip(wire);
        break;
      case "CreateShortcut":
        if (field === 1) body.parent = reader.string(wire);
        else if (field === 2)
          body.shortcut = decodeShortcut(reader.message(wire));
        else if (field === 3) body.validateOnly = reader.bool(wire);
        else reader.skip(wire);
        break;
      case "UpdateShortcut":
        if (field === 1) body.shortcut = decodeShortcut(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else reader.skip(wire);
        break;
      default:
        reader.skip(wire);
    }
  }
  return body;
}

function decodeAttachmentServiceRequest(method: string, bytes: Uint8Array) {
  const reader = new ProtoReader(bytes);
  const body: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    switch (method) {
      case "CreateAttachment":
        if (field === 1)
          body.attachment = decodeAttachment(reader.message(wire));
        else if (field === 2) body.attachmentId = reader.string(wire);
        else reader.skip(wire);
        break;
      case "ListAttachments":
        if (field === 1) body.pageSize = reader.int32(wire);
        else if (field === 2) body.pageToken = reader.string(wire);
        else if (field === 3) body.filter = reader.string(wire);
        else if (field === 4) body.orderBy = reader.string(wire);
        else reader.skip(wire);
        break;
      case "GetAttachment":
      case "DeleteAttachment":
        if (field === 1) body.name = reader.string(wire);
        else reader.skip(wire);
        break;
      case "UpdateAttachment":
        if (field === 1)
          body.attachment = decodeAttachment(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else reader.skip(wire);
        break;
      case "BatchDeleteAttachments":
        if (field === 1) push(body, "names", reader.string(wire));
        else reader.skip(wire);
        break;
      default:
        reader.skip(wire);
    }
  }
  return body;
}

function decodeUserServiceRequest(method: string, bytes: Uint8Array) {
  const reader = new ProtoReader(bytes);
  const body: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    switch (method) {
      case "ListUsers":
        if (field === 1) body.pageSize = reader.int32(wire);
        else if (field === 2) body.pageToken = reader.string(wire);
        else if (field === 3) body.filter = reader.string(wire);
        else if (field === 4) body.showDeleted = reader.bool(wire);
        else reader.skip(wire);
        break;
      case "BatchGetUsers":
        if (field === 1) push(body, "usernames", reader.string(wire));
        else reader.skip(wire);
        break;
      case "GetUser":
      case "GetUserStats":
      case "GetUserSetting":
      case "GetLinkedIdentity":
      case "DeleteUser":
      case "DeleteLinkedIdentity":
      case "DeletePersonalAccessToken":
      case "DeleteUserWebhook":
      case "GetUserWebhookSigningSecret":
      case "DeleteUserNotification":
        if (field === 1) body.name = reader.string(wire);
        else if (field === 2 && method === "GetUser")
          body.readMask = decodeFieldMask(reader.message(wire));
        else if (field === 2 && method === "DeleteUser")
          body.force = reader.bool(wire);
        else reader.skip(wire);
        break;
      case "CreateUser":
        if (field === 1) body.user = decodeUser(reader.message(wire));
        else if (field === 2) body.userId = reader.string(wire);
        else if (field === 3) body.validateOnly = reader.bool(wire);
        else if (field === 4) body.requestId = reader.string(wire);
        else reader.skip(wire);
        break;
      case "UpdateUser":
        if (field === 1) body.user = decodeUser(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else if (field === 3) body.allowMissing = reader.bool(wire);
        else reader.skip(wire);
        break;
      case "ListAllUserStats":
        if (field === 1) body.state = stateName(reader.int32(wire));
        else if (field === 2) body.filter = reader.string(wire);
        else reader.skip(wire);
        break;
      case "ListUserSettings":
      case "ListLinkedIdentities":
      case "ListPersonalAccessTokens":
      case "ListUserWebhooks":
      case "ListUserNotifications":
        if (field === 1) body.parent = reader.string(wire);
        else if (field === 2 && method !== "ListUserWebhooks")
          body.pageSize = reader.int32(wire);
        else if (field === 3 && method !== "ListUserWebhooks")
          body.pageToken = reader.string(wire);
        else if (field === 4 && method === "ListUserNotifications")
          body.filter = reader.string(wire);
        else reader.skip(wire);
        break;
      case "UpdateUserSetting":
        if (field === 1) body.setting = decodeUserSetting(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else reader.skip(wire);
        break;
      case "CreateLinkedIdentity":
        if (field === 1) body.parent = reader.string(wire);
        else if (field === 2) body.idpName = reader.string(wire);
        else if (field === 3) body.code = reader.string(wire);
        else if (field === 4) body.redirectUri = reader.string(wire);
        else if (field === 5) body.codeVerifier = reader.string(wire);
        else reader.skip(wire);
        break;
      case "CreatePersonalAccessToken":
        if (field === 1) body.parent = reader.string(wire);
        else if (field === 2) body.description = reader.string(wire);
        else if (field === 3) body.expiresInDays = reader.int32(wire);
        else reader.skip(wire);
        break;
      case "CreateUserWebhook":
        if (field === 1) body.parent = reader.string(wire);
        else if (field === 2)
          body.webhook = decodeWebhook(reader.message(wire));
        else reader.skip(wire);
        break;
      case "UpdateUserWebhook":
        if (field === 1) body.webhook = decodeWebhook(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else reader.skip(wire);
        break;
      case "UpdateUserNotification":
        if (field === 1)
          body.notification = decodeNotification(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else reader.skip(wire);
        break;
      default:
        reader.skip(wire);
    }
  }
  return body;
}

function decodeInstanceServiceRequest(method: string, bytes: Uint8Array) {
  const reader = new ProtoReader(bytes);
  const body: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    switch (method) {
      case "GetInstanceSetting":
        if (field === 1) body.name = reader.string(wire);
        else reader.skip(wire);
        break;
      case "BatchGetInstanceSettings":
        if (field === 1) push(body, "names", reader.string(wire));
        else reader.skip(wire);
        break;
      case "UpdateInstanceSetting":
        if (field === 1)
          body.setting = decodeInstanceSetting(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else reader.skip(wire);
        break;
      case "TestInstanceEmailSetting":
        if (field === 1) body.email = decodeEmailSetting(reader.message(wire));
        else if (field === 2) body.recipientEmail = reader.string(wire);
        else reader.skip(wire);
        break;
      default:
        reader.skip(wire);
    }
  }
  return body;
}

function decodeIdentityProviderServiceRequest(
  method: string,
  bytes: Uint8Array,
) {
  const reader = new ProtoReader(bytes);
  const body: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    switch (method) {
      case "GetIdentityProvider":
      case "DeleteIdentityProvider":
        if (field === 1) body.name = reader.string(wire);
        else reader.skip(wire);
        break;
      case "CreateIdentityProvider":
        if (field === 1)
          body.identityProvider = decodeIdentityProvider(reader.message(wire));
        else if (field === 2) body.identityProviderId = reader.string(wire);
        else reader.skip(wire);
        break;
      case "UpdateIdentityProvider":
        if (field === 1)
          body.identityProvider = decodeIdentityProvider(reader.message(wire));
        else if (field === 2)
          body.updateMask = decodeFieldMask(reader.message(wire));
        else reader.skip(wire);
        break;
      default:
        reader.skip(wire);
    }
  }
  return body;
}

function decodeAiServiceRequest(method: string, bytes: Uint8Array) {
  const reader = new ProtoReader(bytes);
  const body: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (method === "Transcribe" && field === 1) {
      body.audio = decodeTranscriptionAudio(reader.message(wire));
    } else {
      reader.skip(wire);
    }
  }
  return body;
}

function decodeListMemosField(
  body: ProtoMessage,
  field: number,
  wire: number,
  reader: ProtoReader,
) {
  if (field === 1) body.pageSize = reader.int32(wire);
  else if (field === 2) body.pageToken = reader.string(wire);
  else if (field === 3) body.state = stateName(reader.int32(wire));
  else if (field === 4) body.orderBy = reader.string(wire);
  else if (field === 5) body.filter = reader.string(wire);
  else if (field === 6) body.showDeleted = reader.bool(wire);
  else reader.skip(wire);
}

function decodeNameAndPagingField(
  body: ProtoMessage,
  field: number,
  wire: number,
  reader: ProtoReader,
  method: string,
) {
  if (field === 1)
    body[method === "ListMemoShares" ? "parent" : "name"] = reader.string(wire);
  else if (field === 2 && method !== "GetMemo" && method !== "DeleteMemo") {
    body.pageSize = reader.int32(wire);
  } else if (
    field === 3 &&
    [
      "ListMemoAttachments",
      "ListMemoRelations",
      "ListMemoComments",
      "ListMemoReactions",
    ].includes(method)
  ) {
    body.pageToken = reader.string(wire);
  } else if (field === 4 && method === "ListMemoComments") {
    body.orderBy = reader.string(wire);
  } else if (field === 2 && method === "DeleteMemo") {
    body.force = reader.bool(wire);
  } else {
    reader.skip(wire);
  }
}

function decodeMemo(reader: ProtoReader): ProtoMessage {
  const memo: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    switch (field) {
      case 1:
        memo.name = reader.string(wire);
        break;
      case 2:
        memo.state = stateName(reader.int32(wire));
        break;
      case 7:
        memo.content = reader.string(wire);
        break;
      case 9:
        memo.visibility = visibilityName(reader.int32(wire));
        break;
      case 10:
        push(bodyOrMemo(memo), "tags", reader.string(wire));
        break;
      case 11:
        memo.pinned = reader.bool(wire);
        break;
      case 12:
        push(memo, "attachments", decodeAttachment(reader.message(wire)));
        break;
      case 13:
        push(memo, "relations", decodeRelation(reader.message(wire)));
        break;
      case 15:
        memo.property = decodeProperty(reader.message(wire));
        break;
      case 18:
        memo.location = decodeLocation(reader.message(wire));
        break;
      default:
        reader.skip(wire);
    }
  }
  return memo;
}

function bodyOrMemo(memo: ProtoMessage) {
  return memo;
}

function decodeAttachment(reader: ProtoReader): ProtoMessage {
  const attachment: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) attachment.name = reader.string(wire);
    else if (field === 2)
      attachment.createTime = decodeTimestamp(reader.message(wire));
    else if (field === 3) attachment.filename = reader.string(wire);
    else if (field === 4) attachment.content = reader.bytesValue(wire);
    else if (field === 5) attachment.externalLink = reader.string(wire);
    else if (field === 6) attachment.type = reader.string(wire);
    else if (field === 7) attachment.size = reader.int64(wire);
    else if (field === 8) attachment.memo = reader.string(wire);
    else reader.skip(wire);
  }
  return attachment;
}

function decodeUser(reader: ProtoReader): ProtoMessage {
  const user: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) user.name = reader.string(wire);
    else if (field === 2) user.role = userRoleName(reader.int32(wire));
    else if (field === 3) user.username = reader.string(wire);
    else if (field === 4) user.email = reader.string(wire);
    else if (field === 5) user.displayName = reader.string(wire);
    else if (field === 6) user.avatarUrl = reader.string(wire);
    else if (field === 7) user.description = reader.string(wire);
    else if (field === 8) user.password = reader.string(wire);
    else if (field === 9) user.state = stateName(reader.int32(wire));
    else if (field === 10)
      user.createTime = decodeTimestamp(reader.message(wire));
    else if (field === 11)
      user.updateTime = decodeTimestamp(reader.message(wire));
    else reader.skip(wire);
  }
  return user;
}

function decodeUserSetting(reader: ProtoReader): ProtoMessage {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) setting.name = reader.string(wire);
    else if (field === 2)
      setting.value = {
        case: "generalSetting",
        value: decodeUserGeneralSetting(reader.message(wire)),
      };
    else if (field === 5)
      setting.value = {
        case: "webhooksSetting",
        value: decodeWebhooksSetting(reader.message(wire)),
      };
    else if (field === 6)
      setting.value = {
        case: "tagsSetting",
        value: decodeTagsSetting(reader.message(wire)),
      };
    else reader.skip(wire);
  }
  return setting;
}

function decodeUserGeneralSetting(reader: ProtoReader) {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) setting.locale = reader.string(wire);
    else if (field === 3) setting.memoVisibility = reader.string(wire);
    else if (field === 4) setting.theme = reader.string(wire);
    else reader.skip(wire);
  }
  return setting;
}

function decodeWebhooksSetting(reader: ProtoReader) {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1)
      push(setting, "webhooks", decodeWebhook(reader.message(wire)));
    else reader.skip(wire);
  }
  return setting;
}

function decodeTagsSetting(reader: ProtoReader) {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) reader.skip(wire);
    else reader.skip(wire);
  }
  return setting;
}

function decodeWebhook(reader: ProtoReader): ProtoMessage {
  const webhook: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) webhook.name = reader.string(wire);
    else if (field === 2) webhook.url = reader.string(wire);
    else if (field === 3) webhook.displayName = reader.string(wire);
    else if (field === 4)
      webhook.createTime = decodeTimestamp(reader.message(wire));
    else if (field === 5)
      webhook.updateTime = decodeTimestamp(reader.message(wire));
    else if (field === 6) webhook.signingSecret = reader.string(wire);
    else if (field === 7) webhook.signingSecretSet = reader.bool(wire);
    else reader.skip(wire);
  }
  return webhook;
}

function decodeNotification(reader: ProtoReader): ProtoMessage {
  const notification: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) notification.name = reader.string(wire);
    else if (field === 2) notification.sender = reader.string(wire);
    else if (field === 3)
      notification.status = notificationStatusName(reader.int32(wire));
    else if (field === 4)
      notification.createTime = decodeTimestamp(reader.message(wire));
    else if (field === 5)
      notification.type = notificationTypeName(reader.int32(wire));
    else if (field === 6)
      notification.payload = {
        case: "memoComment",
        value: decodeNotificationPayload(reader.message(wire)),
      };
    else if (field === 7)
      notification.payload = {
        case: "memoMention",
        value: decodeNotificationPayload(reader.message(wire)),
      };
    else if (field === 8)
      notification.senderUser = decodeUser(reader.message(wire));
    else reader.skip(wire);
  }
  return notification;
}

function decodeNotificationPayload(reader: ProtoReader): ProtoMessage {
  const payload: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) payload.memo = reader.string(wire);
    else if (field === 2) payload.relatedMemo = reader.string(wire);
    else if (field === 3) payload.memoSnippet = reader.string(wire);
    else if (field === 4) payload.relatedMemoSnippet = reader.string(wire);
    else reader.skip(wire);
  }
  return payload;
}

function decodeInstanceSetting(reader: ProtoReader): ProtoMessage {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) setting.name = reader.string(wire);
    else if (field === 2)
      setting.value = {
        case: "generalSetting",
        value: decodeInstanceGeneralSetting(reader.message(wire)),
      };
    else if (field === 4)
      setting.value = {
        case: "memoRelatedSetting",
        value: decodeMemoRelatedSetting(reader.message(wire)),
      };
    else if (field === 6)
      setting.value = {
        case: "notificationSetting",
        value: decodeNotificationSetting(reader.message(wire)),
      };
    else reader.skip(wire);
  }
  return setting;
}

function decodeInstanceGeneralSetting(reader: ProtoReader) {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 2) setting.disallowUserRegistration = reader.bool(wire);
    else if (field === 3) setting.disallowPasswordAuth = reader.bool(wire);
    else if (field === 4) setting.additionalScript = reader.string(wire);
    else if (field === 5) setting.additionalStyle = reader.string(wire);
    else if (field === 7) setting.weekStartDayOffset = reader.int32(wire);
    else if (field === 8) setting.disallowChangeUsername = reader.bool(wire);
    else if (field === 9) setting.disallowChangeNickname = reader.bool(wire);
    else reader.skip(wire);
  }
  return setting;
}

function decodeMemoRelatedSetting(reader: ProtoReader) {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 3) setting.contentLengthLimit = reader.int32(wire);
    else if (field === 4) setting.enableDoubleClickEdit = reader.bool(wire);
    else if (field === 7) push(setting, "reactions", reader.string(wire));
    else reader.skip(wire);
  }
  return setting;
}

function decodeNotificationSetting(reader: ProtoReader) {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) setting.email = decodeEmailSetting(reader.message(wire));
    else reader.skip(wire);
  }
  return setting;
}

function decodeEmailSetting(reader: ProtoReader) {
  const setting: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) setting.enabled = reader.bool(wire);
    else if (field === 2) setting.smtpHost = reader.string(wire);
    else if (field === 3) setting.smtpPort = reader.int32(wire);
    else if (field === 4) setting.smtpUsername = reader.string(wire);
    else if (field === 5) setting.smtpPassword = reader.string(wire);
    else if (field === 6) setting.fromEmail = reader.string(wire);
    else if (field === 7) setting.fromName = reader.string(wire);
    else if (field === 8) setting.replyTo = reader.string(wire);
    else if (field === 9) setting.useTls = reader.bool(wire);
    else if (field === 10) setting.useSsl = reader.bool(wire);
    else reader.skip(wire);
  }
  return setting;
}

function decodeIdentityProvider(reader: ProtoReader): ProtoMessage {
  const provider: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) provider.name = reader.string(wire);
    else if (field === 2)
      provider.type = reader.int32(wire) === 1 ? "OAUTH2" : "TYPE_UNSPECIFIED";
    else if (field === 3) provider.title = reader.string(wire);
    else if (field === 4) provider.identifierFilter = reader.string(wire);
    else if (field === 5)
      provider.config = decodeIdentityProviderConfig(reader.message(wire));
    else reader.skip(wire);
  }
  return provider;
}

function decodeIdentityProviderConfig(reader: ProtoReader) {
  const config: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1)
      config.config = {
        case: "oauth2Config",
        value: decodeOAuth2Config(reader.message(wire)),
      };
    else reader.skip(wire);
  }
  return config;
}

function decodeOAuth2Config(reader: ProtoReader) {
  const config: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) config.clientId = reader.string(wire);
    else if (field === 2) config.clientSecret = reader.string(wire);
    else if (field === 3) config.authUrl = reader.string(wire);
    else if (field === 4) config.tokenUrl = reader.string(wire);
    else if (field === 5) config.userInfoUrl = reader.string(wire);
    else if (field === 6) push(config, "scopes", reader.string(wire));
    else if (field === 7)
      config.fieldMapping = decodeFieldMapping(reader.message(wire));
    else reader.skip(wire);
  }
  return config;
}

function decodeFieldMapping(reader: ProtoReader) {
  const mapping: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) mapping.identifier = reader.string(wire);
    else if (field === 2) mapping.displayName = reader.string(wire);
    else if (field === 3) mapping.email = reader.string(wire);
    else if (field === 4) mapping.avatarUrl = reader.string(wire);
    else reader.skip(wire);
  }
  return mapping;
}

function decodeTranscriptionAudio(reader: ProtoReader) {
  const audio: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) audio.content = reader.bytesValue(wire);
    else if (field === 2) audio.uri = reader.string(wire);
    else if (field === 3) audio.filename = reader.string(wire);
    else if (field === 4) audio.contentType = reader.string(wire);
    else reader.skip(wire);
  }
  return audio;
}

function decodePersonalAccessToken(reader: ProtoReader): ProtoMessage {
  const token: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) token.name = reader.string(wire);
    else if (field === 2) token.description = reader.string(wire);
    else if (field === 3)
      token.createdAt = decodeTimestamp(reader.message(wire));
    else if (field === 4)
      token.expiresAt = decodeTimestamp(reader.message(wire));
    else if (field === 5)
      token.lastUsedAt = decodeTimestamp(reader.message(wire));
    else reader.skip(wire);
  }
  return token;
}

function decodeLinkedIdentity(reader: ProtoReader): ProtoMessage {
  const identity: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) identity.name = reader.string(wire);
    else if (field === 2) identity.idpName = reader.string(wire);
    else if (field === 3) identity.externUid = reader.string(wire);
    else reader.skip(wire);
  }
  return identity;
}

function decodeUserStats(reader: ProtoReader): ProtoMessage {
  const stats: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) stats.name = reader.string(wire);
    else if (field === 3)
      stats.memoTypeStats = decodeMemoTypeStats(reader.message(wire));
    else if (field === 4) {
      const entry = decodeStringInt32Entry(reader.message(wire));
      const tagCount = asRecord(stats.tagCount);
      tagCount[entry.key] = entry.value;
      stats.tagCount = tagCount;
    } else if (field === 5) push(stats, "pinnedMemos", reader.string(wire));
    else if (field === 6) stats.totalMemoCount = reader.int32(wire);
    else if (field === 7)
      push(
        stats,
        "memoCreatedTimestamps",
        decodeTimestamp(reader.message(wire)),
      );
    else if (field === 8)
      push(
        stats,
        "memoUpdatedTimestamps",
        decodeTimestamp(reader.message(wire)),
      );
    else reader.skip(wire);
  }
  return stats;
}

function decodeMemoTypeStats(reader: ProtoReader): ProtoMessage {
  const stats: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) stats.linkCount = reader.int32(wire);
    else if (field === 2) stats.codeCount = reader.int32(wire);
    else if (field === 3) stats.todoCount = reader.int32(wire);
    else if (field === 4) stats.undoCount = reader.int32(wire);
    else reader.skip(wire);
  }
  return stats;
}

function decodeStringInt32Entry(reader: ProtoReader) {
  let key = "";
  let value = 0;
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) key = reader.string(wire);
    else if (field === 2) value = reader.int32(wire);
    else reader.skip(wire);
  }
  return { key, value };
}

function decodeInstanceProfile(reader: ProtoReader): ProtoMessage {
  const profile: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 2) profile.version = reader.string(wire);
    else if (field === 3) profile.demo = reader.bool(wire);
    else if (field === 6) profile.instanceUrl = reader.string(wire);
    else if (field === 7) profile.admin = decodeUser(reader.message(wire));
    else if (field === 8) profile.commit = reader.string(wire);
    else if (field === 9) profile.needsSetup = reader.bool(wire);
    else reader.skip(wire);
  }
  return profile;
}

function decodeInstanceStats(reader: ProtoReader): ProtoMessage {
  const stats: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) stats.database = decodeDatabaseStats(reader.message(wire));
    else if (field === 2) stats.localStorageBytes = reader.int64(wire);
    else if (field === 4)
      stats.generatedTime = decodeTimestamp(reader.message(wire));
    else reader.skip(wire);
  }
  return stats;
}

function decodeDatabaseStats(reader: ProtoReader): ProtoMessage {
  const stats: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) stats.driver = reader.string(wire);
    else if (field === 2) stats.sizeBytes = reader.int64(wire);
    else reader.skip(wire);
  }
  return stats;
}

function decodeRelation(reader: ProtoReader): ProtoMessage {
  const relation: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) relation.memo = decodeRelationMemo(reader.message(wire));
    else if (field === 2)
      relation.relatedMemo = decodeRelationMemo(reader.message(wire));
    else if (field === 3) relation.type = relationTypeName(reader.int32(wire));
    else reader.skip(wire);
  }
  return relation;
}

function decodeRelationMemo(reader: ProtoReader): ProtoMessage {
  const value: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) value.name = reader.string(wire);
    else if (field === 2) value.snippet = reader.string(wire);
    else reader.skip(wire);
  }
  return value;
}

function decodeReaction(reader: ProtoReader): ProtoMessage {
  const reaction: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) reaction.name = reader.string(wire);
    else if (field === 2) reaction.creator = reader.string(wire);
    else if (field === 3) reaction.contentId = reader.string(wire);
    else if (field === 4) reaction.reactionType = reader.string(wire);
    else if (field === 5)
      reaction.createTime = decodeTimestamp(reader.message(wire));
    else reader.skip(wire);
  }
  return reaction;
}

function decodeMemoShare(reader: ProtoReader): ProtoMessage {
  const share: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) share.name = reader.string(wire);
    else if (field === 2)
      share.createTime = decodeTimestamp(reader.message(wire));
    else if (field === 3)
      share.expireTime = decodeTimestamp(reader.message(wire));
    else reader.skip(wire);
  }
  return share;
}

function decodeLinkMetadata(reader: ProtoReader): ProtoMessage {
  const metadata: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) metadata.url = reader.string(wire);
    else if (field === 2) metadata.title = reader.string(wire);
    else if (field === 3) metadata.description = reader.string(wire);
    else if (field === 4) metadata.image = reader.string(wire);
    else reader.skip(wire);
  }
  return metadata;
}

function decodeProperty(reader: ProtoReader) {
  const property: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) property.has_link = reader.bool(wire);
    else if (field === 2) property.has_task_list = reader.bool(wire);
    else if (field === 3) property.has_code = reader.bool(wire);
    else if (field === 4) property.has_incomplete_tasks = reader.bool(wire);
    else if (field === 5) property.title = reader.string(wire);
    else reader.skip(wire);
  }
  return property;
}

function decodeLocation(reader: ProtoReader) {
  const location: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) location.placeholder = reader.string(wire);
    else if (field === 2) location.latitude = reader.double(wire);
    else if (field === 3) location.longitude = reader.double(wire);
    else reader.skip(wire);
  }
  return location;
}

function decodeShortcut(reader: ProtoReader) {
  const shortcut: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) shortcut.name = reader.string(wire);
    else if (field === 2) shortcut.title = reader.string(wire);
    else if (field === 3) shortcut.filter = reader.string(wire);
    else reader.skip(wire);
  }
  return shortcut;
}

function decodePasswordCredentials(reader: ProtoReader) {
  const credentials: ProtoMessage = {};
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) credentials.username = reader.string(wire);
    else if (field === 2) credentials.password = reader.string(wire);
    else reader.skip(wire);
  }
  return credentials;
}

function decodeFieldMask(reader: ProtoReader) {
  const paths: string[] = [];
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) paths.push(reader.string(wire));
    else reader.skip(wire);
  }
  return paths.join(",");
}

function decodeTimestamp(reader: ProtoReader) {
  let seconds = 0n;
  let nanos = 0;
  while (!reader.done) {
    const [field, wire] = reader.tag();
    if (field === 1) seconds = reader.varint(wire);
    else if (field === 2) nanos = reader.int32(wire);
    else reader.skip(wire);
  }
  return new Date(
    Number(seconds) * 1_000 + Math.trunc(nanos / 1_000_000),
  ).toISOString();
}

function encodeMemo(value: unknown) {
  const memo = asRecord(value);
  const writer = new ProtoWriter()
    .string(1, stringValue(memo.name))
    .int32(2, stateValue(memo.state))
    .string(3, stringValue(memo.creator))
    .message(4, encodeTimestamp(memo.createTime))
    .message(5, encodeTimestamp(memo.updateTime))
    .string(7, stringValue(memo.content))
    .int32(9, visibilityValue(memo.visibility))
    .repeatedStrings(10, strings(memo.tags))
    .bool(11, memo.pinned === true)
    .repeatedMessages(12, records(memo.attachments), encodeAttachment)
    .repeatedMessages(13, records(memo.relations), encodeRelation)
    .repeatedMessages(14, records(memo.reactions), encodeReaction)
    .message(15, encodeProperty(memo.property))
    .string(16, stringValue(memo.parent))
    .string(17, stringValue(memo.snippet))
    .message(18, encodeLocation(memo.location));
  return writer.finish();
}

function encodeAttachment(value: unknown) {
  const attachment = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(attachment.name))
    .message(2, encodeTimestamp(attachment.createTime))
    .string(3, stringValue(attachment.filename))
    .string(6, stringValue(attachment.type))
    .int64(7, attachment.size)
    .string(8, stringValue(attachment.memo))
    .finish();
}

function encodeUserStats(value: unknown) {
  const stats = asRecord(value);
  const memoTypeStats = asRecord(stats.memoTypeStats);
  return new ProtoWriter()
    .string(1, stringValue(stats.name))
    .message(
      3,
      new ProtoWriter()
        .int32(1, numberValue(memoTypeStats.linkCount))
        .int32(2, numberValue(memoTypeStats.codeCount))
        .int32(3, numberValue(memoTypeStats.todoCount))
        .int32(4, numberValue(memoTypeStats.undoCount))
        .finish(),
    )
    .mapStringInt32(4, asRecord(stats.tagCount))
    .repeatedMessages(7, records(stats.memoCreatedTimestamps), encodeTimestamp)
    .repeatedMessages(8, records(stats.memoUpdatedTimestamps), encodeTimestamp)
    .repeatedStrings(5, strings(stats.pinnedMemos))
    .int32(6, numberValue(stats.totalMemoCount))
    .finish();
}

function encodeUserSetting(value: unknown) {
  const setting = asRecord(value);
  const oneof = asRecord(setting.value);
  const nested = asRecord(oneof.value);
  const writer = new ProtoWriter().string(1, stringValue(setting.name));
  if (oneof.case === "generalSetting") {
    writer.message(
      2,
      new ProtoWriter()
        .string(1, stringValue(nested.locale))
        .string(3, stringValue(nested.memoVisibility))
        .string(4, stringValue(nested.theme))
        .finish(),
    );
  } else if (oneof.case === "webhooksSetting") {
    writer.message(
      5,
      new ProtoWriter()
        .repeatedMessages(1, records(nested.webhooks), encodeWebhook)
        .finish(),
    );
  }
  return writer.finish();
}

function encodeLinkedIdentity(value: unknown) {
  const identity = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(identity.name))
    .string(2, stringValue(identity.idpName))
    .string(3, stringValue(identity.externUid))
    .finish();
}

function encodePersonalAccessToken(value: unknown) {
  const token = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(token.name))
    .string(2, stringValue(token.description))
    .message(3, encodeTimestamp(token.createdAt))
    .message(4, encodeTimestamp(token.expiresAt))
    .message(5, encodeTimestamp(token.lastUsedAt))
    .finish();
}

function encodeWebhook(value: unknown) {
  const webhook = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(webhook.name))
    .string(2, stringValue(webhook.url))
    .string(3, stringValue(webhook.displayName))
    .message(4, encodeTimestamp(webhook.createTime))
    .message(5, encodeTimestamp(webhook.updateTime))
    .bool(7, webhook.signingSecretSet === true)
    .finish();
}

function encodeNotification(value: unknown) {
  const notification = asRecord(value);
  const writer = new ProtoWriter()
    .string(1, stringValue(notification.name))
    .string(2, stringValue(notification.sender))
    .int32(3, notificationStatusValue(notification.status))
    .message(4, encodeTimestamp(notification.createTime))
    .int32(5, notificationTypeValue(notification.type));
  const payload = asRecord(notification.payload);
  const oneof =
    payload.case === "memoComment" || payload.case === "memoMention"
      ? payload
      : Object.hasOwn(notification, "memoComment")
        ? { case: "memoComment", value: notification.memoComment }
        : Object.hasOwn(notification, "memoMention")
          ? { case: "memoMention", value: notification.memoMention }
          : payload;
  if (oneof.case === "memoComment") {
    writer.message(6, encodeNotificationPayload(oneof.value));
  } else if (oneof.case === "memoMention") {
    writer.message(7, encodeNotificationPayload(oneof.value));
  }
  return writer.message(8, encodeUser(notification.senderUser)).finish();
}

function encodeNotificationPayload(value: unknown) {
  const payload = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(payload.memo))
    .string(2, stringValue(payload.relatedMemo))
    .string(3, stringValue(payload.memoSnippet))
    .string(4, stringValue(payload.relatedMemoSnippet))
    .finish();
}

function encodeInstanceProfile(value: unknown) {
  const profile = asRecord(value);
  return new ProtoWriter()
    .string(2, stringValue(profile.version))
    .bool(3, profile.demo === true)
    .string(6, stringValue(profile.instanceUrl))
    .message(7, encodeUser(profile.admin))
    .string(8, stringValue(profile.commit))
    .bool(9, profile.needsSetup === true)
    .finish();
}

function encodeInstanceSetting(value: unknown) {
  const setting = asRecord(value);
  const oneof = asRecord(setting.value);
  const nested = asRecord(oneof.value);
  const writer = new ProtoWriter().string(1, stringValue(setting.name));
  if (oneof.case === "generalSetting") {
    writer.message(
      2,
      new ProtoWriter()
        .bool(2, nested.disallowUserRegistration === true)
        .bool(3, nested.disallowPasswordAuth === true)
        .string(4, stringValue(nested.additionalScript))
        .string(5, stringValue(nested.additionalStyle))
        .int32(7, numberValue(nested.weekStartDayOffset))
        .bool(8, nested.disallowChangeUsername === true)
        .bool(9, nested.disallowChangeNickname === true)
        .finish(),
    );
  } else if (oneof.case === "memoRelatedSetting") {
    writer.message(
      4,
      new ProtoWriter()
        .int32(3, numberValue(nested.contentLengthLimit))
        .bool(4, nested.enableDoubleClickEdit === true)
        .repeatedStrings(7, strings(nested.reactions))
        .finish(),
    );
  } else if (oneof.case === "notificationSetting") {
    writer.message(
      6,
      new ProtoWriter().message(1, encodeEmailSetting(nested.email)).finish(),
    );
  }
  return writer.finish();
}

function encodeEmailSetting(value: unknown) {
  const setting = asRecord(value);
  return new ProtoWriter()
    .bool(1, setting.enabled === true)
    .string(2, stringValue(setting.smtpHost))
    .int32(3, numberValue(setting.smtpPort))
    .string(4, stringValue(setting.smtpUsername))
    .string(6, stringValue(setting.fromEmail))
    .string(7, stringValue(setting.fromName))
    .string(8, stringValue(setting.replyTo))
    .bool(9, setting.useTls === true)
    .bool(10, setting.useSsl === true)
    .finish();
}

function encodeInstanceStats(value: unknown) {
  const stats = asRecord(value);
  const database = asRecord(stats.database);
  return new ProtoWriter()
    .message(
      1,
      new ProtoWriter()
        .string(1, stringValue(database.driver))
        .int64(2, database.sizeBytes)
        .finish(),
    )
    .int64(2, stats.localStorageBytes)
    .message(4, encodeTimestamp(stats.generatedTime))
    .finish();
}

function encodeIdentityProvider(value: unknown) {
  const provider = asRecord(value);
  const config = asRecord(provider.config);
  const oauth = asRecord(config.config).value;
  const oauthConfig = asRecord(oauth);
  const configCase = asRecord(config.config).case;
  const writer = new ProtoWriter()
    .string(1, stringValue(provider.name))
    .int32(2, provider.type === "OAUTH2" ? 1 : 0)
    .string(3, stringValue(provider.title))
    .string(4, stringValue(provider.identifierFilter));
  if (configCase === "oauth2Config") {
    writer.message(
      5,
      new ProtoWriter()
        .message(
          1,
          new ProtoWriter()
            .string(1, stringValue(oauthConfig.clientId))
            .string(2, stringValue(oauthConfig.clientSecret))
            .string(3, stringValue(oauthConfig.authUrl))
            .string(4, stringValue(oauthConfig.tokenUrl))
            .string(5, stringValue(oauthConfig.userInfoUrl))
            .repeatedStrings(6, strings(oauthConfig.scopes))
            .message(7, encodeFieldMapping(oauthConfig.fieldMapping))
            .finish(),
        )
        .finish(),
    );
  }
  return writer.finish();
}

function encodeFieldMapping(value: unknown) {
  const mapping = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(mapping.identifier))
    .string(2, stringValue(mapping.displayName))
    .string(3, stringValue(mapping.email))
    .string(4, stringValue(mapping.avatarUrl))
    .finish();
}

function encodeRelation(value: unknown) {
  const relation = asRecord(value);
  return new ProtoWriter()
    .message(1, encodeRelationMemo(relation.memo))
    .message(2, encodeRelationMemo(relation.relatedMemo))
    .int32(3, relationTypeValue(relation.type))
    .finish();
}

function encodeRelationMemo(value: unknown) {
  const memo = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(memo.name))
    .string(2, stringValue(memo.snippet))
    .finish();
}

function encodeReaction(value: unknown) {
  const reaction = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(reaction.name))
    .string(2, stringValue(reaction.creator))
    .string(3, stringValue(reaction.contentId))
    .string(4, stringValue(reaction.reactionType))
    .message(5, encodeTimestamp(reaction.createTime))
    .finish();
}

function encodeMemoShare(value: unknown) {
  const share = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(share.name))
    .message(2, encodeTimestamp(share.createTime))
    .message(3, encodeTimestamp(share.expireTime))
    .finish();
}

function encodeLinkMetadata(value: unknown) {
  const metadata = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(metadata.url))
    .string(2, stringValue(metadata.title))
    .string(3, stringValue(metadata.description))
    .string(4, stringValue(metadata.image))
    .finish();
}

function encodeProperty(value: unknown) {
  const property = asRecord(value);
  return new ProtoWriter()
    .bool(1, property.hasLink === true || property.has_link === true)
    .bool(2, property.hasTaskList === true || property.has_task_list === true)
    .bool(3, property.hasCode === true || property.has_code === true)
    .bool(
      4,
      property.hasIncompleteTasks === true ||
        property.has_incomplete_tasks === true,
    )
    .string(5, stringValue(property.title))
    .finish();
}

function encodeLocation(value: unknown) {
  const location = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(location.placeholder))
    .double(2, numberValue(location.latitude))
    .double(3, numberValue(location.longitude))
    .finish();
}

function encodeShortcut(value: unknown) {
  const shortcut = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(shortcut.name))
    .string(2, stringValue(shortcut.title))
    .string(3, stringValue(shortcut.filter))
    .finish();
}

function encodeUser(value: unknown) {
  const user = asRecord(value);
  return new ProtoWriter()
    .string(1, stringValue(user.name))
    .int32(2, user.role === "ADMIN" ? 2 : 3)
    .string(3, stringValue(user.username))
    .string(4, stringValue(user.email))
    .string(5, stringValue(user.displayName))
    .string(6, stringValue(user.avatarUrl))
    .int32(9, user.state === "NORMAL" ? 1 : 0)
    .message(10, encodeTimestamp(user.createTime))
    .message(11, encodeTimestamp(user.updateTime))
    .finish();
}

function encodeTimestamp(value: unknown) {
  const date = value instanceof Date ? value : new Date(stringValue(value));
  if (Number.isNaN(date.getTime())) return new Uint8Array();
  const milliseconds = date.getTime();
  const seconds = Math.floor(milliseconds / 1_000);
  const nanos = (milliseconds - seconds * 1_000) * 1_000_000;
  return new ProtoWriter().int64(1, seconds).int32(2, nanos).finish();
}

function encodeList(
  value: unknown,
  encoder: (value: unknown) => Uint8Array,
  nextPageToken?: unknown,
  totalSize?: unknown,
) {
  return new ProtoWriter()
    .repeatedMessages(1, records(value), encoder)
    .string(2, stringValue(nextPageToken))
    .int32(3, numberValue(totalSize))
    .finish();
}

function stateName(value: number) {
  if (value === 1) return "NORMAL";
  if (value === 2) return "ARCHIVED";
  return "STATE_UNSPECIFIED";
}

function stateValue(value: unknown) {
  if (value === "NORMAL") return 1;
  if (value === "ARCHIVED") return 2;
  return 0;
}

function visibilityName(value: number) {
  if (value === 1) return "PRIVATE";
  if (value === 2) return "PROTECTED";
  if (value === 3) return "PUBLIC";
  return "VISIBILITY_UNSPECIFIED";
}

function visibilityValue(value: unknown) {
  if (value === "PRIVATE") return 1;
  if (value === "PROTECTED") return 2;
  if (value === "PUBLIC") return 3;
  return 0;
}

function userRoleName(value: number) {
  if (value === 2) return "ADMIN";
  if (value === 3) return "USER";
  return "ROLE_UNSPECIFIED";
}

function notificationStatusName(value: number) {
  if (value === 1) return "UNREAD";
  if (value === 2) return "ARCHIVED";
  return "STATUS_UNSPECIFIED";
}

function notificationStatusValue(value: unknown) {
  if (value === "UNREAD") return 1;
  if (value === "ARCHIVED") return 2;
  return 0;
}

function notificationTypeName(value: number) {
  if (value === 1) return "MEMO_COMMENT";
  if (value === 2) return "MEMO_MENTION";
  return "TYPE_UNSPECIFIED";
}

function notificationTypeValue(value: unknown) {
  if (value === "MEMO_COMMENT") return 1;
  if (value === "MEMO_MENTION") return 2;
  return 0;
}

function relationTypeName(value: number) {
  if (value === 1) return "REFERENCE";
  if (value === 2) return "COMMENT";
  return "TYPE_UNSPECIFIED";
}

function relationTypeValue(value: unknown) {
  if (value === "REFERENCE") return 1;
  if (value === "COMMENT") return 2;
  return 0;
}

function push(record: ProtoMessage, key: string, value: unknown) {
  const values = Array.isArray(record[key]) ? (record[key] as unknown[]) : [];
  values.push(value);
  record[key] = values;
}

function asRecord(value: unknown): ProtoMessage {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ProtoMessage)
    : {};
}

function records(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

class ProtoWriter {
  private readonly chunks: Uint8Array[] = [];

  string(field: number, value: string) {
    if (!value) return this;
    return this.bytes(field, new TextEncoder().encode(value));
  }

  bytes(field: number, value: Uint8Array) {
    this.tag(field, 2);
    this.varint(value.length);
    this.chunks.push(value);
    return this;
  }

  message(field: number, value: Uint8Array) {
    if (value.length === 0) return this;
    return this.bytes(field, value);
  }

  repeatedStrings(field: number, values: string[]) {
    for (const value of values) this.string(field, value);
    return this;
  }

  repeatedMessages(
    field: number,
    values: unknown[],
    encoder: (value: unknown) => Uint8Array,
  ) {
    for (const value of values) this.message(field, encoder(value));
    return this;
  }

  bool(field: number, value: boolean) {
    if (!value) return this;
    this.tag(field, 0);
    this.varint(value ? 1 : 0);
    return this;
  }

  int32(field: number, value: number | undefined) {
    if (value === undefined || !Number.isFinite(value) || value === 0)
      return this;
    this.tag(field, 0);
    this.varint(Math.trunc(value));
    return this;
  }

  mapStringInt32(field: number, value: ProtoMessage) {
    for (const [key, rawValue] of Object.entries(value)) {
      const parsed = typeof rawValue === "number" ? rawValue : Number(rawValue);
      if (!Number.isFinite(parsed)) continue;
      this.message(
        field,
        new ProtoWriter().string(1, key).int32(2, parsed).finish(),
      );
    }
    return this;
  }

  int64(field: number, value: unknown) {
    let parsed: bigint;
    try {
      if (typeof value === "bigint") parsed = value;
      else if (typeof value === "number" && Number.isFinite(value))
        parsed = BigInt(Math.trunc(value));
      else if (typeof value === "string" && value) parsed = BigInt(value);
      else return this;
    } catch {
      return this;
    }
    if (parsed === 0n) return this;
    this.tag(field, 0);
    this.varint(parsed);
    return this;
  }

  double(field: number, value: number | undefined) {
    if (value === undefined) return this;
    this.tag(field, 1);
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    this.chunks.push(bytes);
    return this;
  }

  finish() {
    const length = this.chunks.reduce(
      (total, chunk) => total + chunk.length,
      0,
    );
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }

  private tag(field: number, wire: number) {
    this.varint((field << 3) | wire);
  }

  private varint(value: bigint | number) {
    let current = typeof value === "bigint" ? value : BigInt(value);
    if (current < 0n) current = BigInt.asUintN(64, current);
    while (current > 127n) {
      this.chunks.push(Uint8Array.of(Number((current & 127n) | 128n)));
      current >>= 7n;
    }
    this.chunks.push(Uint8Array.of(Number(current)));
  }
}

class ProtoReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get done() {
    return this.offset >= this.bytes.length;
  }

  tag(): [number, number] {
    const value = this.varint(0);
    return [Number(value >> 3n), Number(value & 7n)];
  }

  varint(wire: number) {
    if (wire !== 0) throw new ProtoCodecError("Expected protobuf varint");
    let value = 0n;
    let shift = 0n;
    while (this.offset < this.bytes.length) {
      const byte = this.bytes[this.offset++] ?? 0;
      value |= BigInt(byte & 127) << shift;
      if ((byte & 128) === 0) return value;
      shift += 7n;
      if (shift > 63n) throw new ProtoCodecError("Protobuf varint is too long");
    }
    throw new ProtoCodecError("Truncated protobuf varint");
  }

  int32(wire: number) {
    return Number(this.varint(wire));
  }

  int64(wire: number) {
    return this.varint(wire).toString();
  }

  bool(wire: number) {
    return this.varint(wire) !== 0n;
  }

  string(wire: number) {
    return new TextDecoder().decode(this.bytesValue(wire));
  }

  double(wire: number) {
    if (wire !== 1 || this.offset + 8 > this.bytes.length) {
      throw new ProtoCodecError("Expected protobuf double");
    }
    const value = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      8,
    ).getFloat64(0, true);
    this.offset += 8;
    return value;
  }

  bytesValue(wire: number) {
    if (wire !== 2) throw new ProtoCodecError("Expected protobuf bytes");
    const length = Number(this.varint(0));
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.offset + length > this.bytes.length
    ) {
      throw new ProtoCodecError("Invalid protobuf length-delimited field");
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  message(wire: number) {
    return new ProtoReader(this.bytesValue(wire));
  }

  skip(wire: number) {
    if (wire === 0) this.varint(wire);
    else if (wire === 1) this.offset += 8;
    else if (wire === 2) this.offset += Number(this.varint(wire));
    else if (wire === 5) this.offset += 4;
    else throw new ProtoCodecError(`Unsupported protobuf wire type: ${wire}`);
    if (this.offset > this.bytes.length)
      throw new ProtoCodecError("Truncated protobuf field");
  }
}

export class ProtoCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtoCodecError";
  }
}

function decodeGrpcUnaryFrame(input: Uint8Array) {
  if (input.length < 5) throw new ProtoCodecError("Truncated gRPC frame");
  const flags = input[0] ?? 255;
  if (flags !== 0)
    throw new ProtoCodecError("Compressed gRPC frames are unsupported");
  const length = new DataView(
    input.buffer,
    input.byteOffset,
    input.byteLength,
  ).getUint32(1);
  if (length !== input.length - 5)
    throw new ProtoCodecError("Expected one unary gRPC frame");
  return input.subarray(5);
}

function encodeGrpcUnaryFrame(payload: Uint8Array) {
  const frame = new Uint8Array(payload.length + 5);
  frame[0] = 0;
  new DataView(frame.buffer).setUint32(1, payload.length);
  frame.set(payload, 5);
  return frame;
}

function decodeGrpcWebUnaryResponse(input: Uint8Array) {
  let offset = 0;
  let data: Uint8Array | undefined;
  while (offset < input.length) {
    if (input.length - offset < 5) {
      throw new ProtoCodecError("Truncated gRPC-Web frame");
    }
    const flags = input[offset] ?? 255;
    const length = new DataView(
      input.buffer,
      input.byteOffset + offset,
      input.byteLength - offset,
    ).getUint32(1);
    offset += 5;
    if (length > input.length - offset) {
      throw new ProtoCodecError("Truncated gRPC-Web frame payload");
    }
    const payload = input.subarray(offset, offset + length);
    offset += length;

    if (flags === 0) {
      if (data) throw new ProtoCodecError("Expected one gRPC-Web data frame");
      data = payload;
      continue;
    }
    if ((flags & 0x80) !== 0) continue;
    throw new ProtoCodecError("Unsupported gRPC-Web frame flags");
  }
  return data ?? new Uint8Array();
}

function encodeGrpcWebResponse(payload: Uint8Array, code: number) {
  return concatBytes(
    encodeGrpcWebFrame(0, payload),
    encodeGrpcWebTrailerFrame(code),
  );
}

function encodeGrpcWebTrailerFrame(code: number, message?: string) {
  const lines = [`grpc-status: ${code}`];
  if (message) lines.push(`grpc-message: ${encodeURIComponent(message)}`);
  const payload = new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
  return encodeGrpcWebFrame(0x80, payload);
}

function encodeGrpcWebFrame(flags: number, payload: Uint8Array) {
  const frame = new Uint8Array(payload.length + 5);
  frame[0] = flags;
  new DataView(frame.buffer).setUint32(1, payload.length);
  frame.set(payload, 5);
  return frame;
}

function concatBytes(...values: Uint8Array[]) {
  const output = new Uint8Array(
    values.reduce((length, value) => length + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function decodeBase64(input: Uint8Array) {
  const binary = atob(new TextDecoder().decode(input).trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64(input: Uint8Array) {
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary);
}
