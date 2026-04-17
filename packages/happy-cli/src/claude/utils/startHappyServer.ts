/**
 * Happy MCP server
 * Provides Happy CLI specific tools including chat session title management
 * and file sharing (CLI → App direction).
 *
 * Uses stateless StreamableHTTP: each request gets a fresh McpServer + transport.
 * This is required by MCP SDK >=1.27 which rejects reuse of an already-connected transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { encryptFileBlob, encryptFileMeta } from "@/modules/fileTransfer/fileEncryption";
import { filesApiClient } from "@/modules/fileTransfer/filesApiClient";

const MIME_BY_EXT: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
};

function mimeTypeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_BY_EXT[ext] ?? 'text/plain';
}

interface ShareFileHandler {
    (args: { path: string; description?: string }): Promise<{ success: boolean; error?: string }>;
}

function createMcpServer(
    changeTitleHandler: (title: string) => Promise<{ success: boolean; error?: string }>,
    shareFileHandler: ShareFileHandler,
): McpServer {
    const mcp = new McpServer({
        name: "Happy MCP",
        version: "1.0.0",
    });

    mcp.registerTool('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: {
            title: z.string().describe('The new title for the chat session'),
        },
    }, async (args) => {
        const response = await changeTitleHandler(args.title);
        logger.debug('[happyMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool('share_file', {
        description: 'Send a file to the mobile user viewing this session. Use when you want the user to receive a file output (image, document, etc.).',
        title: 'Share File',
        inputSchema: {
            path: z.string().describe('Absolute path to the file to send'),
            description: z.string().optional().describe('Optional description to show the user'),
        },
    }, async (args) => {
        const response = await shareFileHandler(args);
        logger.debug('[happyMCP] share_file response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `File sent successfully to the mobile user.`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to send file: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    return mcp;
}

export async function startHappyServer(client: ApiSessionClient) {
    logger.debug(`[happyMCP] server:start sessionId=${client.sessionId}`);

    const changeTitleHandler = async (title: string) => {
        logger.debug('[happyMCP] Changing title to:', title);
        try {
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    const shareFileHandler: ShareFileHandler = async (args) => {
        try {
            const bytes = await fs.readFile(args.path);
            const mimeType = mimeTypeFromPath(args.path);
            const filename = path.basename(args.path);
            const uploadId = 'f' + randomUUID().replace(/-/g, '').substring(0, 24);

            const { encryptedBlob, nonce } = encryptFileBlob(new Uint8Array(bytes), client.encryptionKey);
            const { encryptedMeta, metaNonce } = encryptFileMeta(
                { filename, mimeType, sizeBytes: bytes.length },
                client.encryptionKey,
            );

            await filesApiClient.post(client.token, {
                uploadId,
                encryptedBlob,
                nonce,
                encryptedMeta,
                metaNonce,
                mimeType,
                sizeBytes: bytes.length,
                sessionId: client.sessionId,
                direction: 'cli_to_app',
            });

            client.sendFileShareMessage({
                uploadId,
                filename,
                mimeType,
                sizeBytes: bytes.length,
                description: args.description,
            });

            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    const server = createServer(async (req, res) => {
        const mcp = createMcpServer(changeTitleHandler, shareFileHandler);
        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined
            });
            await mcp.connect(transport);
            await transport.handleRequest(req, res);
            res.on('close', () => {
                transport.close();
                mcp.close();
            });
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
            mcp.close();
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    logger.debug(`[happyMCP] server:ready sessionId=${client.sessionId} url=${baseUrl.toString()}`);

    return {
        url: baseUrl.toString(),
        toolNames: ['change_title', 'share_file'],
        stop: () => {
            logger.debug(`[happyMCP] server:stop sessionId=${client.sessionId}`);
            server.close();
        }
    }
}
