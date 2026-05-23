'use strict';

var z = require('zod');
var cuid2 = require('@paralleldrive/cuid2');

function _interopNamespaceDefault(e) {
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n.default = e;
  return Object.freeze(n);
}

var z__namespace = /*#__PURE__*/_interopNamespaceDefault(z);

const sessionRoleSchema = z__namespace.enum(["user", "agent"]);
const sessionTextEventSchema = z__namespace.object({
  t: z__namespace.literal("text"),
  text: z__namespace.string(),
  thinking: z__namespace.boolean().optional()
});
const sessionServiceMessageEventSchema = z__namespace.object({
  t: z__namespace.literal("service"),
  text: z__namespace.string()
});
const sessionToolCallStartEventSchema = z__namespace.object({
  t: z__namespace.literal("tool-call-start"),
  call: z__namespace.string(),
  name: z__namespace.string(),
  title: z__namespace.string(),
  description: z__namespace.string(),
  args: z__namespace.record(z__namespace.string(), z__namespace.unknown())
});
const sessionToolCallEndEventSchema = z__namespace.object({
  t: z__namespace.literal("tool-call-end"),
  call: z__namespace.string()
});
const sessionFileEventSchema = z__namespace.object({
  t: z__namespace.literal("file"),
  ref: z__namespace.string(),
  name: z__namespace.string(),
  size: z__namespace.number(),
  mimeType: z__namespace.string().optional(),
  image: z__namespace.object({
    width: z__namespace.number(),
    height: z__namespace.number(),
    thumbhash: z__namespace.string()
  }).optional()
});
const sessionTurnStartEventSchema = z__namespace.object({
  t: z__namespace.literal("turn-start")
});
const sessionStartEventSchema = z__namespace.object({
  t: z__namespace.literal("start"),
  title: z__namespace.string().optional()
});
const sessionTurnEndStatusSchema = z__namespace.enum(["completed", "failed", "cancelled"]);
const sessionTurnEndEventSchema = z__namespace.object({
  t: z__namespace.literal("turn-end"),
  status: sessionTurnEndStatusSchema
});
const sessionStopEventSchema = z__namespace.object({
  t: z__namespace.literal("stop")
});
const sessionEventSchema = z__namespace.discriminatedUnion("t", [
  sessionTextEventSchema,
  sessionServiceMessageEventSchema,
  sessionToolCallStartEventSchema,
  sessionToolCallEndEventSchema,
  sessionFileEventSchema,
  sessionTurnStartEventSchema,
  sessionStartEventSchema,
  sessionTurnEndEventSchema,
  sessionStopEventSchema
]);
const sessionEnvelopeSchema = z__namespace.object({
  id: z__namespace.string(),
  time: z__namespace.number(),
  role: sessionRoleSchema,
  turn: z__namespace.string().optional(),
  subagent: z__namespace.string().refine((value) => cuid2.isCuid(value), {
    message: "subagent must be a cuid2 value"
  }).optional(),
  ev: sessionEventSchema
}).superRefine((envelope, ctx) => {
  if (envelope.ev.t === "service" && envelope.role !== "agent") {
    ctx.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      message: 'service events must use role "agent"',
      path: ["role"]
    });
  }
  if ((envelope.ev.t === "start" || envelope.ev.t === "stop") && envelope.role !== "agent") {
    ctx.addIssue({
      code: z__namespace.ZodIssueCode.custom,
      message: `${envelope.ev.t} events must use role "agent"`,
      path: ["role"]
    });
  }
});
function createEnvelope(role, ev, opts = {}) {
  return sessionEnvelopeSchema.parse({
    id: opts.id ?? cuid2.createId(),
    time: opts.time ?? Date.now(),
    role,
    ...opts.turn ? { turn: opts.turn } : {},
    ...opts.subagent ? { subagent: opts.subagent } : {},
    ev
  });
}

