import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir, userInfo } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWED_ENV_VARS,
  buildIsolatedEnvironment,
  cleanClaudeRunSandbox,
  createClaudeRunSandbox,
  resolvePrivateRuntimeRoot,
  recordChildPidInSandbox,
  verifyCredentialNotRewritten,
} from "./claude-code-cli-isolation.js";

const TEST_SCRATCH = join(tmpdir(), "h2a-claude-isolation-test-" + Date.now());

let savedXdgRuntime: string | undefined;
let savedHome: string | undefined;
let savedH2aRoot: string | undefined;

beforeEach(() => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
  savedXdgRuntime = process.env.XDG_RUNTIME_DIR;
  savedHome = process.env.HOME;
  savedH2aRoot = process.env.H2A_ROOT;
  const tempRuntime = join(TEST_SCRATCH, "run");
  mkdirSync(tempRuntime, { recursive: true, mode: 0o700 });
  process.env.XDG_RUNTIME_DIR = tempRuntime;
  process.env.HOME = join(TEST_SCRATCH, "home");
  process.env.H2A_ROOT = join(TEST_SCRATCH, "h2a-root");
});

afterEach(() => {
  if (savedXdgRuntime === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = savedXdgRuntime;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedH2aRoot === undefined) delete process.env.H2A_ROOT;
  else process.env.H2A_ROOT = savedH2aRoot;
  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});

