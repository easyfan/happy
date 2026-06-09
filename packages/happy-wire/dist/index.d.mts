import * as z from 'zod';

declare const MessageMetaSchema: z.ZodObject<{
    sentFrom: z.ZodOptional<z.ZodString>;
    permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
    model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
    displayText: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    sentFrom?: string | undefined;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
    model?: string | null | undefined;
    fallbackModel?: string | null | undefined;
    customSystemPrompt?: string | null | undefined;
    appendSystemPrompt?: string | null | undefined;
    allowedTools?: string[] | null | undefined;
    disallowedTools?: string[] | null | undefined;
    displayText?: string | undefined;
}, {
    sentFrom?: string | undefined;
    permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
    model?: string | null | undefined;
    fallbackModel?: string | null | undefined;
    customSystemPrompt?: string | null | undefined;
    appendSystemPrompt?: string | null | undefined;
    allowedTools?: string[] | null | undefined;
    disallowedTools?: string[] | null | undefined;
    displayText?: string | undefined;
}>;
type MessageMeta = z.infer<typeof MessageMetaSchema>;

declare const SessionMessageContentSchema: z.ZodObject<{
    c: z.ZodString;
    t: z.ZodLiteral<"encrypted">;
}, "strip", z.ZodTypeAny, {
    c: string;
    t: "encrypted";
}, {
    c: string;
    t: "encrypted";
}>;
type SessionMessageContent = z.infer<typeof SessionMessageContentSchema>;
declare const SessionMessageSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    content: z.ZodObject<{
        c: z.ZodString;
        t: z.ZodLiteral<"encrypted">;
    }, "strip", z.ZodTypeAny, {
        c: string;
        t: "encrypted";
    }, {
        c: string;
        t: "encrypted";
    }>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    seq: number;
    content: {
        c: string;
        t: "encrypted";
    };
    createdAt: number;
    updatedAt: number;
    localId?: string | null | undefined;
}, {
    id: string;
    seq: number;
    content: {
        c: string;
        t: "encrypted";
    };
    createdAt: number;
    updatedAt: number;
    localId?: string | null | undefined;
}>;
type SessionMessage = z.infer<typeof SessionMessageSchema>;

declare const SessionProtocolMessageSchema: z.ZodObject<{
    role: z.ZodLiteral<"session">;
    content: z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        time: z.ZodNumber;
        role: z.ZodEnum<["user", "agent"]>;
        turn: z.ZodOptional<z.ZodString>;
        subagent: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        claudeUuid: z.ZodOptional<z.ZodString>;
        ev: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
            t: z.ZodLiteral<"text">;
            text: z.ZodString;
            thinking: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        }, {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"service">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            t: "service";
            text: string;
        }, {
            t: "service";
            text: string;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"tool-call-start">;
            call: z.ZodString;
            name: z.ZodString;
            title: z.ZodString;
            description: z.ZodString;
            args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        }, {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"tool-call-end">;
            call: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            t: "tool-call-end";
            call: string;
        }, {
            t: "tool-call-end";
            call: string;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"file">;
            ref: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
            mimeType: z.ZodOptional<z.ZodString>;
            image: z.ZodOptional<z.ZodObject<{
                width: z.ZodNumber;
                height: z.ZodNumber;
                thumbhash: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                width: number;
                height: number;
                thumbhash: string;
            }, {
                width: number;
                height: number;
                thumbhash: string;
            }>>;
        }, "strip", z.ZodTypeAny, {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        }, {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"turn-start">;
        }, "strip", z.ZodTypeAny, {
            t: "turn-start";
        }, {
            t: "turn-start";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"start">;
            title: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            t: "start";
            title?: string | undefined;
        }, {
            t: "start";
            title?: string | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"turn-end">;
            status: z.ZodEnum<["completed", "failed", "cancelled"]>;
        }, "strip", z.ZodTypeAny, {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        }, {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"stop">;
        }, "strip", z.ZodTypeAny, {
            t: "stop";
        }, {
            t: "stop";
        }>]>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    }, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    }>, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    }, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    }>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    };
    role: "session";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}, {
    content: {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    };
    role: "session";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}>;
