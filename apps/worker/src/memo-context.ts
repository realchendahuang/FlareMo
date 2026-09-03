import { getFlaremoUserNames, getMemoContextData } from "@flaremo/domain";
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
  const {
    memo,
    canManage,
    attachments,
    shares,
    relations,
    backlinks,
    revisions,
    memories,
  } = await getMemoContextData(db, user, memoId);
  const creatorNames = await getFlaremoUserNames(db, [
    memo.userId,
    ...relations.map((item) => item.memo.userId),
    ...backlinks.map((item) => item.memo.userId),
  ]);
  const mapRelationContext = (item: (typeof relations)[number]) => ({
    relation: memoRelationToDto(item.relation),
    memo: memoToDto(item.memo, user, creatorNames.get(item.memo.userId)),
  });

  return {
    memo: memoToDto(memo, user, creatorNames.get(memo.userId)),
    can_manage: canManage,
    attachments: attachments.map(attachmentToDto),
    shares: shares.map(shareToDto),
    relations: relations.map(mapRelationContext),
    backlinks: backlinks.map(mapRelationContext),
    revisions: revisions.map(memoRevisionToDto),
    memories,
  };
}
