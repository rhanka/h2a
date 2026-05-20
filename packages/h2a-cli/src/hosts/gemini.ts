import type { H2AHostDescriptor } from "./codex.js";

/**
 * Gemini is deferred to wave 2 (DEC-028). The descriptor is shipped so
 * `h2a hosts` still surfaces the host, but no `renderMcpConfig` is
 * provided yet — `h2a host setup --host gemini` is intentionally refused
 * until a wave-2 DEC promotes Gemini.
 */
export const H2A_GEMINI_HOST: H2AHostDescriptor = {
  packageName: "@sentropic/h2a-cli",
  corePackageName: "@sentropic/h2a",
  host: "gemini",
  protocol: "sentropic.h2a",
  wave: 2
} as const;