type SessionProtocolMessage = z.infer<typeof SessionProtocolMessageSchema>;
declare const MessageContentSchema: z.ZodDiscriminatedUnion<"role", [z.ZodObject<{
    role: z.ZodLiteral<"user">;
    content: z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>;
    localKey: z.ZodOptional<z.ZodString>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }>>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        uploadId: z.ZodString;
        filename: z.ZodString;
        mimeType: z.ZodString;
        sizeBytes: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }, {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: "text";
        text: string;
    };
    role: "user";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
    localKey?: string | undefined;
    attachments?: {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }[] | undefined;
}, {
    content: {
        type: "text";
        text: string;
    };
    role: "user";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
    localKey?: string | undefined;
    attachments?: {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }[] | undefined;
}>, z.ZodObject<{
    role: z.ZodLiteral<"agent">;
    content: z.ZodObject<{
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}>, z.ZodObject<{
    role: z.ZodLiteral<"session">;
    content: z.ZodEffects<z.ZodObject<{
        id: z.ZodString;
        time: z.ZodNumber;
        role: z.ZodEnum<["user", "agent"]>;
        turn: z.ZodOptional<z.ZodString>;
        subagent: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        claudeUuid: z.ZodOptional<z.ZodString>;
        ev: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
            t: z.ZodLiteral<"text">;
            text: z.ZodString;
            thinking: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        }, {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"service">;
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            t: "service";
            text: string;
        }, {
            t: "service";
            text: string;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"tool-call-start">;
            call: z.ZodString;
            name: z.ZodString;
            title: z.ZodString;
            description: z.ZodString;
            args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        }, "strip", z.ZodTypeAny, {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        }, {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"tool-call-end">;
            call: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            t: "tool-call-end";
            call: string;
        }, {
            t: "tool-call-end";
            call: string;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"file">;
            ref: z.ZodString;
            name: z.ZodString;
            size: z.ZodNumber;
            mimeType: z.ZodOptional<z.ZodString>;
            image: z.ZodOptional<z.ZodObject<{
                width: z.ZodNumber;
                height: z.ZodNumber;
                thumbhash: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                width: number;
                height: number;
                thumbhash: string;
            }, {
                width: number;
                height: number;
                thumbhash: string;
            }>>;
        }, "strip", z.ZodTypeAny, {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        }, {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"turn-start">;
        }, "strip", z.ZodTypeAny, {
            t: "turn-start";
        }, {
            t: "turn-start";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"start">;
            title: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            t: "start";
            title?: string | undefined;
        }, {
            t: "start";
            title?: string | undefined;
        }>, z.ZodObject<{
            t: z.ZodLiteral<"turn-end">;
            status: z.ZodEnum<["completed", "failed", "cancelled"]>;
        }, "strip", z.ZodTypeAny, {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        }, {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        }>, z.ZodObject<{
            t: z.ZodLiteral<"stop">;
        }, "strip", z.ZodTypeAny, {
            t: "stop";
        }, {
            t: "stop";
        }>]>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    }, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    }>, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    }, {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    }>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    };
    role: "session";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}, {
    content: {
        id: string;
        role: "user" | "agent";
        time: number;
        ev: {
            t: "text";
            text: string;
            thinking?: boolean | undefined;
        } | {
            t: "service";
            text: string;
        } | {
            t: "tool-call-start";
            call: string;
            name: string;
            title: string;
            description: string;
            args: Record<string, unknown>;
        } | {
            t: "tool-call-end";
            call: string;
        } | {
            t: "file";
            name: string;
            ref: string;
            size: number;
            mimeType?: string | undefined;
            image?: {
                width: number;
                height: number;
                thumbhash: string;
            } | undefined;
        } | {
            t: "turn-start";
        } | {
            t: "start";
            title?: string | undefined;
        } | {
            t: "turn-end";
            status: "completed" | "failed" | "cancelled";
        } | {
            t: "stop";
        };
        turn?: string | undefined;
        subagent?: string | undefined;
        claudeUuid?: string | undefined;
    };
    role: "session";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}>]>;
type MessageContent = z.infer<typeof MessageContentSchema>;
declare const VersionedEncryptedValueSchema: z.ZodObject<{
    version: z.ZodNumber;
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    version: number;
}, {
    value: string;
    version: number;
}>;
type VersionedEncryptedValue = z.infer<typeof VersionedEncryptedValueSchema>;
declare const VersionedNullableEncryptedValueSchema: z.ZodObject<{
    version: z.ZodNumber;
    value: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    value: string | null;
    version: number;
}, {
    value: string | null;
    version: number;
}>;
type VersionedNullableEncryptedValue = z.infer<typeof VersionedNullableEncryptedValueSchema>;
declare const UpdateNewMessageBodySchema: z.ZodObject<{
    t: z.ZodLiteral<"new-message">;
    sid: z.ZodString;
    message: z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}>;
