import { thumbnailKeyFor } from "@flaremo/contracts/constants";
import {
  finalizeAttachmentDelete,
  getAttachmentById,
  listAttachments,
  markAttachmentDeleting,
  ValidationError,
} from "@flaremo/domain";
import type { ReturnTypeOfRequestContext } from "../../../context";
import type { FlareMoEnv } from "../../../env";
import { type JsonObject, optionalString } from "../../../mcp-protocol";
import { attachmentToCurrentMemosDto, pageSize, resourceName } from "../input";

export async function streamableListAttachments(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const pageToken = optionalString(args, "pageToken");
  if (pageToken)
    throw new ValidationError("pageToken is not supported for attachments.");
  const filter = optionalString(args, "filter");
  if (filter)
    throw new ValidationError("Attachment filter is not supported by FlareMo.");
  const orderBy = optionalString(args, "orderBy");
  if (orderBy)
    throw new ValidationError(
      "Attachment orderBy is not supported by FlareMo.",
    );
  const memo = optionalString(args, "memo");
  const rows = await listAttachments(context.db, context.user, {
    memoId: memo,
    pageSize: pageSize(args),
  });
  return { attachments: rows.map(attachmentToCurrentMemosDto) };
}

export async function streamableGetAttachment(
  context: ReturnTypeOfRequestContext,
  args: JsonObject,
) {
  const name = resourceName(args, "attachment", "name");
  const attachment = await getAttachmentById(context.db, context.user, name);
  return attachmentToCurrentMemosDto(attachment);
}

export async function streamableDeleteAttachment(
  context: ReturnTypeOfRequestContext,
  env: FlareMoEnv,
  args: JsonObject,
) {
  const name = resourceName(args, "attachment", "name");
  const attachment = await markAttachmentDeleting(
    context.db,
    context.user,
    name,
  );
  await env.ATTACHMENTS.delete(
    attachment.payload?.thumbnail === true
      ? [attachment.r2Key, thumbnailKeyFor(attachment.r2Key)]
      : attachment.r2Key,
  );
  await finalizeAttachmentDelete(context.db, context.user, attachment.id);
  return { ok: true };
}
