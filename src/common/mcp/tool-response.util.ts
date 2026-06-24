/**
 * Helpers that build spec-valid MCP tool results. Every tool handler returns
 * one of these so the wire shape (`content[]` + optional `isError`) is
 * consistent across all namespaces.
 */

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  /**
   * Typed payload mirroring the tool's `outputSchema`. Present on successful
   * results so MCP clients get structured data alongside the text block.
   */
  structuredContent?: unknown;
  isError?: boolean;
}

/** Serialise any JSON-able payload into a single text content block. */
export const jsonResult = (data: unknown): McpToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

/** Return plain text as a tool result. */
export const textResult = (text: string): McpToolResult => ({
  content: [{ type: 'text', text }],
});

/** Return an error result the model can read without a thrown HTTP stack. */
export const errorResult = (message: string): McpToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});