type UpdateNewMessageBody = z.infer<typeof UpdateNewMessageBodySchema>;
declare const UpdateSessionBodySchema: z.ZodObject<{
    t: z.ZodLiteral<"update-session">;
    id: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        value: string | null;
        version: number;
    }, {
        value: string | null;
        version: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}>;
type UpdateSessionBody = z.infer<typeof UpdateSessionBodySchema>;
declare const VersionedMachineEncryptedValueSchema: z.ZodObject<{
    version: z.ZodNumber;
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    version: number;
}, {
    value: string;
    version: number;
}>;
type VersionedMachineEncryptedValue = z.infer<typeof VersionedMachineEncryptedValueSchema>;
declare const UpdateMachineBodySchema: z.ZodObject<{
    t: z.ZodLiteral<"update-machine">;
    machineId: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    active: z.ZodOptional<z.ZodBoolean>;
    activeAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}>;
type UpdateMachineBody = z.infer<typeof UpdateMachineBodySchema>;
declare const CoreUpdateBodySchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"new-message">;
    sid: z.ZodString;
    message: z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"update-session">;
    id: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        value: string | null;
        version: number;
    }, {
        value: string | null;
        version: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"update-machine">;
    machineId: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    active: z.ZodOptional<z.ZodBoolean>;
    activeAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}>]>;
type CoreUpdateBody = z.infer<typeof CoreUpdateBodySchema>;
declare const CoreUpdateContainerSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    body: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
        t: z.ZodLiteral<"new-message">;
        sid: z.ZodString;
        message: z.ZodObject<{
            id: z.ZodString;
            seq: z.ZodNumber;
            localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            content: z.ZodObject<{
                c: z.ZodString;
                t: z.ZodLiteral<"encrypted">;
            }, "strip", z.ZodTypeAny, {
                c: string;
                t: "encrypted";
            }, {
                c: string;
                t: "encrypted";
            }>;
            createdAt: z.ZodNumber;
            updatedAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        }, {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    }, {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"update-session">;
        id: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            value: string | null;
            version: number;
        }, {
            value: string | null;
            version: number;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    }, {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"update-machine">;
        machineId: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        active: z.ZodOptional<z.ZodBoolean>;
        activeAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    }, {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    }>]>;
    createdAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    seq: number;
    createdAt: number;
    body: {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    } | {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    } | {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    };
}, {
    id: string;
    seq: number;
    createdAt: number;
    body: {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    } | {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    } | {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    };
}>;
type CoreUpdateContainer = z.infer<typeof CoreUpdateContainerSchema>;
declare const ApiMessageSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    content: z.ZodObject<{
        c: z.ZodString;
        t: z.ZodLiteral<"encrypted">;
    }, "strip", z.ZodTypeAny, {
        c: string;
        t: "encrypted";
    }, {
        c: string;
        t: "encrypted";
    }>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    seq: number;
    content: {
        c: string;
        t: "encrypted";
    };
    createdAt: number;
    updatedAt: number;
    localId?: string | null | undefined;
}, {
    id: string;
    seq: number;
    content: {
        c: string;
        t: "encrypted";
    };
    createdAt: number;
    updatedAt: number;
    localId?: string | null | undefined;
}>;
type ApiMessage = SessionMessage;
declare const ApiUpdateNewMessageSchema: z.ZodObject<{
    t: z.ZodLiteral<"new-message">;
    sid: z.ZodString;
    message: z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}>;
