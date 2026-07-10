import { getMemoContextData } from "@flaremo/domain";
import {
  attachmentToDto,
  memoRelationToDto,
  memoRevisionToDto,
  memoToDto,
  shareToDto,
} from "@flaremo/memos";
import type { ReturnTypeOfRequestContext } from "./context";

export async function buildMemoContext(
  context: ReturnTypeOfRequestContext,
  memoId: string,
) {
  const { db, user } = context;
  const { memo, attachments, shares, relations, backlinks, revisions } =
    await getMemoContextData(db, user, memoId);
  const mapRelationContext = (item: (typeof relations)[number]) => ({
    relation: memoRelationToDto(item.relation),
    memo: memoToDto(item.memo, user),
  });

  return {
    memo: memoToDto(memo, user),
    attachments: attachments.map(attachmentToDto),
    shares: shares.map(shareToDto),
    relations: relations.map(mapRelationContext),
    backlinks: backlinks.map(mapRelationContext),
    revisions: revisions.map(memoRevisionToDto),
  };
}
