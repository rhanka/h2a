// L7 (bench round 27): the bench consumes seat materialisation through the
// published seat-onboarding API (@sentropic/llm-mesh 0.33.0), re-exported
// from scripts/xcli-seat-vendor/seat-onboarding.js and never re-implemented
// here. Tests use synthetic fixtures only — never the real keyring, never
// real secrets, never the owner profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { sourceBuild, environment, compliantQualificationRoot } from './xcli-lab.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

let vendor = null;
try { vendor = await import('./xcli-seat-vendor/seat-onboarding.js'); }
catch { vendor = null; }

test('L7: the bench re-exports the published seat-onboarding API, never re-implements it', async () => {
  assert.ok(vendor, 'xcli-seat-vendor/seat-onboarding.js exists and imports');
  for (const name of ['validateSeatEnvelope', 'validateSeatOnboarding', 'seatLaunchGate',
    'SEAT_ENVELOPE_AUTH_FILES', 'CAPTURE_SOURCES', 'AGY_REQUIRED_COMPLETED_STEPS',
    'canonicalAgyJetskiBytes', 'captureSeatOnboarding',
    'materialiseSeatEnvelopes', 'materialiseCellHome', 'SEAT_RECORD_REL_PATH']) {
    assert.ok(vendor[name] !== undefined && vendor[name] !== null, `re-exported: ${name}`);
  }
});

test('L7: the re-exported auth allowlist matches the published table', async () => {
  assert.ok(vendor, 'vendor module required');
  assert.deepEqual(vendor.SEAT_ENVELOPE_AUTH_FILES, {
    agy: ['.gemini/antigravity-cli/antigravity-oauth-token'],
    claude: ['.claude/.credentials.json', '.claude.json'],
    codex: ['.codex/auth.json'],
    muse: ['.config/muse/auth.json'],
    vibe: ['.vibe/MISTRAL_API_KEY'],
  });
});

test('L7: the re-export file carries no logic', async () => {
  const text = fs.readFileSync(new URL('./xcli-seat-vendor/seat-onboarding.js', import.meta.url), 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    assert.match(trimmed, /^export\s+(\{[^}]*\}|\*)\s+from\s+['"]@sentropic\/llm-mesh\/(enrollment|node)['"];?$/,
      `every code line is a re-export: ${trimmed}`);
  }
});

test('L7: the vendor pin records the re-export digest and the published version', async () => {
  const { vendoredDigest } = await import('./xcli-seat-import.mjs');
  const vendorJson = await vendoredDigest();
  const bytes = fs.readFileSync(new URL('./xcli-seat-vendor/seat-onboarding.js', import.meta.url), 'utf8');
  assert.equal(vendorJson.outputs['seat-onboarding.js'], sha256(bytes),
    'the re-export file is digest-pinned');
  assert.equal(vendorJson.packages?.['@sentropic/llm-mesh'], '0.33.0',
    'the vendor pin names the published release');
  const installed = JSON.parse(fs.readFileSync(
    new URL('../node_modules/@sentropic/llm-mesh/package.json', import.meta.url), 'utf8'));
  assert.equal(installed.version, vendorJson.packages['@sentropic/llm-mesh'],
    'the installed bench dependency is the pinned release');
});

test('L7: LOGIN_ALLOWLIST is the published table, not a bench copy', async () => {
  assert.ok(vendor, 'vendor module required');
  const { LOGIN_ALLOWLIST } = await import('./xcli-lab.mjs');
  assert.deepEqual({ ...LOGIN_ALLOWLIST }, { ...vendor.SEAT_ENVELOPE_AUTH_FILES });
});

// ---- Synthetic fixtures: a fake owner HOME plus a stub mesh facade. ----

const SYNTH_SCOPE = 'test-scope-l7';

test('L7 R32: the reviewed Agy 1.5.3 schema preserves published validators and rejects incomplete steps', async () => {
  const reviewed = await import('./xcli-seat-onboarding.mjs');
  const published = await import('./xcli-seat-vendor/seat-onboarding.js');
  assert.equal(reviewed.validateSeatEnvelope, published.validateSeatEnvelope);
  assert.equal(reviewed.validateAgyJetskiContent, published.validateAgyJetskiContent);
  const steps = vendor.AGY_REQUIRED_COMPLETED_STEPS['1.4.12'];
  const bytes = vendor.canonicalAgyJetskiBytes('1.4.12', steps);
  assert.equal(reviewed.validateAgyJetskiContent(bytes, '1.5.3'), null);
  // Retired and never-registered versions stay refused.
  assert.equal(reviewed.validateAgyJetskiContent(bytes, '1.5.2'), 'onboarding-shape-unverified');
  assert.equal(reviewed.validateAgyJetskiContent(bytes, '9.9.9'), 'onboarding-shape-unverified');
  for (const step of steps) {
    const partial = bytes.split('\n').filter(line => !line.includes(step)).join('\n');
    assert.equal(reviewed.validateAgyJetskiContent(partial, '1.5.3'), 'onboarding-incomplete');
  }
  for (const extra of ['POST_ONBOARDING_STEP_TYPE_UNSPECIFIED', 'POST_ONBOARDING_STEP_TYPE_UNKNOWN', steps[0]]) {
    const invalid = bytes.replace('}', `  completed_steps: ${extra}\n}`);
    assert.equal(reviewed.validateAgyJetskiContent(invalid, '1.5.3'), 'onboarding-shape-unverified');
  }
});