type ApiUpdateNewMessage = UpdateNewMessageBody;
declare const ApiUpdateSessionStateSchema: z.ZodObject<{
    t: z.ZodLiteral<"update-session">;
    id: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        value: string | null;
        version: number;
    }, {
        value: string | null;
        version: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}, {
    t: "update-session";
    id: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    agentState?: {
        value: string | null;
        version: number;
    } | null | undefined;
}>;
type ApiUpdateSessionState = UpdateSessionBody;
declare const ApiUpdateMachineStateSchema: z.ZodObject<{
    t: z.ZodLiteral<"update-machine">;
    machineId: z.ZodString;
    metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        version: z.ZodNumber;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        version: number;
    }, {
        value: string;
        version: number;
    }>>>;
    active: z.ZodOptional<z.ZodBoolean>;
    activeAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}, {
    t: "update-machine";
    machineId: string;
    metadata?: {
        value: string;
        version: number;
    } | null | undefined;
    daemonState?: {
        value: string;
        version: number;
    } | null | undefined;
    active?: boolean | undefined;
    activeAt?: number | undefined;
}>;
type ApiUpdateMachineState = UpdateMachineBody;
declare const UpdateBodySchema: z.ZodObject<{
    t: z.ZodLiteral<"new-message">;
    sid: z.ZodString;
    message: z.ZodObject<{
        id: z.ZodString;
        seq: z.ZodNumber;
        localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        content: z.ZodObject<{
            c: z.ZodString;
            t: z.ZodLiteral<"encrypted">;
        }, "strip", z.ZodTypeAny, {
            c: string;
            t: "encrypted";
        }, {
            c: string;
            t: "encrypted";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }, {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}, {
    t: "new-message";
    message: {
        id: string;
        seq: number;
        content: {
            c: string;
            t: "encrypted";
        };
        createdAt: number;
        updatedAt: number;
        localId?: string | null | undefined;
    };
    sid: string;
}>;
type UpdateBody = UpdateNewMessageBody;
declare const UpdateSchema: z.ZodObject<{
    id: z.ZodString;
    seq: z.ZodNumber;
    body: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
        t: z.ZodLiteral<"new-message">;
        sid: z.ZodString;
        message: z.ZodObject<{
            id: z.ZodString;
            seq: z.ZodNumber;
            localId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            content: z.ZodObject<{
                c: z.ZodString;
                t: z.ZodLiteral<"encrypted">;
            }, "strip", z.ZodTypeAny, {
                c: string;
                t: "encrypted";
            }, {
                c: string;
                t: "encrypted";
            }>;
            createdAt: z.ZodNumber;
            updatedAt: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        }, {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    }, {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"update-session">;
        id: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        agentState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            value: string | null;
            version: number;
        }, {
            value: string | null;
            version: number;
        }>>>;
    }, "strip", z.ZodTypeAny, {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    }, {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"update-machine">;
        machineId: z.ZodString;
        metadata: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        daemonState: z.ZodOptional<z.ZodNullable<z.ZodObject<{
            version: z.ZodNumber;
            value: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            version: number;
        }, {
            value: string;
            version: number;
        }>>>;
        active: z.ZodOptional<z.ZodBoolean>;
        activeAt: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    }, {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    }>]>;
    createdAt: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    seq: number;
    createdAt: number;
    body: {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    } | {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    } | {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    };
}, {
    id: string;
    seq: number;
    createdAt: number;
    body: {
        t: "new-message";
        message: {
            id: string;
            seq: number;
            content: {
                c: string;
                t: "encrypted";
            };
            createdAt: number;
            updatedAt: number;
            localId?: string | null | undefined;
        };
        sid: string;
    } | {
        t: "update-session";
        id: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        agentState?: {
            value: string | null;
            version: number;
        } | null | undefined;
    } | {
        t: "update-machine";
        machineId: string;
        metadata?: {
            value: string;
            version: number;
        } | null | undefined;
        daemonState?: {
            value: string;
            version: number;
        } | null | undefined;
        active?: boolean | undefined;
        activeAt?: number | undefined;
    };
}>;
type Update = CoreUpdateContainer;

