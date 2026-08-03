import { z } from "zod";

/**
 * Public wire contracts for the current Memos protobuf-JSON surface.
 *
 * The legacy FlareMo API intentionally keeps its snake_case schemas in
 * memos.ts. Keeping these namespaced exports separate makes it difficult to
 * accidentally change the legacy API while adding current compatibility.
 */

export const currentMemoStateSchema = z.enum([
  "STATE_UNSPECIFIED",
  "NORMAL",
  "ARCHIVED",
]);

export const currentMemoVisibilitySchema = z.enum([
  "VISIBILITY_UNSPECIFIED",
  "PRIVATE",
  "PROTECTED",
  "PUBLIC",
]);

export const currentMemoRelationTypeSchema = z.enum([
  "TYPE_UNSPECIFIED",
  "REFERENCE",
  "COMMENT",
]);

export const currentMemoPropertySchema = z
  .object({
    hasLink: z.boolean().optional(),
    hasTaskList: z.boolean().optional(),
    hasCode: z.boolean().optional(),
    hasIncompleteTasks: z.boolean().optional(),
    title: z.string().optional(),
  })
  .passthrough();

export const currentLocationSchema = z
  .object({
    placeholder: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  })
  .passthrough();

export const currentAttachmentSchema = z
  .object({
    name: z.string(),
    createTime: z.string().datetime().optional(),
    filename: z.string(),
    type: z.string(),
    size: z.string(),
    memo: z.string().optional(),
  })
  .passthrough();

export const currentMemoRelationSchema = z.object({
  memo: z.object({ name: z.string(), snippet: z.string().optional() }),
  relatedMemo: z.object({ name: z.string(), snippet: z.string().optional() }),
  type: currentMemoRelationTypeSchema,
});

export const currentMemoSchema = z
  .object({
    name: z.string(),
    state: currentMemoStateSchema,
    creator: z.string(),
    createTime: z.string().datetime(),
    updateTime: z.string().datetime(),
    content: z.string(),
    visibility: currentMemoVisibilitySchema,
    tags: z.array(z.string()),
    pinned: z.boolean(),
    attachments: z.array(currentAttachmentSchema).optional(),
    relations: z.array(currentMemoRelationSchema).optional(),
    reactions: z.array(z.record(z.string(), z.unknown())).optional(),
    property: currentMemoPropertySchema.optional(),
    snippet: z.string().optional(),
    location: currentLocationSchema.optional(),
  })
  .passthrough();

export const currentCreateMemoRequestSchema = z.object({
  memo: currentMemoSchema.partial().extend({ content: z.string() }),
  memoId: z.string().optional(),
});

export const currentUpdateMemoRequestSchema = z.object({
  memo: currentMemoSchema.partial().extend({ name: z.string() }),
  updateMask: z.string(),
});

export const currentListMemosResponseSchema = z.object({
  memos: z.array(currentMemoSchema),
  nextPageToken: z.string().optional(),
});

export const currentListAttachmentsResponseSchema = z.object({
  attachments: z.array(currentAttachmentSchema),
  nextPageToken: z.string().optional(),
  totalSize: z.number().int().nonnegative().optional(),
});

export const currentMemoShareSchema = z
  .object({
    name: z.string(),
    createTime: z.string().datetime(),
    expireTime: z.string().datetime().nullable().optional(),
  })
  .passthrough();

export const currentUserSchema = z
  .object({
    name: z.string(),
    role: z.enum(["ROLE_UNSPECIFIED", "USER", "ADMIN"]),
    username: z.string(),
    email: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().optional(),
    state: z.enum(["STATE_UNSPECIFIED", "NORMAL"]),
    createTime: z.string().datetime(),
    updateTime: z.string().datetime(),
  })
  .passthrough();

export const currentPersonalAccessTokenSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    lastUsedAt: z.string().datetime().optional(),
  })
  .passthrough();

export const currentStandardErrorSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  details: z.array(z.record(z.string(), z.unknown())),
});

export type CurrentMemo = z.infer<typeof currentMemoSchema>;
export type CurrentAttachment = z.infer<typeof currentAttachmentSchema>;
export type CurrentMemoRelation = z.infer<typeof currentMemoRelationSchema>;
export type CurrentMemoShare = z.infer<typeof currentMemoShareSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type CurrentPersonalAccessToken = z.infer<
  typeof currentPersonalAccessTokenSchema
>;
export type CurrentStandardError = z.infer<typeof currentStandardErrorSchema>;