describe("claude-code-cli-isolation", () => {
  const fakeAccess = {
    accessToken: "test-access-token-123",
    expiresAt: Date.now() + 3600000,
    scopes: ["user:inference", "user:profile"],
  };

  it("creates private 0700 directory tree and 0600 exclusive credential file without refresh token", () => {
    const sandbox = createClaudeRunSandbox({
      access: fakeAccess,
      rootDir: TEST_SCRATCH,
    });

    try {
      expect(existsSync(sandbox.runDir)).toBe(true);
      expect(existsSync(sandbox.homeDir)).toBe(true);
      expect(existsSync(sandbox.configDir)).toBe(true);
      expect(existsSync(sandbox.cwdDir)).toBe(true);
      expect(existsSync(sandbox.credentialPath)).toBe(true);
      expect(existsSync(join(sandbox.runDir, "run-meta.json"))).toBe(true);

      // Verify file permissions: 0o700 for dirs, 0o600 for credentials
      const runStat = statSync(sandbox.runDir);
      expect(runStat.mode & 0o777).toBe(0o700);

      const credStat = statSync(sandbox.credentialPath);
      expect(credStat.mode & 0o777).toBe(0o600);

      // Verify content: access token, real expiry, scopes, NO refresh token
      const raw = readFileSync(sandbox.credentialPath, "utf8");
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual({
        claudeAiOauth: {
          accessToken: "test-access-token-123",
          expiresAt: fakeAccess.expiresAt,
          scopes: ["user:inference", "user:profile"],
        },
      });
      expect(raw).not.toContain("refreshToken");
      expect(raw).not.toContain("refresh_token");
    } finally {
      cleanClaudeRunSandbox(sandbox);
      expect(existsSync(sandbox.runDir)).toBe(false);
    }
  });

  it("purges ambient auth, proxy, TLS, loader, and cloud canaries from process environment", () => {
    const sandbox = createClaudeRunSandbox({
      access: fakeAccess,
      rootDir: TEST_SCRATCH,
    });

    try {
      const contaminatedEnv: NodeJS.ProcessEnv = {
        PATH: "/malicious/bin:/usr/bin",
        LANG: "en_US.UTF-8",
        ANTHROPIC_API_KEY: "canary-anthropic-key",
        ANTHROPIC_AUTH_TOKEN: "canary-anthropic-token",
        ANTHROPIC_BASE_URL: "https://evil.proxy.example",
        CLAUDE_CODE_TOKEN: "canary-claude-token",
        OPENAI_API_KEY: "canary-openai-key",
        AWS_SECRET_ACCESS_KEY: "canary-aws-key",
        HTTP_PROXY: "http://proxy.example:8080",
        HTTPS_PROXY: "http://proxy.example:8080",
        ALL_PROXY: "socks5://proxy.example:1080",
        NODE_OPTIONS: "--require /malicious/inject.js",
        NODE_EXTRA_CA_CERTS: "/etc/ssl/fake-ca.pem",
        SSLKEYLOGFILE: "/tmp/tls-keys.log",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://telemetry.example",
        DEBUG: "*",
      };

      const cleanEnv = buildIsolatedEnvironment(sandbox, contaminatedEnv);

      // PATH is fixed, never inherited from the parent.
      expect(cleanEnv.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
      expect(cleanEnv.PATH).not.toContain("malicious");
      expect(cleanEnv.LANG).toBe("en_US.UTF-8");
      expect(cleanEnv.HOME).toBe(sandbox.homeDir);
      expect(cleanEnv.TMPDIR).toBe(sandbox.tmpDir);
      expect(cleanEnv.XDG_CONFIG_HOME).toBe(sandbox.configDir);
      expect(cleanEnv.CLAUDE_CONFIG_DIR).toBe(sandbox.configDir);

      // Verify ALL contaminated canaries are absent
      const keys = Object.keys(cleanEnv);
      for (const key of keys) {
        expect(ALLOWED_ENV_VARS).toContain(key);
      }
      expect(cleanEnv).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(cleanEnv).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
      expect(cleanEnv).not.toHaveProperty("ANTHROPIC_BASE_URL");
      expect(cleanEnv).not.toHaveProperty("HTTP_PROXY");
      expect(cleanEnv).not.toHaveProperty("HTTPS_PROXY");
      expect(cleanEnv).not.toHaveProperty("NODE_OPTIONS");
      expect(cleanEnv).not.toHaveProperty("SSLKEYLOGFILE");
      expect(cleanEnv).not.toHaveProperty("DEBUG");
    } finally {
      cleanClaudeRunSandbox(sandbox);
    }
  });

  it("detects credential rewrites or injected refresh tokens upon read-back", () => {
    const sandbox = createClaudeRunSandbox({
      access: fakeAccess,
      rootDir: TEST_SCRATCH,
    });

    try {
      // Intact: verification succeeds
      expect(verifyCredentialNotRewritten(sandbox, fakeAccess)).toBe(true);

      // Tampered: child wrote back a refresh token
      writeFileSync(
        sandbox.credentialPath,
        JSON.stringify({
          claudeAiOauth: {
            accessToken: fakeAccess.accessToken,
            refreshToken: "rogue-refresh-token",
            expiresAt: fakeAccess.expiresAt,
            scopes: fakeAccess.scopes,
          },
        }),
      );
      expect(verifyCredentialNotRewritten(sandbox, fakeAccess)).toBe(false);

      // Tampered: child changed access token
      writeFileSync(
        sandbox.credentialPath,
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "tampered-access-token",
            expiresAt: fakeAccess.expiresAt,
            scopes: fakeAccess.scopes,
          },
        }),
      );
      expect(verifyCredentialNotRewritten(sandbox, fakeAccess)).toBe(false);
    } finally {
      cleanClaudeRunSandbox(sandbox);
    }
  });

  it("scopes PATH to the binary directory and never inherits the parent PATH", () => {
    const sandbox = createClaudeRunSandbox({ access: fakeAccess, rootDir: TEST_SCRATCH });
    try {
      const withBinary = buildIsolatedEnvironment(
        sandbox,
        { PATH: "/malicious/bin" },
        { binaryPath: "/opt/claude/bin/claude" },
      );
      expect(withBinary.PATH).toBe("/opt/claude/bin:/usr/local/bin:/usr/bin:/bin");
      expect(withBinary.PATH).not.toContain("malicious");
    } finally {
      cleanClaudeRunSandbox(sandbox);
    }
  });

  it("refuses symlink, file, and foreign-owned roots and tightens reused roots", () => {
    const realDir = join(TEST_SCRATCH, "real-root");
    mkdirSync(realDir, { recursive: true });

    const linkPath = join(TEST_SCRATCH, "link-root");
    symlinkSync(realDir, linkPath);
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(() => resolvePrivateRuntimeRoot(linkPath)).toThrow(
      "Claude private runtime root refused",
    );

    const filePath = join(TEST_SCRATCH, "file-root");
    writeFileSync(filePath, "not a directory");
    expect(() => resolvePrivateRuntimeRoot(filePath)).toThrow(
      "Claude private runtime root refused",
    );

    // Reused directory is tightened to 0700, never trusted as found.
    chmodSync(realDir, 0o755);
    const resolved = resolvePrivateRuntimeRoot(realDir);
    expect(resolved).toBe(realDir);
    expect(statSync(realDir).mode & 0o777).toBe(0o700);

    // Foreign-owned directory is refused when ownership can be staged.
    const foreignDir = join(TEST_SCRATCH, "foreign-root");
    mkdirSync(foreignDir, { recursive: true });
    try {
      chownSync(foreignDir, 65534, 65534);
    } catch {
      return; // Cannot stage foreign ownership without privilege; symlink/file cases above still guard.
    }
    expect(() => resolvePrivateRuntimeRoot(foreignDir)).toThrow(
      "Claude private runtime root refused",
    );
  });

  it("resolves the default root outside shared temporary roots", () => {
    const hasUserBase =
      !!process.env.XDG_RUNTIME_DIR ||
      (process.platform === "linux" &&
        typeof process.geteuid === "function" &&
        existsSync(`/run/user/${process.geteuid()}`));
    if (!hasUserBase) return; // No per-user base: fail-closed throw is the correct outcome there.
    const root = resolvePrivateRuntimeRoot();
    expect(root.startsWith(`${tmpdir()}/.h2a-claude-runtime`)).toBe(false);
    expect(root.startsWith("/dev/shm")).toBe(false);
    const st = statSync(root);
    expect(st.mode & 0o777).toBe(0o700);
  });

  it("does not modify permissions of the user's base XDG_RUNTIME_DIR", () => {
    const userRuntime = join(TEST_SCRATCH, "user-runtime");
    mkdirSync(userRuntime, { recursive: true, mode: 0o755 });
    process.env.XDG_RUNTIME_DIR = userRuntime;

    const resolved = resolvePrivateRuntimeRoot();
    expect(resolved).toBe(join(userRuntime, "h2a-claude-runtime"));
    expect(statSync(resolved).mode & 0o777).toBe(0o700);
    // User base directory mode must remain untouched (0755), not chmodded by h2a
    expect(statSync(userRuntime).mode & 0o777).toBe(0o755);
  });

  it("records child PID in run-meta.json for orphan reaping", () => {
    const sandbox = createClaudeRunSandbox({ access: fakeAccess, rootDir: TEST_SCRATCH });
    try {
      const initialMeta = JSON.parse(readFileSync(join(sandbox.runDir, "run-meta.json"), "utf8"));
      expect(initialMeta.pid).toBe(process.pid);
      expect(initialMeta.childPid).toBeUndefined();

      recordChildPidInSandbox(sandbox, 99999);
      const updatedMeta = JSON.parse(readFileSync(join(sandbox.runDir, "run-meta.json"), "utf8"));
      expect(updatedMeta.childPid).toBe(99999);
      expect(updatedMeta.pid).toBe(process.pid);
    } finally {
      cleanClaudeRunSandbox(sandbox);
    }
  });

  it("surfaces sandbox cleanup failure instead of swallowing it", () => {
    if (process.geteuid?.() === 0) return; // root bypasses permission bits; failure not inducible
    const sandbox = createClaudeRunSandbox({
      access: fakeAccess,
      rootDir: TEST_SCRATCH,
    });

    try {
      chmodSync(sandbox.runDir, 0o500);
      expect(() => cleanClaudeRunSandbox(sandbox)).toThrow(
        "Claude run sandbox cleanup failed",
      );
      expect(existsSync(sandbox.runDir)).toBe(true);
    } finally {
      chmodSync(sandbox.runDir, 0o700);
      cleanClaudeRunSandbox(sandbox);
      expect(existsSync(sandbox.runDir)).toBe(false);
    }
  });

  it("guards tests to run ONLY with temporary HOME, XDG_RUNTIME_DIR and H2A_ROOT", () => {
    const ownerHome = userInfo().homedir || homedir();
    const ownerUid = typeof process.getuid === "function" ? process.getuid() : 1000;
    const ownerRun = `/run/user/${ownerUid}`;

    const forbiddenOwnerPaths = [
      join(ownerHome, ".config/sentropic/h2a"),
      join(ownerHome, "h2a-workspace"),
      join(ownerHome, ".config"),
      join(ownerHome, ".local/state"),
      ownerRun,
    ];

    expect(process.env.HOME).not.toBe(ownerHome);
    expect(process.env.XDG_RUNTIME_DIR).not.toBe(ownerRun);

    for (const forbidden of forbiddenOwnerPaths) {
      for (const envVar of [process.env.HOME, process.env.XDG_RUNTIME_DIR, process.env.H2A_ROOT]) {
        if (!envVar) continue;
        expect(envVar === forbidden || envVar.startsWith(`${forbidden}/`)).toBe(false);
      }
    }
  });
});