declare const AttachmentRefSchema: z.ZodObject<{
    uploadId: z.ZodString;
    filename: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    mimeType: string;
    uploadId: string;
    filename: string;
    sizeBytes: number;
}, {
    mimeType: string;
    uploadId: string;
    filename: string;
    sizeBytes: number;
}>;
type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
declare const FileShareContentSchema: z.ZodObject<{
    type: z.ZodLiteral<"file_share">;
    uploadId: z.ZodString;
    filename: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
    description: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "file_share";
    mimeType: string;
    uploadId: string;
    filename: string;
    sizeBytes: number;
    description?: string | undefined;
}, {
    type: "file_share";
    mimeType: string;
    uploadId: string;
    filename: string;
    sizeBytes: number;
    description?: string | undefined;
}>;
type FileShareContent = z.infer<typeof FileShareContentSchema>;
declare const UserMessageSchema: z.ZodObject<{
    role: z.ZodLiteral<"user">;
    content: z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>;
    localKey: z.ZodOptional<z.ZodString>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }>>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        uploadId: z.ZodString;
        filename: z.ZodString;
        mimeType: z.ZodString;
        sizeBytes: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }, {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: "text";
        text: string;
    };
    role: "user";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
    localKey?: string | undefined;
    attachments?: {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }[] | undefined;
}, {
    content: {
        type: "text";
        text: string;
    };
    role: "user";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
    localKey?: string | undefined;
    attachments?: {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }[] | undefined;
}>;
type UserMessage = z.infer<typeof UserMessageSchema>;
declare const AgentMessageSchema: z.ZodObject<{
    role: z.ZodLiteral<"agent">;
    content: z.ZodObject<{
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}>;
type AgentMessage = z.infer<typeof AgentMessageSchema>;
declare const LegacyMessageContentSchema: z.ZodDiscriminatedUnion<"role", [z.ZodObject<{
    role: z.ZodLiteral<"user">;
    content: z.ZodObject<{
        type: z.ZodLiteral<"text">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "text";
        text: string;
    }, {
        type: "text";
        text: string;
    }>;
    localKey: z.ZodOptional<z.ZodString>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }>>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        uploadId: z.ZodString;
        filename: z.ZodString;
        mimeType: z.ZodString;
        sizeBytes: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }, {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: "text";
        text: string;
    };
    role: "user";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
    localKey?: string | undefined;
    attachments?: {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }[] | undefined;
}, {
    content: {
        type: "text";
        text: string;
    };
    role: "user";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
    localKey?: string | undefined;
    attachments?: {
        mimeType: string;
        uploadId: string;
        filename: string;
        sizeBytes: number;
    }[] | undefined;
}>, z.ZodObject<{
    role: z.ZodLiteral<"agent">;
    content: z.ZodObject<{
        type: z.ZodString;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        type: z.ZodString;
    }, z.ZodTypeAny, "passthrough">>;
    meta: z.ZodOptional<z.ZodObject<{
        sentFrom: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodEnum<["default", "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo", "yolo"]>>;
        model: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fallbackModel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        customSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        appendSystemPrompt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        allowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        disallowedTools: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString, "many">>>;
        displayText: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }, {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}, {
    content: {
        type: string;
    } & {
        [k: string]: unknown;
    };
    role: "agent";
    meta?: {
        sentFrom?: string | undefined;
        permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "read-only" | "safe-yolo" | "yolo" | undefined;
        model?: string | null | undefined;
        fallbackModel?: string | null | undefined;
        customSystemPrompt?: string | null | undefined;
        appendSystemPrompt?: string | null | undefined;
        allowedTools?: string[] | null | undefined;
        disallowedTools?: string[] | null | undefined;
        displayText?: string | undefined;
    } | undefined;
}>]>;
type LegacyMessageContent = z.infer<typeof LegacyMessageContentSchema>;

/**
 * ⚠️ UNDER REVIEW — LIKELY NEEDS MORE CAREFUL DESIGN
 *
 * This session protocol is not used in production and should NOT be used in dev
 * environments either until we revisit the design. The legacy protocol
 * (role: 'user' / role: 'agent') is the active code path everywhere.
 *
 * Before investing more here, look at how pi.dev standardizes their agent
 * protocol — we may want to align with or build on that approach instead of
 * rolling our own envelope format.
 *
 * Types are kept here for reference but are frozen. Do not add new consumers.
 */

