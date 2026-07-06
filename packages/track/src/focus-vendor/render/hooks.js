/**
 * Host-supplied render hooks (Focus-M1 L1).
 *
 * Per SPEC_VOL_FOCUS §4 (M0 constraint #2): markdown is rendered by INJECTION — the host
 * supplies the markdown→HTML conversion (e.g. `marked`). The focus package carries NO `marked`
 * dependency and NO mdast/rehype core. HTML is sanitized via a host-supplied hook; the renderer
 * core owns structure only, hosts own sanitization/styling.
 */
export {};
