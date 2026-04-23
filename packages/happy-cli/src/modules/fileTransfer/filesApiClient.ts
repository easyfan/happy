/**
 * HTTP client for /v1/uploads endpoints.
 * Wraps GET, POST, DELETE, and pending-list calls to the Happy server.
 */

import axios from 'axios';
import { configuration } from '@/configuration';

export interface PendingUploadEntry {
    uploadId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
}

export interface UploadGetResponse {
    encryptedBlob: string;
    nonce: string;
    encryptedMeta: string;
    metaNonce: string;
    direction: 'app_to_cli' | 'cli_to_app';
}

export interface UploadCreateParams {
    uploadId: string;
    encryptedBlob: string;
    nonce: string;
    encryptedMeta: string;
    metaNonce: string;
    mimeType: string;
    sizeBytes: number;
    sessionId: string;
    direction: 'app_to_cli' | 'cli_to_app';
}

export const filesApiClient = {
    /**
     * GET /v1/uploads/:uploadId?sessionId=<sessionId>
     * Returns encrypted blob + nonces + meta, or null if not found / expired.
     */
    async get(
        token: string,
        uploadId: string,
        sessionId: string,
    ): Promise<UploadGetResponse | null> {
        try {
            const response = await axios.get<UploadGetResponse>(
                `${configuration.serverUrl}/v1/uploads/${encodeURIComponent(uploadId)}`,
                {
                    params: { sessionId },
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 30000,
                },
            );
            return response.data;
        } catch (err: any) {
            if (err.response?.status === 404) {
                return null;
            }
            throw err;
        }
    },

    /**
     * POST /v1/uploads — upload an encrypted blob (idempotent by uploadId).
     */
    async post(
        token: string,
        params: UploadCreateParams,
    ): Promise<void> {
        await axios.post(
            `${configuration.serverUrl}/v1/uploads`,
            params,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60000,
            },
        );
    },

    /**
     * DELETE /v1/uploads/:uploadId — consume confirmation (idempotent).
     */
    async delete(
        token: string,
        uploadId: string,
    ): Promise<void> {
        await axios.delete(
            `${configuration.serverUrl}/v1/uploads/${encodeURIComponent(uploadId)}`,
            {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 15000,
            },
        );
    },

    /**
     * GET /v1/uploads/pending?sessionId=<sessionId>
     * Returns list of uploads that arrived while the CLI was offline.
     */
    async pending(
        token: string,
        sessionId: string,
    ): Promise<PendingUploadEntry[]> {
        const response = await axios.get<{ uploads: PendingUploadEntry[] }>(
            `${configuration.serverUrl}/v1/uploads/pending`,
            {
                params: { sessionId },
                headers: { Authorization: `Bearer ${token}` },
                timeout: 15000,
            },
        );
        return response.data.uploads ?? [];
    },
};