declare const sessionRoleSchema: z.ZodEnum<["user", "agent"]>;
type SessionRole = z.infer<typeof sessionRoleSchema>;
declare const sessionTextEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"text">;
    text: z.ZodString;
    thinking: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    t: "text";
    text: string;
    thinking?: boolean | undefined;
}, {
    t: "text";
    text: string;
    thinking?: boolean | undefined;
}>;
declare const sessionServiceMessageEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"service">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "service";
    text: string;
}, {
    t: "service";
    text: string;
}>;
declare const sessionToolCallStartEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"tool-call-start">;
    call: z.ZodString;
    name: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    t: "tool-call-start";
    call: string;
    name: string;
    title: string;
    description: string;
    args: Record<string, unknown>;
}, {
    t: "tool-call-start";
    call: string;
    name: string;
    title: string;
    description: string;
    args: Record<string, unknown>;
}>;
declare const sessionToolCallEndEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"tool-call-end">;
    call: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "tool-call-end";
    call: string;
}, {
    t: "tool-call-end";
    call: string;
}>;
declare const sessionFileEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"file">;
    ref: z.ZodString;
    name: z.ZodString;
    size: z.ZodNumber;
    mimeType: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
        thumbhash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
        thumbhash: string;
    }, {
        width: number;
        height: number;
        thumbhash: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    t: "file";
    name: string;
    ref: string;
    size: number;
    mimeType?: string | undefined;
    image?: {
        width: number;
        height: number;
        thumbhash: string;
    } | undefined;
}, {
    t: "file";
    name: string;
    ref: string;
    size: number;
    mimeType?: string | undefined;
    image?: {
        width: number;
        height: number;
        thumbhash: string;
    } | undefined;
}>;
declare const sessionTurnStartEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"turn-start">;
}, "strip", z.ZodTypeAny, {
    t: "turn-start";
}, {
    t: "turn-start";
}>;
declare const sessionStartEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"start">;
    title: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    t: "start";
    title?: string | undefined;
}, {
    t: "start";
    title?: string | undefined;
}>;
declare const sessionTurnEndStatusSchema: z.ZodEnum<["completed", "failed", "cancelled"]>;
type SessionTurnEndStatus = z.infer<typeof sessionTurnEndStatusSchema>;
declare const sessionTurnEndEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"turn-end">;
    status: z.ZodEnum<["completed", "failed", "cancelled"]>;
}, "strip", z.ZodTypeAny, {
    t: "turn-end";
    status: "completed" | "failed" | "cancelled";
}, {
    t: "turn-end";
    status: "completed" | "failed" | "cancelled";
}>;
declare const sessionStopEventSchema: z.ZodObject<{
    t: z.ZodLiteral<"stop">;
}, "strip", z.ZodTypeAny, {
    t: "stop";
}, {
    t: "stop";
}>;
declare const sessionEventSchema: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
    t: z.ZodLiteral<"text">;
    text: z.ZodString;
    thinking: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    t: "text";
    text: string;
    thinking?: boolean | undefined;
}, {
    t: "text";
    text: string;
    thinking?: boolean | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"service">;
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "service";
    text: string;
}, {
    t: "service";
    text: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"tool-call-start">;
    call: z.ZodString;
    name: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    t: "tool-call-start";
    call: string;
    name: string;
    title: string;
    description: string;
    args: Record<string, unknown>;
}, {
    t: "tool-call-start";
    call: string;
    name: string;
    title: string;
    description: string;
    args: Record<string, unknown>;
}>, z.ZodObject<{
    t: z.ZodLiteral<"tool-call-end">;
    call: z.ZodString;
}, "strip", z.ZodTypeAny, {
    t: "tool-call-end";
    call: string;
}, {
    t: "tool-call-end";
    call: string;
}>, z.ZodObject<{
    t: z.ZodLiteral<"file">;
    ref: z.ZodString;
    name: z.ZodString;
    size: z.ZodNumber;
    mimeType: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodObject<{
        width: z.ZodNumber;
        height: z.ZodNumber;
        thumbhash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        width: number;
        height: number;
        thumbhash: string;
    }, {
        width: number;
        height: number;
        thumbhash: string;
    }>>;
}, "strip", z.ZodTypeAny, {
    t: "file";
    name: string;
    ref: string;
    size: number;
    mimeType?: string | undefined;
    image?: {
        width: number;
        height: number;
        thumbhash: string;
    } | undefined;
}, {
    t: "file";
    name: string;
    ref: string;
    size: number;
    mimeType?: string | undefined;
    image?: {
        width: number;
        height: number;
        thumbhash: string;
    } | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"turn-start">;
}, "strip", z.ZodTypeAny, {
    t: "turn-start";
}, {
    t: "turn-start";
}>, z.ZodObject<{
    t: z.ZodLiteral<"start">;
    title: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    t: "start";
    title?: string | undefined;
}, {
    t: "start";
    title?: string | undefined;
}>, z.ZodObject<{
    t: z.ZodLiteral<"turn-end">;
    status: z.ZodEnum<["completed", "failed", "cancelled"]>;
}, "strip", z.ZodTypeAny, {
    t: "turn-end";
    status: "completed" | "failed" | "cancelled";
}, {
    t: "turn-end";
    status: "completed" | "failed" | "cancelled";
}>, z.ZodObject<{
    t: z.ZodLiteral<"stop">;
}, "strip", z.ZodTypeAny, {
    t: "stop";
}, {
    t: "stop";
}>]>;
type SessionEvent = z.infer<typeof sessionEventSchema>;
declare const sessionEnvelopeSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodString;
    time: z.ZodNumber;
    role: z.ZodEnum<["user", "agent"]>;
    turn: z.ZodOptional<z.ZodString>;
    subagent: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    claudeUuid: z.ZodOptional<z.ZodString>;
    ev: z.ZodDiscriminatedUnion<"t", [z.ZodObject<{
        t: z.ZodLiteral<"text">;
        text: z.ZodString;
        thinking: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    }, {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"service">;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        t: "service";
        text: string;
    }, {
        t: "service";
        text: string;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"tool-call-start">;
        call: z.ZodString;
        name: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    }, "strip", z.ZodTypeAny, {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
    }, {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"tool-call-end">;
        call: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        t: "tool-call-end";
        call: string;
    }, {
        t: "tool-call-end";
        call: string;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"file">;
        ref: z.ZodString;
        name: z.ZodString;
        size: z.ZodNumber;
        mimeType: z.ZodOptional<z.ZodString>;
        image: z.ZodOptional<z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
            thumbhash: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            width: number;
            height: number;
            thumbhash: string;
        }, {
            width: number;
            height: number;
            thumbhash: string;
        }>>;
    }, "strip", z.ZodTypeAny, {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    }, {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"turn-start">;
    }, "strip", z.ZodTypeAny, {
        t: "turn-start";
    }, {
        t: "turn-start";
    }>, z.ZodObject<{
        t: z.ZodLiteral<"start">;
        title: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        t: "start";
        title?: string | undefined;
    }, {
        t: "start";
        title?: string | undefined;
    }>, z.ZodObject<{
        t: z.ZodLiteral<"turn-end">;
        status: z.ZodEnum<["completed", "failed", "cancelled"]>;
    }, "strip", z.ZodTypeAny, {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    }, {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    }>, z.ZodObject<{
        t: z.ZodLiteral<"stop">;
    }, "strip", z.ZodTypeAny, {
        t: "stop";
    }, {
        t: "stop";
    }>]>;
}, "strip", z.ZodTypeAny, {
    id: string;
    role: "user" | "agent";
    time: number;
    ev: {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    } | {
        t: "service";
        text: string;
    } | {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
    } | {
        t: "tool-call-end";
        call: string;
    } | {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    } | {
        t: "turn-start";
    } | {
        t: "start";
        title?: string | undefined;
    } | {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    } | {
        t: "stop";
    };
    turn?: string | undefined;
    subagent?: string | undefined;
    claudeUuid?: string | undefined;
}, {
    id: string;
    role: "user" | "agent";
    time: number;
    ev: {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    } | {
        t: "service";
        text: string;
    } | {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
    } | {
        t: "tool-call-end";
        call: string;
    } | {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    } | {
        t: "turn-start";
    } | {
        t: "start";
        title?: string | undefined;
    } | {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    } | {
        t: "stop";
    };
    turn?: string | undefined;
    subagent?: string | undefined;
    claudeUuid?: string | undefined;
}>, {
    id: string;
    role: "user" | "agent";
    time: number;
    ev: {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    } | {
        t: "service";
        text: string;
    } | {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
    } | {
        t: "tool-call-end";
        call: string;
    } | {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    } | {
        t: "turn-start";
    } | {
        t: "start";
        title?: string | undefined;
    } | {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    } | {
        t: "stop";
    };
    turn?: string | undefined;
    subagent?: string | undefined;
    claudeUuid?: string | undefined;
}, {
    id: string;
    role: "user" | "agent";
    time: number;
    ev: {
        t: "text";
        text: string;
        thinking?: boolean | undefined;
    } | {
        t: "service";
        text: string;
    } | {
        t: "tool-call-start";
        call: string;
        name: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
    } | {
        t: "tool-call-end";
        call: string;
    } | {
        t: "file";
        name: string;
        ref: string;
        size: number;
        mimeType?: string | undefined;
        image?: {
            width: number;
            height: number;
            thumbhash: string;
        } | undefined;
    } | {
        t: "turn-start";
    } | {
        t: "start";
        title?: string | undefined;
    } | {
        t: "turn-end";
        status: "completed" | "failed" | "cancelled";
    } | {
        t: "stop";
    };
    turn?: string | undefined;
    subagent?: string | undefined;
    claudeUuid?: string | undefined;
}>;
type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;
type CreateEnvelopeOptions = {
    id?: string;
    time?: number;
    turn?: string;
    subagent?: string;
    claudeUuid?: string;
};
declare function createEnvelope(role: SessionRole, ev: SessionEvent, opts?: CreateEnvelopeOptions): SessionEnvelope;