const MessageMetaSchema = z__namespace.object({
  sentFrom: z__namespace.string().optional(),
  permissionMode: z__namespace.enum(["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]).optional(),
  model: z__namespace.string().nullable().optional(),
  fallbackModel: z__namespace.string().nullable().optional(),
  customSystemPrompt: z__namespace.string().nullable().optional(),
  appendSystemPrompt: z__namespace.string().nullable().optional(),
  allowedTools: z__namespace.array(z__namespace.string()).nullable().optional(),
  disallowedTools: z__namespace.array(z__namespace.string()).nullable().optional(),
  displayText: z__namespace.string().optional()
});

const AttachmentRefSchema = z__namespace.object({
  uploadId: z__namespace.string(),
  filename: z__namespace.string(),
  mimeType: z__namespace.string(),
  sizeBytes: z__namespace.number().int().positive()
});
const FileShareContentSchema = z__namespace.object({
  type: z__namespace.literal("file_share"),
  uploadId: z__namespace.string(),
  filename: z__namespace.string(),
  mimeType: z__namespace.string(),
  sizeBytes: z__namespace.number().int().positive(),
  description: z__namespace.string().optional()
});
const UserMessageSchema = z__namespace.object({
  role: z__namespace.literal("user"),
  content: z__namespace.object({
    type: z__namespace.literal("text"),
    text: z__namespace.string()
  }),
  localKey: z__namespace.string().optional(),
  meta: MessageMetaSchema.optional(),
  attachments: z__namespace.array(AttachmentRefSchema).optional()
});
const AgentMessageSchema = z__namespace.object({
  role: z__namespace.literal("agent"),
  content: z__namespace.object({
    type: z__namespace.string()
  }).passthrough(),
  meta: MessageMetaSchema.optional()
});
const LegacyMessageContentSchema = z__namespace.discriminatedUnion("role", [UserMessageSchema, AgentMessageSchema]);

const SessionMessageContentSchema = z__namespace.object({
  c: z__namespace.string(),
  t: z__namespace.literal("encrypted")
});
const SessionMessageSchema = z__namespace.object({
  id: z__namespace.string(),
  seq: z__namespace.number(),
  localId: z__namespace.string().nullish(),
  content: SessionMessageContentSchema,
  createdAt: z__namespace.number(),
  updatedAt: z__namespace.number()
});
const SessionProtocolMessageSchema = z__namespace.object({
  role: z__namespace.literal("session"),
  content: sessionEnvelopeSchema,
  meta: MessageMetaSchema.optional()
});
const MessageContentSchema = z__namespace.discriminatedUnion("role", [
  UserMessageSchema,
  AgentMessageSchema,
  SessionProtocolMessageSchema
]);
const VersionedEncryptedValueSchema = z__namespace.object({
  version: z__namespace.number(),
  value: z__namespace.string()
});
const VersionedNullableEncryptedValueSchema = z__namespace.object({
  version: z__namespace.number(),
  value: z__namespace.string().nullable()
});
const UpdateNewMessageBodySchema = z__namespace.object({
  t: z__namespace.literal("new-message"),
  sid: z__namespace.string(),
  message: SessionMessageSchema
});
const UpdateSessionBodySchema = z__namespace.object({
  t: z__namespace.literal("update-session"),
  id: z__namespace.string(),
  metadata: VersionedEncryptedValueSchema.nullish(),
  agentState: VersionedNullableEncryptedValueSchema.nullish()
});
const VersionedMachineEncryptedValueSchema = z__namespace.object({
  version: z__namespace.number(),
  value: z__namespace.string()
});
const UpdateMachineBodySchema = z__namespace.object({
  t: z__namespace.literal("update-machine"),
  machineId: z__namespace.string(),
  metadata: VersionedMachineEncryptedValueSchema.nullish(),
  daemonState: VersionedMachineEncryptedValueSchema.nullish(),
  active: z__namespace.boolean().optional(),
  activeAt: z__namespace.number().optional()
});
const CoreUpdateBodySchema = z__namespace.discriminatedUnion("t", [
  UpdateNewMessageBodySchema,
  UpdateSessionBodySchema,
  UpdateMachineBodySchema
]);
const CoreUpdateContainerSchema = z__namespace.object({
  id: z__namespace.string(),
  seq: z__namespace.number(),
  body: CoreUpdateBodySchema,
  createdAt: z__namespace.number()
});
const ApiMessageSchema = SessionMessageSchema;
const ApiUpdateNewMessageSchema = UpdateNewMessageBodySchema;
const ApiUpdateSessionStateSchema = UpdateSessionBodySchema;
const ApiUpdateMachineStateSchema = UpdateMachineBodySchema;
const UpdateBodySchema = UpdateNewMessageBodySchema;
const UpdateSchema = CoreUpdateContainerSchema;

const VoiceConversationGrantedSchema = z__namespace.object({
  allowed: z__namespace.literal(true),
  conversationToken: z__namespace.string(),
  conversationId: z__namespace.string(),
  agentId: z__namespace.string(),
  elevenUserId: z__namespace.string(),
  usedSeconds: z__namespace.number(),
  limitSeconds: z__namespace.number()
});
const VoiceConversationDeniedSchema = z__namespace.object({
  allowed: z__namespace.literal(false),
  reason: z__namespace.enum(["voice_hard_limit_reached", "subscription_required", "voice_conversation_limit_reached"]),
  usedSeconds: z__namespace.number(),
  limitSeconds: z__namespace.number(),
  agentId: z__namespace.string()
});
const VoiceConversationResponseSchema = z__namespace.discriminatedUnion("allowed", [
  VoiceConversationGrantedSchema,
  VoiceConversationDeniedSchema
]);
const VoiceUsageResponseSchema = z__namespace.object({
  usedSeconds: z__namespace.number(),
  limitSeconds: z__namespace.number(),
  conversationCount: z__namespace.number(),
  conversationLimit: z__namespace.number(),
  elevenUserId: z__namespace.string()
});

exports.AgentMessageSchema = AgentMessageSchema;
exports.ApiMessageSchema = ApiMessageSchema;
exports.ApiUpdateMachineStateSchema = ApiUpdateMachineStateSchema;
exports.ApiUpdateNewMessageSchema = ApiUpdateNewMessageSchema;
exports.ApiUpdateSessionStateSchema = ApiUpdateSessionStateSchema;
exports.AttachmentRefSchema = AttachmentRefSchema;
exports.CoreUpdateBodySchema = CoreUpdateBodySchema;
exports.CoreUpdateContainerSchema = CoreUpdateContainerSchema;
exports.FileShareContentSchema = FileShareContentSchema;
exports.LegacyMessageContentSchema = LegacyMessageContentSchema;
exports.MessageContentSchema = MessageContentSchema;
exports.MessageMetaSchema = MessageMetaSchema;
exports.SessionMessageContentSchema = SessionMessageContentSchema;
exports.SessionMessageSchema = SessionMessageSchema;
exports.SessionProtocolMessageSchema = SessionProtocolMessageSchema;
exports.UpdateBodySchema = UpdateBodySchema;
exports.UpdateMachineBodySchema = UpdateMachineBodySchema;
exports.UpdateNewMessageBodySchema = UpdateNewMessageBodySchema;
exports.UpdateSchema = UpdateSchema;
exports.UpdateSessionBodySchema = UpdateSessionBodySchema;
exports.UserMessageSchema = UserMessageSchema;
exports.VersionedEncryptedValueSchema = VersionedEncryptedValueSchema;
exports.VersionedMachineEncryptedValueSchema = VersionedMachineEncryptedValueSchema;
exports.VersionedNullableEncryptedValueSchema = VersionedNullableEncryptedValueSchema;
exports.VoiceConversationDeniedSchema = VoiceConversationDeniedSchema;
exports.VoiceConversationGrantedSchema = VoiceConversationGrantedSchema;
exports.VoiceConversationResponseSchema = VoiceConversationResponseSchema;
exports.VoiceUsageResponseSchema = VoiceUsageResponseSchema;
exports.createEnvelope = createEnvelope;
exports.sessionEnvelopeSchema = sessionEnvelopeSchema;
exports.sessionEventSchema = sessionEventSchema;
exports.sessionFileEventSchema = sessionFileEventSchema;
exports.sessionRoleSchema = sessionRoleSchema;
exports.sessionServiceMessageEventSchema = sessionServiceMessageEventSchema;
exports.sessionStartEventSchema = sessionStartEventSchema;
exports.sessionStopEventSchema = sessionStopEventSchema;
exports.sessionTextEventSchema = sessionTextEventSchema;
exports.sessionToolCallEndEventSchema = sessionToolCallEndEventSchema;
exports.sessionToolCallStartEventSchema = sessionToolCallStartEventSchema;
exports.sessionTurnEndEventSchema = sessionTurnEndEventSchema;
exports.sessionTurnEndStatusSchema = sessionTurnEndStatusSchema;
exports.sessionTurnStartEventSchema = sessionTurnStartEventSchema;
