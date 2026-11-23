import { thumbnailKeyFor } from "@flaremo/contracts/constants";
import {
  createMemo,
  getMemoById,
  hardDeleteMemo,
  markMemoAttachmentsDeleting,
  updateMemo,
} from "@flaremo/domain";
import type { getRequestContext } from "../../../context";
import type { FlareMoEnv } from "../../../env";
import { CompatValidationError } from "../../../memos-compat/errors";
import {
  compatMemoVisibility,
  splitUpdateMaskFields,
} from "../../../memos-compat/parsing";
import { compatMemoPayload } from "../../../memos-compat/payload";
import { normalizeMemoName } from "../../../memos-compat/resource-names";
import { optionalString, record, requiredString } from "../shared";
import { connectMemoWithDetails, stateToLegacy } from "./details";

export async function createConnectMemo(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const memo = record(body.memo);
  const created = await createMemo(
    context.db,
    context.user,
    {
      content: requiredString(memo.content, "memo.content"),
      visibility: compatMemoVisibility(memo.visibility),
      payload: compatMemoPayload(memo),
      source: "memos-connect",
    },
    { userLimits: context.userLimits, userId: context.user.id },
  );
  return connectMemoWithDetails(context, created.id);
}

export async function updateConnectMemo(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  value: unknown,
) {
  const body = record(value);
  const memo = record(body.memo);
  const name = requiredString(memo.name, "memo.name");
  const fields = splitUpdateMaskFields(body.updateMask);
  if (fields.length === 0)
    throw new CompatValidationError("updateMask is required");

  const input: Parameters<typeof updateMemo>[3] = {};
  for (const field of fields) {
    switch (field) {
      case "content":
        input.content = requiredString(memo.content, "memo.content");
        break;
      case "visibility":
        input.visibility = compatMemoVisibility(memo.visibility);
        break;
      case "pinned":
        if (typeof memo.pinned !== "boolean")
          throw new CompatValidationError("memo.pinned must be a boolean");
        input.pinned = memo.pinned;
        break;
      case "state":
        input.status = stateToLegacy(optionalString(memo.state));
        break;
      case "property":
      case "location":
      case "tags":
        input.payload = compatMemoPayload(memo);
        break;
      default:
        throw new CompatValidationError(
          `Unsupported updateMask field: ${field}`,
        );
    }
  }
  const updated = await updateMemo(
    context.db,
    context.user,
    normalizeMemoName(name),
    input,
  );
  return connectMemoWithDetails(context, updated.id);
}

export async function deleteConnectMemo(
  context: Awaited<ReturnType<typeof getRequestContext>>,
  env: FlareMoEnv,
  value: unknown,
) {
  const body = record(value);
  const memo = await getMemoById(
    context.db,
    context.user,
    normalizeMemoName(requiredString(body.name, "name")),
    { includeDeleted: true },
  );
  if (body.force === true) {
    const attachments = await markMemoAttachmentsDeleting(
      context.db,
      context.user,
      memo.id,
    );
    const objectKeys = attachments
      .filter((attachment) => attachment.state !== "missing")
      .flatMap((attachment) =>
        attachment.payload?.thumbnail === true
          ? [attachment.r2Key, thumbnailKeyFor(attachment.r2Key)]
          : [attachment.r2Key],
      );
    if (objectKeys.length > 0) await env.ATTACHMENTS.delete(objectKeys);
    await hardDeleteMemo(context.db, context.user, memo.id);
  } else {
    await updateMemo(context.db, context.user, memo.id, { status: "trashed" });
  }
}
