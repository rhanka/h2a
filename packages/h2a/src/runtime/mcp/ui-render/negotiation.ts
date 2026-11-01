/**
 * SEP-1865 UI extension negotiation (h2a spec §2.1; DS spec §8.1): a client
 * has negotiated `io.modelcontextprotocol/ui` if and only if its `initialize`
 * params advertise a non-null `capabilities.extensions["io.modelcontextprotocol/ui"]`
 * object whose `mimeTypes` array contains the MCP App resource mime type.
 * The server ALWAYS advertises the extension back so hosts probing server
 * support discover it, while recording `negotiated` per session so `render`
 * emits the non-UI fallback alongside `structuredContent` when the client
 * did not negotiate it.
 */

import { UI_MIME_TYPE, type UiExtensionCapability } from "./types.js";

/** The capability every h2a MCP `initialize` response advertises (§2.1.3). */
export const serverUiExtensionCapability: Readonly<{ mimeTypes: readonly string[] }> = {
  mimeTypes: [UI_MIME_TYPE]
};

/** Reads the client's advertised ui extension, if any, from initialize params. */
function clientUiExtension(params: unknown): unknown {
  if (params === null || typeof params !== "object") return undefined;
  const capabilities = (params as { capabilities?: unknown }).capabilities;
  if (capabilities === null || typeof capabilities !== "object") return undefined;
  const extensions = (capabilities as { extensions?: unknown }).extensions;
  if (extensions === null || typeof extensions !== "object") return undefined;
  return (extensions as Record<string, unknown>)["io.modelcontextprotocol/ui"];
}

/**
 * Negotiates the SEP-1865 UI capability from one connection's `initialize`
 * params: `negotiated === true` only for a non-null ui extension object
 * advertising `text/html;profile=mcp-app`; the served mime types stay the
 * closed one-element list either way.
 */
export function negotiateUiExtension(params: unknown): UiExtensionCapability {
  const extension = clientUiExtension(params);
  if (extension === null || typeof extension !== "object") {
    return { negotiated: false, mimeTypes: [] };
  }
  const mimeTypes = (extension as { mimeTypes?: unknown }).mimeTypes;
  if (!Array.isArray(mimeTypes) || !mimeTypes.includes(UI_MIME_TYPE)) {
    return { negotiated: false, mimeTypes: [] };
  }
  return { negotiated: true, mimeTypes: [UI_MIME_TYPE] };
}
