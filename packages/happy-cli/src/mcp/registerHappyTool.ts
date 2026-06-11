/**
 * Type-safe wrapper for McpServer.registerTool that works with Zod v4.
 *
 * MCP SDK 1.29.x + Zod v4 triggers TS2589 (type instantiation excessively deep)
 * in registerTool's generic SchemaOutput<S> conditional type, which attempts
 * structural comparison of Zod v3 and v4 types. This helper bypasses that path
 * by using z.infer<T[K]> directly (Zod v4 native inference).
 *
 * The single `as any` cast is intentionally isolated here. All call sites
 * retain full type safety: args is inferred from inputSchema automatically.
 *
 * Migration: if @modelcontextprotocol/sdk fixes the Zod v4 TS2589 in a future
 * release, delete this file and replace registerHappyTool(...) calls with
 * server.registerTool(...) at each call site.
 *
 * Committee: APPROVED-WITH-CAVEATS 2026-06-11
 * Caveats:
 *   1. If outputSchema is ever needed, add it to the config type here — do NOT
 *      bypass this helper and call server.registerTool directly.
 *   2. On every @modelcontextprotocol/sdk upgrade, verify the as any cast
 *      below is still necessary before removing it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

type ZodShape = Record<string, z.ZodType>;
type InferShape<T extends ZodShape> = { [K in keyof T]: z.infer<T[K]> };

/**
 * Register a tool on an McpServer with type-safe args inference.
 *
 * Usage is identical to `server.registerTool(name, config, handler)` but
 * the handler's `args` parameter is correctly inferred from `inputSchema`
 * without triggering TS2589.
 */
export function registerHappyTool<T extends ZodShape>(
    server: McpServer,
    name: string,
    config: {
        title?: string;
        description?: string;
        inputSchema: T;
        annotations?: ToolAnnotations;
    },
    handler: (args: InferShape<T>) => CallToolResult | Promise<CallToolResult>,
): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server.registerTool as any)(name, config, handler);
}
