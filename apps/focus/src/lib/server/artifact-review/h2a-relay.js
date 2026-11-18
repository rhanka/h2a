// The signed transport of sendToAgent: the h2a CLI `send` verb, run the way every Focus route runs h2a
// (the binary resolved by `h2a-bus.ts`, `--root` = the root the recipient reads).
//
// Signer: a dedicated relay identity, never the owner and never the recipient (spec Q2-A). It is a
// TRANSPORT signer only; it authors no comment. Default instance `focus:artifact-review:<hash12(repo)>`.
// When it is not registered in the recipient's root, it is provisioned once through the same CLI
// (`keys generate` then `register`, both in that root) and the send is retried once. An operator can
// instead pin a pre-provisioned identity with FOCUS_REVIEW_RELAY; a pinned identity is never provisioned.
// The private key is written by h2a itself under `<root>/keys` (mode 0600); this module never reads it.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const RELAY_PREFIX = 'focus:artifact-review:';

/**
 * @param {string} repoRoot
 * @returns {string}
 */
export function defaultRelayInstance(repoRoot) {
  return `${RELAY_PREFIX}${createHash('sha256').update(String(repoRoot)).digest('hex').slice(0, 12)}`;
}

/**
 * @typedef {(file: string, args: string[], options: { cwd?: string, timeout?: number, maxBuffer?: number },
 *   callback: (error: (Error & { code?: unknown, killed?: boolean }) | null, stdout: string, stderr: string) => void) => unknown} ExecFileLike
 */

/**
 * Run a child and always resolve. The reason of a failure is the child's stderr, or a short cause for a
 * spawn error or a timeout — never `error.message`, which repeats the whole command line (message text
 * included).
 * @param {ExecFileLike} execFileImpl
 * @param {string} file
 * @param {string[]} args
 * @param {{ cwd?: string, timeout: number }} options
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(execFileImpl, file, args, options) {
  return new Promise((resolve) => {
    execFileImpl(
      file,
      args,
      { cwd: options.cwd, timeout: options.timeout, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
          return;
        }
        let reason = String(stderr ?? '');
        if (!reason.trim()) {
          reason = error.killed
            ? `timed out after ${options.timeout} ms`
            : typeof error.code === 'string'
              ? `could not start (${error.code})`
              : 'failed without a message';
        }
        resolve({ code: typeof error.code === 'number' ? error.code : 1, stdout: String(stdout ?? ''), stderr: reason });
      }
    );
  });
}

/**
 * @param {string} stderr
 * @param {number} code
 */
function firstLine(stderr, code) {
  const line = stderr
    .split('\n')
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? `exit code ${code}`;
}

/**
 * @param {{
 *   getBin: () => string | undefined,
 *   cwd?: string,
 *   relay: string,
 *   autoProvision?: boolean,
 *   nodePath?: string,
 *   execFileImpl?: ExecFileLike,
 *   timeoutMs?: number,
 *   now?: () => Date
 * }} options
 */
export function createH2aSender({
  getBin,
  cwd,
  relay,
  autoProvision = true,
  nodePath = process.execPath,
  execFileImpl = /** @type {ExecFileLike} */ (/** @type {unknown} */ (execFile)),
  timeoutMs = 20000,
  now = () => new Date()
}) {
  /**
   * @param {string} bin
   * @param {string[]} args
   */
  const h2a = (bin, args) => run(execFileImpl, nodePath, [bin, ...args], { cwd, timeout: timeoutMs });

  /**
   * @param {string} bin
   * @param {string} root
   */
  async function provision(bin, root) {
    const keys = await h2a(bin, ['keys', 'generate', '--instance', relay, '--root', root]);
    if (keys.code !== 0) {
      throw new Error(`could not provision the relay identity ${relay}: ${firstLine(keys.stderr, keys.code)}`);
    }
    /** @type {string | undefined} */
    let publicKeyPem;
    try {
      publicKeyPem = JSON.parse(keys.stdout).publicKeyPem;
    } catch {
      publicKeyPem = undefined;
    }
    if (typeof publicKeyPem !== 'string' || !publicKeyPem.includes('PUBLIC KEY')) {
      throw new Error(`could not provision the relay identity ${relay}: the key generator returned no public key`);
    }
    const registration = {
      id: relay,
      instance: relay,
      name: 'Focus artifact review relay',
      roles: ['AGENTS'],
      scopes: ['scope:default'],
      capabilities: [],
      endpoints: [{ kind: 'local-files', uri: pathToFileURL(root).href }],
      publicKeys: [publicKeyPem],
      acceptedPolicies: [],
      createdAt: now().toISOString()
    };
    const registered = await h2a(bin, ['register', '--json', JSON.stringify(registration), '--root', root]);
    if (registered.code !== 0) {
      throw new Error(`could not register the relay identity ${relay}: ${firstLine(registered.stderr, registered.code)}`);
    }
  }

  /**
   * @param {string} bin
   * @param {string} root
   */
  async function isRegistered(bin, root) {
    const listed = await h2a(bin, ['discover', '--root', root]);
    if (listed.code !== 0) {
      throw new Error(`could not read the h2a registry of ${root}: ${firstLine(listed.stderr, listed.code)}`);
    }
    /** @type {unknown} */
    let entries;
    try {
      entries = JSON.parse(listed.stdout);
    } catch {
      throw new Error(`could not read the h2a registry of ${root}: discover returned no JSON`);
    }
    return (
      Array.isArray(entries) &&
      entries.some((entry) => entry && typeof entry === 'object' && (entry.instance === relay || entry.id === relay))
    );
  }

  /**
   * @param {{ target: string, targetRoot?: string, text: string }} input
   * @returns {Promise<import('./types').SendResult>}
   */
  async function send({ target, targetRoot, text }) {
    const bin = getBin();
    if (!bin) throw new Error('no h2a binary is available');
    if (!targetRoot) throw new Error(`the h2a root of ${target} is unknown; refusing to deposit into a default root`);
    const args = ['send', target, text, '--from', relay, '--root', targetRoot];
    let result = await h2a(bin, args);
    // `send` reads the signer key before it checks the registration, so a relay that was never provisioned
    // in this root shows up as either message. Provision only when the registry confirms it is absent: a
    // registered relay whose key is missing must not get a new key behind its registered public key.
    const missingRelay = /sender is not registered|cannot read the local private key/.test(result.stderr);
    if (result.code !== 0 && autoProvision && missingRelay) {
      if (await isRegistered(bin, targetRoot)) {
        throw new Error(
          `the relay identity ${relay} is registered in ${targetRoot} but cannot sign (${firstLine(result.stderr, result.code)}); ` +
            'pin a working identity with FOCUS_REVIEW_RELAY'
        );
      }
      await provision(bin, targetRoot);
      result = await h2a(bin, args);
    }
    if (result.code !== 0) throw new Error(firstLine(result.stderr, result.code));
    /** @type {any} */
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error('h2a send returned no JSON result; the delivery cannot be confirmed');
    }
    return {
      recipient: typeof parsed.recipient === 'string' ? parsed.recipient : undefined,
      recipientLive: Boolean(parsed.recipientLive),
      dormant: Boolean(parsed.dormant),
      envelopeId: typeof parsed.envelope?.id === 'string' ? parsed.envelope.id : undefined,
      relay
    };
  }

  return { relay, send };
}
