/**
 * The ui:// render module composition root (h2a spec §4.2, §7.2): binds the
 * verified asset set to the envelope validator and the `ui://` resource
 * handlers so an MCP transport can compose them behind one seam. The load
 * is synchronous on purpose — the transports compose the module inside
 * their own synchronous boot (the stdio readiness ACK is on disk before
 * `runMcpStdio` returns) and `resources/read` is a synchronous handler. A
 * transport whose load fails (e.g. an `integrity_mismatch`) degrades to a
 * server without the ui:// resource surface rather than failing whole (§7.2).
 */

import { loadUiRenderAssetsSync, type UiRenderAssets } from "./assets.js";
import { createUiRenderValidator, type UiRenderValidator } from "./validation.js";
import {
  createUiRenderResources,
  type CreateUiRenderResourcesOptions,
  type UiRenderResources
} from "./resources.js";

/** Options of `createUiRenderModule`. */
export interface CreateUiRenderModuleOptions {
  /**
   * A pre-verified asset set; when omitted the module loads and verifies the
   * vendored snapshot itself (`loadUiRenderAssetsSync`).
   */
  readonly assets?: UiRenderAssets;
  /**
   * The environment the resource builder reads (theme, locale, watermark
   * gate); defaults to `process.env` (live reference).
   */
  readonly env?: Record<string, string | undefined>;
}

/** The composed ui:// render module served behind the MCP transports. */
export interface UiRenderModule {
  readonly assets: UiRenderAssets;
  readonly validator: UiRenderValidator;
  readonly resources: UiRenderResources;
}

/**
 * Loads and verifies the vendored DS elements build (unless `assets` is
 * supplied) and binds the validator and resource handlers to it.
 */
export function createUiRenderModule(
  options?: CreateUiRenderModuleOptions
): UiRenderModule {
  const assets = options?.assets ?? loadUiRenderAssetsSync();
  const resourceOptions: CreateUiRenderResourcesOptions =
    options?.env !== undefined ? { assets, env: options.env } : { assets };
  return {
    assets,
    validator: createUiRenderValidator({ assets }),
    resources: createUiRenderResources(resourceOptions)
  };
}
