import { chmodSync, chownSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir, userInfo } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALLOWED_ENV_VARS,
  BLOCKED_AUTH_HOSTS,
  DEFAULT_INFERENCE_HOST,
  assertManagedConfigIsolation,
  buildIsolatedEnvironment,
  checkEgressAllowed,
  checkWindowsManagedRegistry,
  cleanClaudeRunSandbox,
  createClaudeRunSandbox,
  defaultManagedConfigPaths,
  getClaudeSeatOrgProofHandoff,
  isWsl,
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

  it("refuses managed configuration and scopes PATH to the binary directory", () => {
    // 1. managed-settings.json file
    const managedFile = join(TEST_SCRATCH, "managed-settings.json");
    writeFileSync(managedFile, "{}");
    expect(() => assertManagedConfigIsolation([managedFile])).toThrow(
      "managed configuration prevents isolation",
    );

    // 2. managed-settings.d drop-ins directory
    const managedDir = join(TEST_SCRATCH, "managed-settings.d");
    mkdirSync(managedDir);
    expect(() => assertManagedConfigIsolation([managedDir])).toThrow(
      "managed configuration prevents isolation",
    );

    // 3. managed-mcp.json file
    const managedMcp = join(TEST_SCRATCH, "managed-mcp.json");
    writeFileSync(managedMcp, "{}");
    expect(() => assertManagedConfigIsolation([managedMcp])).toThrow(
      "managed configuration prevents isolation",
    );

    // Absent paths do not throw
    expect(() =>
      assertManagedConfigIsolation([
        join(TEST_SCRATCH, "absent-settings.json"),
        join(TEST_SCRATCH, "absent-settings.d"),
        join(TEST_SCRATCH, "absent-mcp.json"),
      ]),
    ).not.toThrow();

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

  it("resolves defaultManagedConfigPaths per platform including conservative unverified macOS plist candidates", () => {
    const winPaths = defaultManagedConfigPaths("win32");
    expect(winPaths).toContain("C:\\Program Files\\ClaudeCode\\managed-settings.json");
    expect(winPaths).toContain("C:\\Program Files\\ClaudeCode\\managed-settings.d");
    expect(winPaths).toContain("C:\\Program Files\\ClaudeCode\\managed-mcp.json");

    const macPaths = defaultManagedConfigPaths("darwin");
    expect(macPaths).toContain("/Library/Application Support/ClaudeCode/managed-settings.json");
    expect(macPaths).toContain("/Library/Application Support/ClaudeCode/managed-settings.d");
    expect(macPaths).toContain("/Library/Application Support/ClaudeCode/managed-mcp.json");
    expect(macPaths).toContain("/Library/Managed Preferences/com.anthropic.claude-code.plist");
    expect(macPaths).toContain("/Library/Preferences/com.anthropic.claude-code.plist");
    expect(macPaths).toContain("/Library/Managed Preferences/com.anthropic.claudecode.plist");

    const linuxPaths = defaultManagedConfigPaths("linux");
    expect(linuxPaths).toContain("/etc/claude-code/managed-settings.json");
    expect(linuxPaths).toContain("/etc/claude-code/managed-settings.d");
    expect(linuxPaths).toContain("/etc/claude-code/managed-mcp.json");

    const wslPaths = defaultManagedConfigPaths("wsl");
    expect(wslPaths).toContain("/etc/claude-code/managed-settings.json");
    expect(wslPaths).toContain("/mnt/c/Program Files/ClaudeCode/managed-settings.json");
    expect(wslPaths).toContain("/mnt/c/Program Files/ClaudeCode/managed-settings.d");
    expect(wslPaths).toContain("/mnt/c/Program Files/ClaudeCode/managed-mcp.json");
  });

  it("detects WSL environment from environment variables or proc version", () => {
    const saved = process.env.WSL_DISTRO_NAME;
    try {
      process.env.WSL_DISTRO_NAME = "Ubuntu";
      expect(isWsl()).toBe(true);
      delete process.env.WSL_DISTRO_NAME;
      expect(typeof isWsl()).toBe("boolean");
    } finally {
      if (saved !== undefined) process.env.WSL_DISTRO_NAME = saved;
      else delete process.env.WSL_DISTRO_NAME;
    }
  });

  it("fails closed on reg.exe failure, error, or unexpected exit code and detects HKLM/HKCU policies", () => {
    // 1. Success on HKLM policy found (exit code 0)
    const mockSpawnHklm = (_cmd: string, args: readonly string[]) => {
      if (args[1] === "HKLM\\SOFTWARE\\Policies\\ClaudeCode") {
        return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), error: undefined } as any;
      }
      return { status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), error: undefined } as any;
    };
    expect(checkWindowsManagedRegistry({ spawnSyncFn: mockSpawnHklm as any, regExePath: "reg.exe" })).toBe(true);

    // 2. Success on HKCU policy found (exit code 0 on HKCU, 1 on HKLM)
    const queriedKeys: string[] = [];
    const mockSpawnHkcu = (_cmd: string, args: readonly string[]) => {
      queriedKeys.push(args[1]!);
      if (args[1] === "HKCU\\SOFTWARE\\Policies\\ClaudeCode") {
        return { status: 0, stdout: Buffer.from(""), stderr: Buffer.from(""), error: undefined } as any;
      }
      return { status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), error: undefined } as any;
    };
    expect(checkWindowsManagedRegistry({ spawnSyncFn: mockSpawnHkcu as any, regExePath: "reg.exe" })).toBe(true);
    expect(queriedKeys).toEqual([
      "HKLM\\SOFTWARE\\Policies\\ClaudeCode",
      "HKCU\\SOFTWARE\\Policies\\ClaudeCode",
    ]);

    // 3. Clean environment: both return 1 (key not found)
    const mockClean = () => ({ status: 1, stdout: Buffer.from(""), stderr: Buffer.from(""), error: undefined } as any);
    expect(checkWindowsManagedRegistry({ spawnSyncFn: mockClean as any, regExePath: "reg.exe" })).toBe(false);

    // 4. Fail-closed: reg.exe exits with error status (e.g. status 2)
    const mockExit2 = () => ({ status: 2, stdout: Buffer.from(""), stderr: Buffer.from("Access denied"), error: undefined } as any);
    expect(() => checkWindowsManagedRegistry({ spawnSyncFn: mockExit2 as any, regExePath: "reg.exe" })).toThrow(
      "reg.exe query returned exit code 2",
    );

    // 5. Fail-closed: spawn returns error (e.g. ENOENT)
    const mockSpawnError = () => ({ status: null, stdout: Buffer.from(""), stderr: Buffer.from(""), error: new Error("spawn ENOENT") } as any);
    expect(() => checkWindowsManagedRegistry({ spawnSyncFn: mockSpawnError as any, regExePath: "reg.exe" })).toThrow(
      "reg.exe execution failed",
    );

    // 6. Fail-closed: spawnSync throws exception
    const mockThrow = () => { throw new Error("Permission denied"); };
    expect(() => checkWindowsManagedRegistry({ spawnSyncFn: mockThrow as any, regExePath: "reg.exe" })).toThrow(
      "reg.exe execution failed",
    );
  });

  it("refuses managed configuration via files or registry, and reports org proof blocked", () => {
    // 1. Windows registry check seam: detected policy refuses.
    expect(() =>
      assertManagedConfigIsolation([], { checkRegistry: () => true }),
    ).toThrow("Windows registry policy detected");

    // 2. Clean registry seam with no managed paths: passes.
    expect(() =>
      assertManagedConfigIsolation([], { checkRegistry: () => false }),
    ).not.toThrow();

    // 3. Organization proof is a blocked mesh seam, not an access read:
    //    the 0.25.0 projection carries no account-type field, so no
    //    access-based organization refusal is claimed.
    expect(getClaudeSeatOrgProofHandoff()).toEqual({
      status: "blocked_pending_mesh_seam",
      pinnedBaseline: "0.25.0",
      requiredSeam: "individual-vs-organization account-type field on ClaudeCodeAccessProjection",
      rationale: expect.stringContaining("only accessToken/expiresAt/scopes"),
    });
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

  it("classifies URL destinations for default-deny inference-only egress policy", () => {
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
