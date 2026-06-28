import { z } from "zod";

export const memoVisibilitySchema = z.enum(["private", "protected", "public"]);
export const memoStatusSchema = z.enum([
  "normal",
  "archived",
  "trashed",
  "deleted",
]);
export const memoRelationTypeSchema = z.enum(["reference", "comment"]);

export const memoPropertySchema = z
  .object({
    title: z.string().optional(),
    has_link: z.boolean().optional(),
    has_task_list: z.boolean().optional(),
    has_code: z.boolean().optional(),
    has_incomplete_tasks: z.boolean().optional(),
  })
  .passthrough();

export const memoPayloadSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    property: memoPropertySchema.optional(),
    location: z.unknown().optional(),
    client_id: z.string().optional(),
  })
  .passthrough();

export const createMemoSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  visibility: memoVisibilitySchema.default("private"),
  payload: memoPayloadSchema.optional(),
  source: z.string().trim().min(1).max(64).default("web"),
});

export const updateMemoSchema = z
  .object({
    content: z.string().trim().min(1).max(100_000).optional(),
    visibility: memoVisibilitySchema.optional(),
    status: memoStatusSchema.optional(),
    pinned: z.boolean().optional(),
    payload: memoPayloadSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field must be updated.",
  );

export const listMemosQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(30),
  page_token: z.string().optional(),
  order_by: z.string().default("created_at desc"),
  state: memoStatusSchema.optional(),
  q: z.string().optional(),
  tag: z.string().optional(),
  include_deleted: z.coerce.boolean().default(false),
});

export const attachmentDtoSchema = z.object({
  name: z.string(),
  id: z.string(),
  memo: z.string().nullable(),
  filename: z.string(),
  content_type: z.string().nullable(),
  size: z.number().int().nonnegative(),
  payload: z.record(z.string(), z.unknown()),
  create_time: z.string(),
  update_time: z.string(),
  download_url: z.string(),
});

export const memoDtoSchema = z.object({
  name: z.string(),
  id: z.string(),
  content: z.string(),
  visibility: memoVisibilitySchema,
  state: memoStatusSchema,
  pinned: z.boolean(),
  payload: memoPayloadSchema,
  create_time: z.string(),
  update_time: z.string(),
  display_time: z.string(),
  creator: z.string(),
  attachments: z.array(attachmentDtoSchema).optional(),
});

export const listMemosResponseSchema = z.object({
  memos: z.array(memoDtoSchema),
  next_page_token: z.string().optional(),
});

export const listAttachmentsQuerySchema = z.object({
  memo: z.string().optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});

export const bindMemoAttachmentsSchema = z.object({
  attachments: z.array(z.string()).max(100),
});

export const listAttachmentsResponseSchema = z.object({
  attachments: z.array(attachmentDtoSchema),
});

export const memoRelationDtoSchema = z.object({
  memo: z.string(),
  related_memo: z.string(),
  type: memoRelationTypeSchema,
  create_time: z.string(),
});

export const patchMemoRelationsSchema = z.object({
  relations: z
    .array(
      z.object({
        related_memo: z.string(),
        type: memoRelationTypeSchema.default("reference"),
      }),
    )
    .max(100),
});

export const listMemoRelationsResponseSchema = z.object({
  relations: z.array(memoRelationDtoSchema),
});

export const shareDtoSchema = z.object({
  name: z.string(),
  id: z.string(),
  memo: z.string(),
  token: z.string(),
  expires_at: z.string().nullable(),
  create_time: z.string(),
});

export const createShareSchema = z.object({
  expires_at: z.string().datetime().nullable().optional(),
});

export const publicShareDtoSchema = z.object({
  share: shareDtoSchema.omit({ token: true }),
  memo: memoDtoSchema,
  attachments: z.array(attachmentDtoSchema),
});

export const exportAttachmentSchema = attachmentDtoSchema
  .omit({ download_url: true })
  .extend({
    data_base64: z.string().optional(),
  });

export const importBundleSchema = z.object({
  version: z.literal(1).default(1),
  memos: z.array(
    memoDtoSchema.pick({
      name: true,
      content: true,
      visibility: true,
      state: true,
      pinned: true,
      payload: true,
    }),
  ),
  attachments: z.array(exportAttachmentSchema).default([]),
  relations: z.array(memoRelationDtoSchema).default([]),
  shares: z.array(shareDtoSchema).default([]),
  exported_at: z.string().optional(),
});

export const importResultSchema = z.object({
  imported_memos: z.number().int().nonnegative(),
  imported_attachments: z.number().int().nonnegative(),
  imported_relations: z.number().int().nonnegative(),
  imported_shares: z.number().int().nonnegative(),
});

export type CreateMemoInput = z.infer<typeof createMemoSchema>;
export type UpdateMemoInput = z.infer<typeof updateMemoSchema>;
export type ListMemosQuery = z.infer<typeof listMemosQuerySchema>;
export type MemoDto = z.infer<typeof memoDtoSchema>;
export type ListMemosResponse = z.infer<typeof listMemosResponseSchema>;
export type AttachmentDto = z.infer<typeof attachmentDtoSchema>;
export type ListAttachmentsQuery = z.infer<typeof listAttachmentsQuerySchema>;
export type BindMemoAttachmentsInput = z.infer<
  typeof bindMemoAttachmentsSchema
>;
export type MemoRelationDto = z.infer<typeof memoRelationDtoSchema>;
export type PatchMemoRelationsInput = z.infer<typeof patchMemoRelationsSchema>;
export type ShareDto = z.infer<typeof shareDtoSchema>;
export type CreateShareInput = z.infer<typeof createShareSchema>;
export type PublicShareDto = z.infer<typeof publicShareDtoSchema>;
export type ExportAttachment = z.infer<typeof exportAttachmentSchema>;
export type ImportBundle = z.infer<typeof importBundleSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
