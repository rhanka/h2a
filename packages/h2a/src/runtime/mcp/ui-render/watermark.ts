/**
 * W3/W4 server-side watermark gate (DS spec §6.5 & §13.4; h2a spec §6):
 * `SENTROPIC_BPMN_WATERMARK_LICENSE` is a server-side secret/entitlement
 * gate that never reaches the browser, any output, or any tracked file;
 * only the distinct, non-secret `SENTROPIC_BPMN_WATERMARK_REFERENCE` may be
 * written into `hostConfig.bpmn.watermark.license` inside the resource
 * HTML's `#st-host-config` block — and only when the license gate is
 * non-blank. Absent or blank: no `bpmn.watermark` option is written, and
 * the bpmn.io watermark stays visible (W1, W3).
 *
 * This module is the ONLY reader of the license variable (h2a spec §6.1);
 * every other file must stay free of literal watermark assignments.
 */

export interface UiResourceHostConfig {
  readonly theme: string;
  readonly colorScheme: "light" | "dark";
  readonly locale: string;
  readonly assetBase: string;
  readonly bpmn?: {
    readonly watermark?: {
      readonly license: string;
    };
  };
}

export function buildResourceHostConfig(
  env: Record<string, string | undefined> = process.env,
  options?: {
    readonly theme?: string;
    readonly colorScheme?: "light" | "dark";
    readonly locale?: string;
    readonly assetBase?: string;
  }
): UiResourceHostConfig {
  const base: UiResourceHostConfig = {
    theme: options?.theme ?? (env["H2A_UI_THEME"]?.trim() || "sent-tech"),
    colorScheme: options?.colorScheme ?? (env["H2A_UI_COLOR_SCHEME"] === "dark" ? "dark" : "light"),
    locale: options?.locale ?? (env["H2A_UI_LOCALE"]?.trim() || "fr"),
    assetBase:
      options?.assetBase ??
      "https://cdn.jsdelivr.net/npm/@sentropic/bpmn-canvas@0.3.0/dist/assets/",
  };

  const secretGate = env["SENTROPIC_BPMN_WATERMARK_LICENSE"]?.trim();
  const publicReference = env["SENTROPIC_BPMN_WATERMARK_REFERENCE"]?.trim();

  if (secretGate && secretGate.length > 0 && publicReference && publicReference.length > 0) {
    // W3/W4 misconfiguration guard: if the operator accidentally sets
    // SENTROPIC_BPMN_WATERMARK_REFERENCE equal to SENTROPIC_BPMN_WATERMARK_LICENSE,
    // refuse to emit it so the secret cannot leak into #st-host-config.
    if (publicReference === secretGate) {
      return base;
    }
    return {
      ...base,
      bpmn: {
        watermark: {
          license: publicReference,
        },
      },
    };
  }
  return base;
}

/**
 * Serializes the host config into the resource HTML's
 * `<script type="application/json" id="st-host-config">` block (DS §6.5),
 * escaping `<` as `\u003c` so no config value can close the script element
 * early (the block is parsed as JSON, where `\u003c` is the same character).
 */
export function serializeHostConfigScript(config: UiResourceHostConfig): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<script type="application/json" id="st-host-config">${json}</script>`;
}
