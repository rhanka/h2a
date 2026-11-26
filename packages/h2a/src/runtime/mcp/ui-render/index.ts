/**
 * The ui:// render module composition root (h2a spec §4.2, §7.2): binds the
 * verified asset set to the envelope validator, the `ui://` resource
 * handlers and the render tool surface so an MCP transport can compose them
 * behind one seam. The load is synchronous on purpose — the transports
 * compose the module inside their own synchronous boot (the stdio readiness
 * ACK is on disk before `runMcpStdio` returns) and `resources/read` is a
 * synchronous handler. A transport whose load fails (e.g. an
 * `integrity_mismatch`) degrades to a server without the ui:// resource and
 * tool surface rather than failing whole (§7.2).
 */

import { loadUiRenderAssets, loadUiRenderAssetsSync, type UiRenderAssets } from "./assets.js";
import {
  createUiRenderValidator,
  createUiRenderValidatorAsync,
  type UiRenderValidator
} from "./validation.js";
import {
  createUiRenderResources,
  type CreateUiRenderResourcesOptions,
  type UiRenderResources
} from "./resources.js";
import {
  createUiRenderTools,
  type UiRenderIntentConsumer,
  type UiRenderTools
} from "./tools.js";

/** Shared immutable verified assets + compiled validator reusable across attachments. */
export interface UiRenderCore {
  readonly assets: UiRenderAssets;
  readonly validator: UiRenderValidator;
}

/** Options of `createUiRenderModule`. */
export interface CreateUiRenderModuleOptions {
  /**
   * A pre-verified asset set; when omitted the module loads and verifies the
   * vendored snapshot itself (`loadUiRenderAssetsSync`).
   */
  readonly assets?: UiRenderAssets;
  /**
   * Pre-verified assets + validator core (`createUiRenderCoreAsync`), avoiding
   * re-hashing vendored files and reloading Ajv/Focus per central attachment.
   */
  readonly core?: UiRenderCore;
  /**
   * The environment the resource builder reads (theme, locale, watermark
   * gate); defaults to `process.env` (live reference).
   */
  readonly env?: Record<string, string | undefined>;
  /**
   * The server-configured intent consumer `submit_intent` forwards to (DS
   * spec §8.2 & §11.2 criterion 4); the future decision-inject seam.
   */
  readonly onIntent?: UiRenderIntentConsumer;
  /**
   * The envelope-echo threshold of `render` (§5.2); defaults to the h2a
   * frame ceiling minus 16 KiB until L3.5 fixes it from host measurement.
   */
  readonly inlineLimitBytes?: number;
}

/** The composed ui:// render module served behind the MCP transports. */
export interface UiRenderModule {
  readonly assets: UiRenderAssets;
  readonly validator: UiRenderValidator;
  readonly resources: UiRenderResources;
  readonly tools: UiRenderTools;
}

/** Asynchronously verifies vendored assets and prepares a reusable validator core. */
export async function createUiRenderCoreAsync(): Promise<UiRenderCore> {
  const assets = await loadUiRenderAssets();
  await new Promise<void>(resolve => setImmediate(resolve));
  const validator = await createUiRenderValidatorAsync({ assets });
  return { assets, validator };
}

/**
 * Loads and verifies the vendored DS elements build (unless `core` or `assets`
 * is supplied) and binds the validator, resource handlers and per-connection tools.
 */
export function createUiRenderModule(
  options?: CreateUiRenderModuleOptions
): UiRenderModule {
  const assets = options?.core?.assets ?? options?.assets ?? loadUiRenderAssetsSync();
  const validator = options?.core?.validator ?? createUiRenderValidator({ assets });
  const resourceOptions: CreateUiRenderResourcesOptions =
    options?.env !== undefined ? { assets, env: options.env } : { assets };
  return {
    assets,
    validator,
    resources: createUiRenderResources(resourceOptions),
    tools: createUiRenderTools({
      assets,
      validator,
      ...(options?.onIntent !== undefined ? { onIntent: options.onIntent } : {}),
      ...(options?.inlineLimitBytes !== undefined
        ? { inlineLimitBytes: options.inlineLimitBytes }
        : {})
    })
  };
}
