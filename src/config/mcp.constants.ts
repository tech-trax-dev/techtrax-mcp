/**
 * MCP server identity. Read at module-load time (before ConfigModule loads
 * `.env`), so these resolve from a real process env var or the default.
 *
 * Both `McpModule.forRoot({ name })` and every namespace's
 * `McpModule.forFeature([...], MCP_SERVER_NAME)` MUST use the same name, or
 * forFeature tools won't bind to the server. Sharing this constant guarantees
 * they stay identical.
 */
export const MCP_SERVER_NAME = process.env.MCP_SERVER_NAME ?? 'techtrax-mcp';
export const MCP_SERVER_VERSION = process.env.MCP_SERVER_VERSION ?? '1.0.0';