declare const VoiceConversationGrantedSchema: z.ZodObject<{
    allowed: z.ZodLiteral<true>;
    conversationToken: z.ZodString;
    conversationId: z.ZodString;
    agentId: z.ZodString;
    elevenUserId: z.ZodString;
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    allowed: true;
    conversationToken: string;
    conversationId: string;
    agentId: string;
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
}, {
    allowed: true;
    conversationToken: string;
    conversationId: string;
    agentId: string;
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
}>;
declare const VoiceConversationDeniedSchema: z.ZodObject<{
    allowed: z.ZodLiteral<false>;
    reason: z.ZodEnum<["voice_hard_limit_reached", "subscription_required", "voice_conversation_limit_reached"]>;
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
    agentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    allowed: false;
    agentId: string;
    usedSeconds: number;
    limitSeconds: number;
    reason: "voice_hard_limit_reached" | "subscription_required" | "voice_conversation_limit_reached";
}, {
    allowed: false;
    agentId: string;
    usedSeconds: number;
    limitSeconds: number;
    reason: "voice_hard_limit_reached" | "subscription_required" | "voice_conversation_limit_reached";
}>;
declare const VoiceConversationResponseSchema: z.ZodDiscriminatedUnion<"allowed", [z.ZodObject<{
    allowed: z.ZodLiteral<true>;
    conversationToken: z.ZodString;
    conversationId: z.ZodString;
    agentId: z.ZodString;
    elevenUserId: z.ZodString;
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    allowed: true;
    conversationToken: string;
    conversationId: string;
    agentId: string;
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
}, {
    allowed: true;
    conversationToken: string;
    conversationId: string;
    agentId: string;
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
}>, z.ZodObject<{
    allowed: z.ZodLiteral<false>;
    reason: z.ZodEnum<["voice_hard_limit_reached", "subscription_required", "voice_conversation_limit_reached"]>;
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
    agentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    allowed: false;
    agentId: string;
    usedSeconds: number;
    limitSeconds: number;
    reason: "voice_hard_limit_reached" | "subscription_required" | "voice_conversation_limit_reached";
}, {
    allowed: false;
    agentId: string;
    usedSeconds: number;
    limitSeconds: number;
    reason: "voice_hard_limit_reached" | "subscription_required" | "voice_conversation_limit_reached";
}>]>;
type VoiceConversationResponse = z.infer<typeof VoiceConversationResponseSchema>;
declare const VoiceUsageResponseSchema: z.ZodObject<{
    usedSeconds: z.ZodNumber;
    limitSeconds: z.ZodNumber;
    conversationCount: z.ZodNumber;
    conversationLimit: z.ZodNumber;
    elevenUserId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
    conversationCount: number;
    conversationLimit: number;
}, {
    elevenUserId: string;
    usedSeconds: number;
    limitSeconds: number;
    conversationCount: number;
    conversationLimit: number;
}>;
type VoiceUsageResponse = z.infer<typeof VoiceUsageResponseSchema>;

