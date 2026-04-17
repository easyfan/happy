import * as z from 'zod';
import { MessageMetaSchema } from './messageMeta';

export const AttachmentRefSchema = z.object({
  uploadId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

export const FileShareContentSchema = z.object({
  type: z.literal('file_share'),
  uploadId: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  description: z.string().optional(),
});
export type FileShareContent = z.infer<typeof FileShareContentSchema>;

export const UserMessageSchema = z.object({
  role: z.literal('user'),
  content: z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  localKey: z.string().optional(),
  meta: MessageMetaSchema.optional(),
  attachments: z.array(AttachmentRefSchema).optional(),
});
export type UserMessage = z.infer<typeof UserMessageSchema>;

export const AgentMessageSchema = z.object({
  role: z.literal('agent'),
  content: z
    .object({
      type: z.string(),
    })
    .passthrough(),
  meta: MessageMetaSchema.optional(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const LegacyMessageContentSchema = z.discriminatedUnion('role', [UserMessageSchema, AgentMessageSchema]);
export type LegacyMessageContent = z.infer<typeof LegacyMessageContentSchema>;
