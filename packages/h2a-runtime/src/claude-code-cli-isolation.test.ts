import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWED_ENV_VARS,
  BLOCKED_AUTH_HOSTS,
  DEFAULT_INFERENCE_HOST,
  buildIsolatedEnvironment,
  checkEgressAllowed,
  cleanClaudeRunSandbox,
  createClaudeRunSandbox,
  resolvePrivateRuntimeRoot,
  verifyCredentialNotRewritten,
} from "./claude-code-cli-isolation.js";

const TEST_SCRATCH = join(tmpdir(), "h2a-claude-isolation-test-" + Date.now());

beforeEach(() => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
});

afterEach(() => {
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
        PATH: "/usr/bin:/bin",
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

      // Verify allowed keys exist and point to sandbox
      expect(cleanEnv.PATH).toBe("/usr/bin:/bin");
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

  it("enforces inference-only default-deny egress policy", () => {
    // Inference endpoint is permitted
    expect(checkEgressAllowed("https://api.anthropic.com/v1/messages")).toEqual({
      allowed: true,
    });

    // OAuth token and auth endpoints are DENIED
    for (const host of BLOCKED_AUTH_HOSTS) {
      expect(checkEgressAllowed(`https://${host}/v1/oauth/token`)).toEqual({
        allowed: false,
        reason: "oauth_auth_egress_denied",
      });
    }

    // IP address literals are DENIED
    expect(checkEgressAllowed("https://160.79.104.10/")).toEqual({
      allowed: false,
      reason: "ip_literal_egress_denied",
    });
    expect(checkEgressAllowed("https://[2607:f8b0:4004:800::200e]/")).toEqual({
      allowed: false,
      reason: "ip_literal_egress_denied",
    });

    // Non-HTTPS is DENIED
    expect(checkEgressAllowed("http://api.anthropic.com/")).toEqual({
      allowed: false,
      reason: "non_https_egress_denied",
    });

    // Other third-party destinations are DENIED
    expect(checkEgressAllowed("https://example.com/api")).toEqual({
      allowed: false,
      reason: "unauthorized_destination_denied",
    });
  });
});