export { AgentMessageSchema, ApiMessageSchema, ApiUpdateMachineStateSchema, ApiUpdateNewMessageSchema, ApiUpdateSessionStateSchema, AttachmentRefSchema, CoreUpdateBodySchema, CoreUpdateContainerSchema, FileShareContentSchema, LegacyMessageContentSchema, MessageContentSchema, MessageMetaSchema, SessionMessageContentSchema, SessionMessageSchema, SessionProtocolMessageSchema, UpdateBodySchema, UpdateMachineBodySchema, UpdateNewMessageBodySchema, UpdateSchema, UpdateSessionBodySchema, UserMessageSchema, VersionedEncryptedValueSchema, VersionedMachineEncryptedValueSchema, VersionedNullableEncryptedValueSchema, VoiceConversationDeniedSchema, VoiceConversationGrantedSchema, VoiceConversationResponseSchema, VoiceUsageResponseSchema, createEnvelope, sessionEnvelopeSchema, sessionEventSchema, sessionFileEventSchema, sessionRoleSchema, sessionServiceMessageEventSchema, sessionStartEventSchema, sessionStopEventSchema, sessionTextEventSchema, sessionToolCallEndEventSchema, sessionToolCallStartEventSchema, sessionTurnEndEventSchema, sessionTurnEndStatusSchema, sessionTurnStartEventSchema };
export type { AgentMessage, ApiMessage, ApiUpdateMachineState, ApiUpdateNewMessage, ApiUpdateSessionState, AttachmentRef, CoreUpdateBody, CoreUpdateContainer, CreateEnvelopeOptions, FileShareContent, LegacyMessageContent, MessageContent, MessageMeta, SessionEnvelope, SessionEvent, SessionMessage, SessionMessageContent, SessionProtocolMessage, SessionRole, SessionTurnEndStatus, Update, UpdateBody, UpdateMachineBody, UpdateNewMessageBody, UpdateSessionBody, UserMessage, VersionedEncryptedValue, VersionedMachineEncryptedValue, VersionedNullableEncryptedValue, VoiceConversationResponse, VoiceUsageResponse };
