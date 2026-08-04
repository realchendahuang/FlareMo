/**
 * Small, dependency-free protobuf codec for the stable unary Memos surface.
 *
 * The Worker does not ship protoc or a Node runtime. Keeping this codec local
 * avoids a generated-runtime dependency while still implementing the wire
 * rules that Connect protobuf, gRPC, and gRPC-Web share. The message field
 * numbers mirror the checked-in upstream Memos proto snapshot; unsupported
 * fields are skipped safely so clients can send newer optional fields.
 */

export type ProtoMessage = Record<string, unknown>;

export type BinaryTransport =
  | "connect-proto"
  | "grpc-proto"
  | "grpc-web-proto"
  | "grpc-web-text-proto";

export function detectBinaryTransport(
  contentType: string,
): BinaryTransport | undefined {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/proto") return "connect-proto";
  if (mediaType === "application/grpc+proto") return "grpc-proto";
  if (mediaType === "application/grpc-web+proto") return "grpc-web-proto";
  if (mediaType === "application/grpc-web-text+proto") {
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
  const framed = encodeGrpcUnaryFrame(payload);
  return transport === "grpc-web-text-proto" ? encodeBase64(framed) : framed;
}

export function encodeBinaryError(message: string, transport: BinaryTransport) {
  // google.rpc.Status: code=3 (INVALID_ARGUMENT), message=2. HTTP status and
  // grpc-status headers are still supplied by the route for transport-aware
  // clients; this body makes Connect protobuf errors inspectable as well.
  const status = new ProtoWriter().int32(1, 3).string(2, message).finish();
  if (transport === "connect-proto") return status;
  const framed = encodeGrpcUnaryFrame(status);
  return transport === "grpc-web-text-proto" ? encodeBase64(framed) : framed;
}

function decodeRequestMessage(
  service: string,
  method: string,
  payload: Uint8Array,
): ProtoMessage {
  if (service === "memos.api.v1.MemoService") {
    return decodeMemoServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.AuthService") {
    return decodeAuthServiceRequest(method, payload);
  }
  if (service === "memos.api.v1.ShortcutService") {
    return decodeShortcutServiceRequest(method, payload);
  }
  throw new ProtoCodecError(`Unsupported protobuf service: ${service}`);
}

function encodeResponseMessage(
  service: string,
  method: string,
  value: unknown,
): Uint8Array {
  const body = asRecord(value);
  if (service === "memos.api.v1.MemoService") {
    switch (method) {
      case "CreateMemo":
      case "GetMemo":
      case "UpdateMemo":
      case "CreateMemoComment":
      case "GetSharedMemo":
        return encodeMemo(body);
      case "ListMemos":
      case "ListMemoComments":
        return encodeList(body.memos, encodeMemo, body.nextPageToken);
      case "ListMemoAttachments":
        return encodeList(
          body.attachments,
          encodeAttachment,
          body.nextPageToken,
        );
      case "ListMemoRelations":
        return encodeList(body.relations, encodeRelation, body.nextPageToken);
      case "ListMemoReactions":
        return encodeList(body.reactions, encodeReaction, body.nextPageToken);
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
        if (field === 1) body.shareToken = reader.string(wire);
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
    else if (field === 3) attachment.filename = reader.string(wire);
    else if (field === 6) attachment.type = reader.string(wire);
    else if (field === 8) attachment.memo = reader.string(wire);
    else reader.skip(wire);
  }
  return attachment;
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
) {
  return new ProtoWriter()
    .repeatedMessages(1, records(value), encoder)
    .string(2, stringValue(nextPageToken))
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

  int32(field: number, value: number) {
    if (!Number.isFinite(value) || value === 0) return this;
    this.tag(field, 0);
    this.varint(Math.trunc(value));
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
