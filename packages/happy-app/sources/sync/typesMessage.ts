import { AgentEvent } from "./typesRaw";
import { MessageMeta } from "./typesMessageMeta";

/**
 * Attachment reference stored in a UserTextMessage.
 * Defined here (App layer) to avoid a build-time dependency on happy-wire.
 * Matches the AttachmentRefSchema shape in happy-wire.
 */
export type AttachmentRef = {
    uploadId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
};

/**
 * FileShare message — produced by the reducer when an agent message with
 * content.type === 'file_share' is received (CC → App direction).
 */
export type FileShareMessage = {
    kind: 'file-share';
    id: string;
    localId: string | null;
    createdAt: number;
    uploadId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    description?: string;
    meta?: MessageMeta;
};

export type ToolCall = {
    name: string;
    state: 'running' | 'completed' | 'error';
    input: any;
    createdAt: number;
    startedAt: number | null;
    completedAt: number | null;
    description: string | null;
    result?: any;
    permission?: {
        id: string;
        status: 'pending' | 'approved' | 'denied' | 'canceled';
        reason?: string;
        mode?: string;
        allowedTools?: string[];
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
        date?: number;
    };
}

// Flattened message types - each message represents a single block
export type UserTextMessage = {
    kind: 'user-text';
    id: string;
    localId: string | null;
    createdAt: number;
    text: string;
    displayText?: string; // Optional text to display in UI instead of actual text
    meta?: MessageMeta;
    /** Attachments sent with this message (App → CLI direction, optional) */
    attachments?: AttachmentRef[];
}

export type ModeSwitchMessage = {
    kind: 'agent-event';
    id: string;
    createdAt: number;
    event: AgentEvent;
    meta?: MessageMeta;
}

export type AgentTextMessage = {
    kind: 'agent-text';
    id: string;
    localId: string | null;
    createdAt: number;
    text: string;
    isThinking?: boolean;
    meta?: MessageMeta;
}

export type ToolCallMessage = {
    kind: 'tool-call';
    id: string;
    localId: string | null;
    createdAt: number;
    tool: ToolCall;
    children: Message[];
    meta?: MessageMeta;
}

export type Message = UserTextMessage | AgentTextMessage | ToolCallMessage | ModeSwitchMessage | FileShareMessage;