test('L7 R31: capture and preflight reject a different Agy binary before credential access', async () => {
  const { buildSeatEnvelope } = await provision();
  const { runSeatPreflight } = await import('./xcli-seats.mjs');
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-agy-binary-'));
  const previousPath = process.env.PATH;
  let accountRead = false;
  try {
    const executable = join(root, 'agy');
    fs.writeFileSync(executable, `#!${process.execPath}\nconsole.log('1.5.3');\n`, { mode: 0o700 });
    process.env.PATH = root;
    await assert.rejects(buildSeatEnvelope({ seatId: 'agy', slot: { slot: '00' },
      homeDir: join(root, 'absent-home'), ownerScope: SYNTH_SCOPE,
      cliVersions: { agy: '1.5.3' },
      meshFacade: { listAccounts: async () => { accountRead = true; return []; } } }),
    /onboarding-binary-unreviewed:agy:1\.5\.3/);
    assert.equal(accountRead, false, 'refusal precedes mesh and credential reads');
    const result = await runSeatPreflight({ seatId: 'agy', family: 'agy', authSource: join(root, 'absent-seat') },
      { executables: { agy: executable } });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'onboarding-binary-unreviewed:agy:1.5.3');
    assert.equal(result.modelCalls, 0);
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('L7 R31: native Agy colon-message syntax projects consent without transporting identifiers', async () => {
  const { captureReviewedSeatOnboarding } = await import('./xcli-agy-capture.mjs');
  const canonical = vendor.canonicalAgyJetskiBytes('1.5.3', vendor.AGY_REQUIRED_COMPLETED_STEPS['1.5.3']);
  const homeDir = agyHome(canonical.replace('post_onboarding {', 'post_onboarding: {') +
    'installation_uuid: "identifier-never-export"\nmigrations: { key: "private-native-state" value: 42 }\n');
  const input = { cli: 'agy', seatRef: 'agy', ownerScope: SYNTH_SCOPE, accountBinding: 'acct-r31-agy',
    nativeCliVersion: '1.5.3', os: 'linux', capturedAt: '2026-11-06T00:00:00.000Z',
    lineage: { epoch: 1, generation: 0, operationId: 'op-r31-native-capture' },
    cellSynthesis: [], sourceHome: homeDir, selector: { sourceRelPath: vendor.CAPTURE_SOURCES.agy } };
  const file = join(homeDir, vendor.CAPTURE_SOURCES.agy);
  try {
    const baseline = await vendor.captureSeatOnboarding(input);
    assert.equal(baseline.ok, false, 'the published parser reproduces the native syntax refusal');
    const captured = await captureReviewedSeatOnboarding(input);
    assert.equal(captured.ok, true);
    assert.equal(Buffer.from(captured.block.files[0].contentBase64, 'base64').toString('utf8'), canonical);
    assert.ok(!JSON.stringify(captured).includes('identifier-never-export'));
    assert.equal((await captureReviewedSeatOnboarding(Object.assign([], input))).code, 'onboarding-schema-mismatch');
    assert.equal((await captureReviewedSeatOnboarding({ ...input, accountBinding: {},
      sourceHome: join(homeDir, 'absent') })).code, 'onboarding-binding-unverifiable');
    assert.equal((await captureReviewedSeatOnboarding({ ...input,
      selector: Object.assign([], input.selector) })).ok, false);
    for (const source of [
      canonical.replace('post_onboarding {', 'post_onboarding: {').replace(/  completed_steps:[^\n]*\n/, ''),
      canonical.replace('post_onboarding {', 'post_onboarding: {').repeat(2),
      'installation_uuid: "post_onboarding: { completed_steps: POST_ONBOARDING_STEP_TYPE_ADD_WORKSPACE }"\n',
      '# post_onboarding: { completed_steps: POST_ONBOARDING_STEP_TYPE_ADD_WORKSPACE }\n',
      canonical.replace(/  completed_steps:[^\n]*\n/, '') +
        'installation_uuid: "post_onboarding: { completed_steps: POST_ONBOARDING_STEP_TYPE_MANAGER_WELCOME }"\n',
    ]) {
      fs.writeFileSync(file, source);
      assert.equal((await captureReviewedSeatOnboarding(input)).ok, false, 'incomplete, duplicate or quoted consent stays refused');
    }
    fs.writeFileSync(file, ' '.repeat(1025));
    assert.equal((await captureReviewedSeatOnboarding(input)).code, 'onboarding-size-exceeded');
    const outside = join(homeDir, 'outside-state');
    fs.writeFileSync(outside, canonical);
    fs.unlinkSync(file);
    fs.symlinkSync(outside, file);
    assert.equal((await captureReviewedSeatOnboarding(input)).ok, false, 'symlink sources stay refused');
    assert.equal(fs.readFileSync(outside, 'utf8'), canonical, 'the source target is never modified');
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('L7 R31: Agy 1.5.3 capture survives fresh-process validation and both materialization stages', async () => {
  const reviewed = await import('./xcli-seat-onboarding.mjs');
  const { buildSeatEnvelope, validateEnvelopeViaFd } = await provision();
  const { materialiseSeatCell } = await import('./xcli-seat-import.mjs');
  const bytes = reviewed.canonicalAgyJetskiBytes('1.5.3', reviewed.AGY_REQUIRED_COMPLETED_STEPS['1.5.3']);
  const homeDir = agyHome(bytes);
  const layout = cellLayout();
  let staged;
  try {
    // Build synthetic auth/profile material from the legacy fixture, then
    // capture the new version independently through the published API.
    const built = await buildSeatEnvelope({ seatId: 'agy', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-06T00:00:00.000Z', operationId: 'op-r31-agy',
      meshFacade: stubAccounts(['cloud-code', 'acct-r31-agy']), meshScope: SYNTH_SCOPE,
      cliVersions: { agy: '1.4.12' } });
    const captured = await reviewed.captureSeatOnboarding({ cli: 'agy', seatRef: 'agy',
      ownerScope: SYNTH_SCOPE, accountBinding: 'acct-r31-agy', nativeCliVersion: '1.5.3',
      os: 'linux', capturedAt: '2026-11-06T00:00:00.000Z',
      lineage: built.envelope.onboarding.lineage, cellSynthesis: [], sourceHome: homeDir,
      selector: { sourceRelPath: reviewed.CAPTURE_SOURCES.agy } });
    assert.equal(captured.ok, true);
    built.envelope.onboarding = captured.block;
    built.envelope.bundle.identity.nativeCliVersion = '1.5.3';
    const envelopeFile = join(layout.root, 'synthetic-envelope.json');
    fs.writeFileSync(envelopeFile, JSON.stringify(built.envelope), { mode: 0o600 });
    const receipt = validateEnvelopeViaFd({ seatId: 'agy', envelopeFile,
      slotManifestFile: new URL('../docs/cross-cli-seat-slots.json', import.meta.url).pathname });
    assert.equal(receipt.onboardingStatus, 'present');
    staged = await stageOne('agy', 'agy', built.envelope);
    assert.equal(staged.result.manifest.seats[0].onboarding.status, 'present');
    // The native CLI has a separate completion cache. Replay only source
    // evidence, never a synthesized acceptance or account telemetry change.
    const nativeCache = '.gemini/antigravity-cli/cache/onboarding.json';
    const completed = { consumerOnboardingComplete: true,
      enterpriseOnboardingComplete: true, onboardingComplete: true };
    fs.mkdirSync(join(homeDir, '.gemini/antigravity-cli/cache'), { recursive: true });
    fs.writeFileSync(join(homeDir, nativeCache), JSON.stringify(completed));
    const { captureAgyCliCache, AGY_CLI_CACHE_SIDECAR } = await import('./xcli-agy-cli-cache.mjs');
    const capturedCache = captureAgyCliCache({ sourceHome: homeDir, seatDir: staged.seatDir,
      nativeCliVersion: '1.5.3' });
    assert.equal(capturedCache, true);
    const sourceFile = join(homeDir, nativeCache);
    const sidecarFile = join(staged.seatDir, AGY_CLI_CACHE_SIDECAR);
    const capturedBytes = fs.readFileSync(sidecarFile, 'utf8');
    for (const invalid of [{ ...completed, onboardingComplete: false },
      { ...completed, onboardingComplete: 'true' }, { onboardingComplete: true },
      { ...completed, unrelatedSecret: 'must-not-transport' }]) {
      fs.writeFileSync(sourceFile, JSON.stringify(invalid));
      assert.equal(captureAgyCliCache({ sourceHome: homeDir, seatDir: staged.seatDir,
        nativeCliVersion: '1.5.3' }), false);
      assert.equal(fs.readFileSync(sidecarFile, 'utf8'), capturedBytes);
      assert.equal(fs.readFileSync(sourceFile, 'utf8'), JSON.stringify(invalid), 'source is read-only');
    }
    fs.writeFileSync(sourceFile, ' '.repeat(1025));
    assert.equal(captureAgyCliCache({ sourceHome: homeDir, seatDir: staged.seatDir,
      nativeCliVersion: '1.5.3' }), false);
    fs.unlinkSync(sourceFile);
    fs.symlinkSync(sidecarFile, sourceFile);
    assert.equal(captureAgyCliCache({ sourceHome: homeDir, seatDir: staged.seatDir,
      nativeCliVersion: '1.5.3' }), false, 'symlink source is refused');
    const input = { cli: 'agy', seatDir: staged.seatDir, cellHome: layout.cellHome,
      workspaceDir: layout.workspace, configDirs: layout.configDirs,
      expectedNativeCliVersion: '1.5.3', ownerScope: SYNTH_SCOPE,
      authFiles: ['.gemini/antigravity-cli/antigravity-oauth-token'], destKeys: ['agy-jetski'] };
    const result = await materialiseSeatCell(input);
    assert.ok(result.copied.includes('.gemini/antigravity-cli/jetski_state.pbtxt'));
    assert.ok(result.copied.includes(nativeCache), 'cache is included in private copy and wipe evidence');
    assert.deepEqual(JSON.parse(fs.readFileSync(join(layout.cellHome, nativeCache), 'utf8')), completed);
    assert.equal(fs.readFileSync(join(layout.cellHome, '.gemini/antigravity-cli/jetski_state.pbtxt'), 'utf8'), bytes);
    const sidecar = join(staged.seatDir, AGY_CLI_CACHE_SIDECAR);
    const saved = fs.readFileSync(sidecar, 'utf8');
    const corrupt = JSON.parse(saved); corrupt.seatRecordSha256 = '0'.repeat(64);
    fs.writeFileSync(sidecar, JSON.stringify(corrupt));
    await assert.rejects(materialiseSeatCell(input), /agy-cli-cache-binding-mismatch/);
    assert.equal(fs.existsSync(join(layout.cellHome, nativeCache)), false);
    fs.writeFileSync(sidecar, saved);
    await assert.rejects(materialiseSeatCell({ ...input, expectedNativeCliVersion: '1.4.12' }), /onboarding-version-mismatch/);
    assert.equal(fs.existsSync(layout.cellHome), false, 'a version mismatch leaves no cell home');
  } finally {
    if (staged) fs.rmSync(staged.dir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('L7 R31: Agy onboarding still receives its separate product MCP configuration', async () => {
  const reuseRoot = /^\/home\/[^/]+\/\.cache-tmp\/h2a-test\/run-[A-Za-z0-9]+$/.test(tmpdir());
  const qualificationRoot = reuseRoot ? tmpdir() : compliantQualificationRoot();
  const dir = fs.mkdtempSync(join(qualificationRoot, 'xcli-agy-mcp-'));
  const canonical = vendor.canonicalAgyJetskiBytes('1.4.12', vendor.AGY_REQUIRED_COMPLETED_STEPS['1.4.12']);
  const homeDir = agyHome(canonical);
  let staged;
  try {
    const { buildSeatEnvelope } = await provision();
    const built = await buildSeatEnvelope({ seatId: 'agy', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, meshFacade: stubAccounts(['cloud-code', 'acct-r31-mcp']),
      meshScope: SYNTH_SCOPE, cliVersions: { agy: '1.4.12' } });
    staged = await stageOne('agy', 'agy', built.envelope);
    const build = sourceBuild(dir);
    const marker = join(dir, 'observed.json'), fixture = join(dir, 'inspect.mjs');
    fs.writeFileSync(fixture, `import fs from 'node:fs';
import { join } from 'node:path';
let configured = false;
try { const config = JSON.parse(fs.readFileSync(join(process.env.HOME, '.gemini/config/mcp_config.json'), 'utf8'));
  configured = !!config.mcpServers?.h2a?.command && config.mcpServers.h2a.args.includes('mcp-serve');
} catch {}
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ configured,
  consent: fs.existsSync(join(process.env.HOME, '.gemini/antigravity-cli/jetski_state.pbtxt')) }), { mode: 0o600 });
setTimeout(() => process.exit(0), 500);
`);
    const executable = join(dir, 'agy');
    fs.writeFileSync(executable, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
    const cell = join(dir, 'cell'); fs.mkdirSync(cell, { mode: 0o700 });
    const worker = spawnSync(process.execPath, [new URL('./qualify-cross-cli.mjs', import.meta.url).pathname, '--worker'], {
      cwd: dir, env: { ...environment(join(dir, 'worker')), H2A_TEST_QUALIFICATION_ROOT: qualificationRoot },
      input: JSON.stringify({ sender: 'agy', receiver: 'agy', root: qualificationRoot, cell, build: build.path,
        executables: { agy: executable }, timeoutMs: 3000, simulated: false,
        authHomes: { receiver: staged.seatDir }, seatOnboarding: { receiver: {
          ...staged.result.manifest.seats[0].onboarding, expectedNativeCliVersion: '1.4.12', ownerScope: SYNTH_SCOPE } } }),
      encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    });
    assert.equal(worker.status, 0, worker.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, 'utf8')), { configured: true, consent: true });
    assert.equal(JSON.parse(worker.stdout).status, 'blocked', 'the inspector exits before any model; no measured success is claimed');
  } finally {
    if (staged) fs.rmSync(staged.dir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    if (!reuseRoot) fs.rmSync(qualificationRoot, { recursive: true, force: true });
  }
});

function syntheticHome(files) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-onboard-home-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel);
    fs.mkdirSync(join(dir, rel.split('/').slice(0, -1).join('/')), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, content, { mode: 0o600 });
  }
  return dir;
}

const stubAccounts = (...entries) => ({
  listAccounts: async () => entries.map(([provider, accountId]) =>
    ({ accountId, providerId: provider, status: 'active',
      createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' })),
});

function codexHome() {
  return syntheticHome({
    '.codex/auth.json': '{"access_token":"synthetic-codex-token"}',
  });
}

function agyHome(canonical) {
  return syntheticHome({
    '.gemini/antigravity-cli/antigravity-oauth-token': 'synthetic-agy-token',
    '.gemini/antigravity-cli/jetski_state.pbtxt': canonical,
  });
}

function claudeHome() {
  return syntheticHome({
    '.claude/.credentials.json': '{"claudeAiOauth":{"accessToken":"synthetic"}}',
    '.claude.json': JSON.stringify({ oauthAccount: { accountId: 'synthetic' },
      hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.301',
      projects: { '/owner/old': { hasTrustDialogAccepted: true } } }),
  });
}

function museHome() {
  return syntheticHome({
    '.config/muse/auth.json': '{"token":"synthetic-muse-token"}',
    '.config/muse/trust.json': JSON.stringify({ schema_version: 1,
      projects: { '/owner/old': { decision: 'trusted' } } }),
  });
}

async function provision() {
  return (await import('./xcli-seat-provision.mjs'));
}

test('L7: an enrolled codex seat provisions an onboarding block from the custodian intent', async () => {
  const { buildSeatEnvelope } = await provision();
  const homeDir = codexHome();
  try {
    const { facade } = { facade: stubAccounts(['codex', 'acct-synth-codex-1']) };
    const built = await buildSeatEnvelope({ seatId: 'codex', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-03T00:00:00.000Z', operationId: 'op-l7-codex-1',
      meshFacade: facade, meshScope: SYNTH_SCOPE, cliVersions: { codex: '0.162.1' } });
    assert.ok(built.envelope.onboarding, 'the envelope carries an onboarding block');
    const block = built.envelope.onboarding;
    assert.equal(block.cli, 'codex');
    assert.equal(block.seatRef, 'codex');
    assert.equal(block.accountBinding, 'acct-synth-codex-1');
    assert.equal(built.envelope.bundle.provenance.accountBinding, 'acct-synth-codex-1');
    assert.equal(block.nativeCliVersion, '0.162.1');
    assert.equal(built.envelope.bundle.identity.nativeCliVersion, '0.162.1');
    assert.deepEqual(block.cellSynthesis, ['codex-project-trust']);
    assert.equal(built.source.onboardingStatus, 'present');
    assert.deepEqual(built.source.launchGate, { eligible: true });
    assert.ok(vendor, 'vendor module required');
    const checked = vendor.validateSeatEnvelope(built.envelope, { trustedAuthority: 'consumer' });
    assert.equal(checked.ok, true, `the issued envelope validates: ${checked.ok ? '' : checked.detail}`);
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('L7: a version without a reviewed step set refuses issuance and stages auth-only', async () => {
  assert.ok(vendor, 'vendor module required');
  const { buildSeatEnvelope } = await provision();
  const canonical = vendor.canonicalAgyJetskiBytes('1.4.12', vendor.AGY_REQUIRED_COMPLETED_STEPS['1.4.12']);
  const homeDir = agyHome(canonical);
  try {
    const built = await buildSeatEnvelope({ seatId: 'agy', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-03T00:00:00.000Z', operationId: 'op-l7-agy-1',
      meshFacade: stubAccounts(['cloud-code', 'acct-synth-agy-1']), meshScope: SYNTH_SCOPE,
      cliVersions: { agy: '9.9.9' } });
    assert.equal(built.envelope.onboarding, undefined, 'no block is issued on version drift');
    assert.equal(built.envelope.bundle.identity.nativeCliVersion, undefined);
    assert.equal(built.source.onboardingStatus, 'absent');
    assert.deepEqual(built.source.launchGate, { eligible: false, code: 'onboarding-required' });
    assert.equal(built.source.onboardingRefused, 'onboarding-shape-unverified');
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('L7: file seats provision from the published capture for agy, claude and muse', async () => {
  assert.ok(vendor, 'vendor module required');
  const { buildSeatEnvelope } = await provision();
  const canonical = vendor.canonicalAgyJetskiBytes('1.4.12', vendor.AGY_REQUIRED_COMPLETED_STEPS['1.4.12']);
  const cases = [
    { seatId: 'agy', home: () => agyHome(canonical), provider: 'cloud-code', accountId: 'acct-synth-agy-1',
      versions: { agy: '1.4.12' }, synthesis: [] },
    { seatId: 'claude', home: claudeHome, provider: 'claude-code', accountId: 'acct-synth-claude-1',
      versions: { claude: '2.1.301' }, synthesis: ['claude-workspace-trust'] },
    { seatId: 'muse', home: museHome, provider: 'muse', accountId: 'acct-synth-muse-1',
      versions: { muse: '1.4.14' }, synthesis: ['muse-workspace-trust'] },
  ];
  for (const { seatId, home, provider, accountId, versions, synthesis } of cases) {
    const homeDir = home();
    try {
      const built = await buildSeatEnvelope({ seatId, slot: { slot: '00' }, homeDir,
        ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-03T00:00:00.000Z',
        operationId: `op-l7-${seatId}-1`,
        meshFacade: stubAccounts([provider, accountId]), meshScope: SYNTH_SCOPE, cliVersions: versions });
      assert.ok(built.envelope.onboarding, `${seatId} carries a block`);
      assert.equal(built.envelope.onboarding.accountBinding, accountId);
      assert.deepEqual(built.envelope.onboarding.cellSynthesis, synthesis);
      const checked = vendor.validateSeatEnvelope(built.envelope, { trustedAuthority: 'consumer' });
      assert.equal(checked.ok, true, `${seatId} envelope validates`);
    } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
  }
});

test('L7: an unreachable store stages auth-only with a closed gate and a typed cause', async () => {
  const { buildSeatEnvelope } = await provision();
  const homeDir = claudeHome();
  try {
    const denied = new Error('denied');
    denied.code = 'EROFS';
    const built = await buildSeatEnvelope({ seatId: 'claude', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-03T00:00:00.000Z', operationId: 'op-l7-claude-1',
      meshFacade: { listAccounts: async () => { throw denied; } }, meshScope: SYNTH_SCOPE,
      cliVersions: { claude: '2.1.301' } });
    assert.equal(built.envelope.onboarding, undefined);
    assert.equal(built.source.meshGate, 'store-unreachable');
    assert.equal(built.source.onboardingStatus, 'absent');
    assert.equal(built.source.onboardingRefused, 'onboarding-binding-unverifiable');
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('L7: the custodian codex intent uses a policy the binary supports', async () => {
  const { CODEX_SEAT_INTENT } = await provision();
  // codex 0.163.0 rejects `untrusted` at config load; `on-request` keeps
  // the startup approval behavior the cells rely on.
  assert.equal(CODEX_SEAT_INTENT.approvalPolicy, 'on-request');
  assert.deepEqual([...CODEX_SEAT_INTENT.mcpServerNames], ['h2a']);
});

test('L7: the CLI version probe reads a binary, never a default', async () => {
  const { probeCliVersion } = await provision();
  const bin = fs.mkdtempSync(join(tmpdir(), 'xcli-onboard-bin-'));
  try {
    fs.writeFileSync(join(bin, 'codex'), '#!/bin/sh\necho "codex-cli 0.162.1"\n', { mode: 0o700 });
    assert.equal(probeCliVersion('codex', { path: bin }), '0.162.1');
    assert.equal(probeCliVersion('muse', { path: bin }), null, 'a missing binary refuses, never invents');
    fs.writeFileSync(join(bin, 'muse'), '#!/bin/sh\necho "no version here"\n', { mode: 0o700 });
    assert.equal(probeCliVersion('muse', { path: bin }), null, 'an unparseable version refuses');
  } finally { fs.rmSync(bin, { recursive: true, force: true }); }
});

// ---- Stage 1: the bench wraps the library batch materialization. ----

const seatSlot = (seatId, cli) => ({ seatId, cli, slot: '00', secret: `SEAT_${cli.toUpperCase()}_00`,
  candidateSecret: `SEAT_CANDIDATE_${cli.toUpperCase()}_00`, useSecret: `SEAT_${cli.toUpperCase()}_00` });

async function stageOne(seatId, cli, envelope) {
  const { materialiseSeatEnvelopes } = await import('./xcli-seat-import.mjs');
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-onboard-stage1-'));
  const slot = seatSlot(seatId, cli);
  const useSecret = `SEAT_USE_${cli.toUpperCase()}_00`;
  const slots = { version: 1, environment: 'cross-cli-seats',
    seats: [{ ...slot, useSecret }] };
  const result = await materialiseSeatEnvelopes({ seatSet: seatId, slotManifest: slots,
    secrets: { [useSecret]: JSON.stringify(envelope) }, baseDir: dir });
  return { result, dir, seatDir: join(dir, 'seats', seatId) };
}

async function codexEnvelope() {
  const { buildSeatEnvelope } = await provision();
  const homeDir = codexHome();
  try {
    const built = await buildSeatEnvelope({ seatId: 'codex', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-03T00:00:00.000Z', operationId: 'op-l7-codex-2',
      meshFacade: stubAccounts(['codex', 'acct-synth-codex-2']), meshScope: SYNTH_SCOPE,
      cliVersions: { codex: '0.162.1' } });
    return built.envelope;
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
}

test('L7: stage 1 stages the library record and carries the gate on the manifest', async () => {
  const envelope = await codexEnvelope();
  const { result, dir, seatDir } = await stageOne('codex', 'codex', envelope);
  try {
    assert.ok(fs.statSync(join(seatDir, '.codex/auth.json')).isFile(), 'auth files are staged');
    assert.ok(fs.statSync(join(seatDir, '.sentropic-seat/seat-record.v1.json')).isFile(),
      'the library seat record is staged');
    const manifest = JSON.parse(fs.readFileSync(result.manifestFile, 'utf8'));
    assert.equal(manifest.ownerScope, SYNTH_SCOPE);
    assert.equal(manifest.seats[0].onboarding.status, 'present');
    assert.deepEqual(manifest.seats[0].onboarding.gate, { eligible: true });
    assert.deepEqual(manifest.seats[0].onboarding.authFiles, ['.codex/auth.json']);
    assert.equal(result.receipt.seats[0].onboardingStatus, 'present');
    assert.deepEqual(result.receipt.seats[0].launchGate, { eligible: true });
    assert.ok(!JSON.stringify(result.receipt).includes('contentBase64'),
      'the receipt carries names only, never block bytes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L7: stage 1 refuses a tampered block with a typed code and writes nothing', async () => {
  const envelope = await codexEnvelope();
  const raw = envelope.onboarding.files[0].contentBase64;
  envelope.onboarding.files[0].contentBase64 = raw.slice(0, -4) + 'AAAA';
  const { materialiseSeatEnvelopes } = await import('./xcli-seat-import.mjs');
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-onboard-stage1-tamper-'));
  try {
    const slot = seatSlot('codex', 'codex');
    const useSecret = 'SEAT_USE_CODEX_00';
    await assert.rejects(materialiseSeatEnvelopes({ seatSet: 'codex',
      slotManifest: { version: 1, environment: 'cross-cli-seats', seats: [{ ...slot, useSecret }] },
      secrets: { [useSecret]: JSON.stringify(envelope) }, baseDir: dir }),
    /seat-stage-refused:codex:onboarding-/);
    assert.ok(!fs.existsSync(join(dir, 'seats', 'codex')), 'a refused batch writes zero bytes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L7: stage 1 refuses a non-minimized claude auth file', async () => {
  const { buildSeatEnvelope } = await provision();
  const homeDir = claudeHome();
  try {
    const built = await buildSeatEnvelope({ seatId: 'claude', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-03T00:00:00.000Z', operationId: 'op-l7-claude-2',
      meshFacade: stubAccounts(['claude-code', 'acct-synth-claude-2']), meshScope: SYNTH_SCOPE,
      cliVersions: { claude: '2.1.301' } });
    built.envelope.files['.claude.json'] = Buffer.from(JSON.stringify({ oauthAccount: {},
      hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.301',
      projects: { '/owner/old': {} } })).toString('base64');
    const { materialiseSeatEnvelopes } = await import('./xcli-seat-import.mjs');
    const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-onboard-stage1-wide-'));
    try {
      const slot = seatSlot('claude', 'claude');
      const useSecret = 'SEAT_USE_CLAUDE_00';
      await assert.rejects(materialiseSeatEnvelopes({ seatSet: 'claude',
        slotManifest: { version: 1, environment: 'cross-cli-seats', seats: [{ ...slot, useSecret }] },
        secrets: { [useSecret]: JSON.stringify(built.envelope) }, baseDir: dir }),
      /seat-stage-refused:claude:onboarding-shape-unverified/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

// ---- Stage 2: the library writes trust records only into the bench cell dir. ----

function cellLayout() {
  const root = fs.mkdtempSync(join(tmpdir(), 'xcli-onboard-cell-'));
  const dir = join(root, 'role');
  fs.mkdirSync(dir, { mode: 0o700 });
  const workspace = join(dir, 'workspace');
  fs.mkdirSync(workspace, { mode: 0o700 });
  const cellHome = join(dir, 'home');
  const configDirs = { claudeConfigDir: join(cellHome, '.claude'), codexHome: join(cellHome, '.codex'),
    xdgConfigHome: join(cellHome, '.config') };
  return { root, dir, workspace, cellHome, configDirs };
}

const listAll = root => {
  const out = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      out.push(full);
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out.sort();
};

test('L7: stage 2 writes the codex cell from the library receipt and nothing outside it', async () => {
  const { materialiseSeatCell } = await import('./xcli-seat-import.mjs');
  const envelope = await codexEnvelope();
  const { dir, seatDir } = await stageOne('codex', 'codex', envelope);
  const layout = cellLayout();
  const before = listAll(layout.root);
  try {
    const report = await materialiseSeatCell({ cli: 'codex', seatDir, cellHome: layout.cellHome,
      workspaceDir: layout.workspace, configDirs: layout.configDirs,
      expectedNativeCliVersion: '0.162.1', ownerScope: SYNTH_SCOPE,
      codexMcpServers: [{ name: 'h2a', command: join(layout.dir, 'bin', 'h2a'),
        args: ['mcp-serve'], defaultToolsApprovalMode: 'approve' }],
      authFiles: ['.codex/auth.json'], destKeys: ['codex-config'] });
    assert.deepEqual(report.copied.sort(), ['.codex/auth.json', '.codex/config.toml'].sort());
    assert.deepEqual(report.skipped, []);
    const config = fs.readFileSync(join(layout.configDirs.codexHome, 'config.toml'), 'utf8');
    assert.match(config, /trust_level = "trusted"/);
    assert.match(config, /\[mcp_servers\.h2a\]/);
    const after = listAll(layout.root);
    assert.ok(after.every(path => path === layout.dir || path.startsWith(layout.dir + '/')),
      'every write lands inside the bench role dir');
    assert.ok(before.every(path => fs.existsSync(path)), 'no pre-existing path was removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('L7: stage 2 refuses a closed gate with zero writes', async () => {
  const { buildSeatEnvelope } = await import('./xcli-seat-provision.mjs');
  const { materialiseSeatCell } = await import('./xcli-seat-import.mjs');
  const homeDir = codexHome();
  try {
    const denied = new Error('denied');
    denied.code = 'EROFS';
    const built = await buildSeatEnvelope({ seatId: 'codex', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-03T00:00:00.000Z', operationId: 'op-l7-codex-3',
      meshFacade: { listAccounts: async () => { throw denied; } }, meshScope: SYNTH_SCOPE,
      cliVersions: { codex: '0.162.1' } });
    assert.equal(built.source.onboardingStatus, 'absent');
    const { dir, seatDir } = await stageOne('codex', 'codex', built.envelope);
    const layout = cellLayout();
    try {
      await assert.rejects(materialiseSeatCell({ cli: 'codex', seatDir, cellHome: layout.cellHome,
        workspaceDir: layout.workspace, configDirs: layout.configDirs,
        expectedNativeCliVersion: '0.162.1', ownerScope: SYNTH_SCOPE,
        codexMcpServers: [], authFiles: [], destKeys: [] }),
      /seat-cell-refused:onboarding-required/);
      assert.ok(!fs.existsSync(layout.cellHome), 'a refused cell writes zero bytes');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(layout.root, { recursive: true, force: true });
    }
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

test('L7: stage 2 refuses a version mismatch with zero writes', async () => {
  const { materialiseSeatCell } = await import('./xcli-seat-import.mjs');
  const envelope = await codexEnvelope();
  const { dir, seatDir } = await stageOne('codex', 'codex', envelope);
  const layout = cellLayout();
  try {
    await assert.rejects(materialiseSeatCell({ cli: 'codex', seatDir, cellHome: layout.cellHome,
      workspaceDir: layout.workspace, configDirs: layout.configDirs,
      expectedNativeCliVersion: '9.9.9', ownerScope: SYNTH_SCOPE,
      codexMcpServers: [], authFiles: ['.codex/auth.json'], destKeys: ['codex-config'] }),
    /seat-cell-refused:onboarding-version-mismatch/);
    assert.ok(!fs.existsSync(layout.cellHome), 'a refused cell writes zero bytes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(layout.root, { recursive: true, force: true });
  }
});

test('L7: the trust write is limited to the empty bench-created workspace', async () => {
  const { buildSeatEnvelope } = await import('./xcli-seat-provision.mjs');
  const { materialiseSeatCell } = await import('./xcli-seat-import.mjs');
  assert.ok(vendor, 'vendor module required');
  const homeDir = museHome();
  try {
    const built = await buildSeatEnvelope({ seatId: 'muse', slot: { slot: '00' }, homeDir,
      ownerScope: SYNTH_SCOPE, issuedAt: '2026-11-03T00:00:00.000Z', operationId: 'op-l7-muse-9',
      meshFacade: stubAccounts(['muse', 'acct-synth-muse-9']), meshScope: SYNTH_SCOPE,
      cliVersions: { muse: '1.4.14' } });
    const { dir, seatDir } = await stageOne('muse', 'muse', built.envelope);
    const layout = cellLayout();
    fs.writeFileSync(join(layout.workspace, 'owner-file.txt'), 'not empty');
    try {
      await assert.rejects(materialiseSeatCell({ cli: 'muse', seatDir, cellHome: layout.cellHome,
        workspaceDir: layout.workspace, configDirs: layout.configDirs,
        expectedNativeCliVersion: '1.4.14', ownerScope: SYNTH_SCOPE,
        authFiles: ['.config/muse/auth.json'], destKeys: ['muse-trust'] }),
      /seat-cell-refused/);
      assert.ok(!fs.existsSync(layout.cellHome), 'a refused cell writes zero bytes');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(layout.root, { recursive: true, force: true });
    }
  } finally { fs.rmSync(homeDir, { recursive: true, force: true }); }
});

// ---- Launch gate: closed seats never spawn. ----

test('L7: the launch gate maps manifest seats to proceed or typed refusal', async () => {
  const { onboardingLaunchBlock } = await import('./xcli-seat-import.mjs');
  assert.equal(onboardingLaunchBlock(null), undefined, 'seats without onboarding state keep the old path');
  assert.equal(onboardingLaunchBlock({ family: 'vibe' }), undefined, 'vibe keeps the old path');
  assert.equal(onboardingLaunchBlock({ family: 'codex',
    onboarding: { status: 'present', gate: { eligible: true } } }), undefined);
  assert.equal(onboardingLaunchBlock({ family: 'codex',
    onboarding: { status: 'absent', gate: { eligible: false, code: 'onboarding-required' } } }),
  'onboarding-required');
  assert.equal(onboardingLaunchBlock({ family: 'agy',
    onboarding: { status: 'absent', gate: { eligible: false, code: 'onboarding-required' } } }),
  'onboarding-required');
});

// ---- Seat load: envelopes carrying blocks validate their binding. ----

function loadViaStdin(seatId, slotsFile, envelopeJson) {
  const load = new URL('./xcli-seat-load.mjs', import.meta.url).pathname;
  return spawnSync(process.execPath, [load, '--seat', seatId, '--slot-manifest', slotsFile],
    { input: envelopeJson, encoding: 'utf8', timeout: 15000 });
}

test('L7: seat-load accepts a bound block and names its gate', async () => {
  const envelope = await codexEnvelope();
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-onboard-load-'));
  try {
    const slots = join(dir, 'slots.json');
    fs.writeFileSync(slots, JSON.stringify({ version: 1, environment: 'cross-cli-seats',
      seats: [{ seatId: 'codex', cli: 'codex', slot: '00', secret: 'SEAT_CODEX_00',
        candidateSecret: 'SEAT_CANDIDATE_CODEX_00', useSecret: 'SEAT_USE_CODEX_00' }] }));
    const probed = loadViaStdin('codex', slots, JSON.stringify(envelope));
    assert.equal(probed.status, 0, probed.stderr);
    const receipt = JSON.parse(probed.stdout);
    assert.equal(receipt.onboardingStatus, 'present');
    assert.deepEqual(receipt.launchGate, { eligible: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('L7: seat-load refuses a tampered block with a typed code', async () => {
  const envelope = await codexEnvelope();
  envelope.onboarding.files[0].contentBase64 = envelope.onboarding.files[0].contentBase64.slice(0, -4) + 'AAAA';
  const dir = fs.mkdtempSync(join(tmpdir(), 'xcli-onboard-load-tamper-'));
  try {
    const slots = join(dir, 'slots.json');
    fs.writeFileSync(slots, JSON.stringify({ version: 1, environment: 'cross-cli-seats',
      seats: [{ seatId: 'codex', cli: 'codex', slot: '00', secret: 'SEAT_CODEX_00',
        candidateSecret: 'SEAT_CANDIDATE_CODEX_00', useSecret: 'SEAT_USE_CODEX_00' }] }));
    const probed = loadViaStdin('codex', slots, JSON.stringify(envelope));
    assert.notEqual(probed.status, 0, 'a tampered block never loads');
    assert.match(probed.stdout, /seat-load-refused:codex:onboarding-/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
