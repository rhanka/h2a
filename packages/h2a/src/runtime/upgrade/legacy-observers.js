import fs from 'node:fs';
import cp from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assessNpmCommand } from './npm-command.js';
import { assessLegacyExclusion } from './legacy-exclusion.js';
// Real observers for the four §8.4 closures on live published legacy
// dists (.5/.6). Each observer reads only: it never signals a foreign PID,
// never writes into the legacy tree, and fails closed (`established:
// false` with a stated detail) whenever an observation is missing. The
// returned evidence feeds `assessLegacyExclusion` directly; anything short
// of four established closures verdicts `legacy_installer_unfenced`.
//
// Legacy identity is a precondition, not a closure: the observed tree must
// be the real `@sentropic/h2a` legacy installer at the expected version,
// predating the H4 proof (no `assessLegacyExclusion` export) and carrying
// no durable birth identity (`bootId`). A PID absence is therefore never a
// provenance: liveness stays `owner_liveness_unknown`.
const LEGACY_PACKAGE = '@sentropic/h2a';
const LEGACY_UPGRADE_INDEX = 'dist/runtime/upgrade/index.js';
function fail(detail) {
    return Object.freeze({ established: false, detail });
}
function checkEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope))
        throw new Error('legacy_observer_invalid');
}
export function verifyLegacyRoot(legacyRoot, version) {
    if (typeof legacyRoot !== 'string' || !isAbsolute(legacyRoot))
        throw new Error('legacy_observer_invalid');
    if (typeof version !== 'string' || !version)
        throw new Error('legacy_observer_invalid');
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(join(legacyRoot, 'package.json'), 'utf8'));
    }
    catch {
        throw new Error('legacy_observer_unexpected_legacy');
    }
    if (pkg?.name !== LEGACY_PACKAGE || pkg?.version !== version)
        throw new Error('legacy_observer_unexpected_legacy');
    const indexPath = join(legacyRoot, LEGACY_UPGRADE_INDEX);
    let bytes;
    try {
        bytes = fs.readFileSync(indexPath, 'utf8');
    }
    catch {
        throw new Error('legacy_observer_unexpected_legacy');
    }
    if (!bytes.includes('defaultUpgradeRuntime'))
        throw new Error('legacy_observer_unexpected_legacy');
    if (bytes.includes('assessLegacyExclusion') || bytes.includes('bootId'))
        throw new Error('legacy_observer_unexpected_legacy');
    const installerPath = join(legacyRoot, 'dist/bin.js');
    try {
        if (!fs.statSync(installerPath).isFile())
            throw new Error('legacy_observer_unexpected_legacy');
    }
    catch (cause) {
        if (cause?.message === 'legacy_observer_unexpected_legacy')
            throw cause;
        throw new Error('legacy_observer_unexpected_legacy');
    }
    return Object.freeze({
        name: pkg.name,
        version: pkg.version,
        installerPath,
        upgradeIndexPath: indexPath,
        indexSha256: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
        ownerLiveness: 'owner_liveness_unknown',
    });
}
// Live legacy workers: spawn OUR OWN child inside the legacy tree (cwd set
// to the observed root), execute the real published upgrade module there,
// await its exit, then prove no late mutation (sentinel stable across a
// quiescence delay) and no other live process holds the tree as cwd
// (read-only /proc scan; only PIDs we spawned may ever be stopped).
export async function observeWorkersTerminated({ legacyRoot, version, workDir, quiescenceDelayMs = 150 } = {}) {
    checkEnvelope({ legacyRoot });
    const identity = verifyLegacyRoot(legacyRoot, version);
    if (typeof workDir !== 'string' || !isAbsolute(workDir))
        throw new Error('legacy_observer_invalid');
    const sentinel = join(workDir, 'legacy-worker-sentinel.json');
    const script = `import fs from 'node:fs';\n` +
        `const legacy = await import(${JSON.stringify(pathToFileURL(identity.upgradeIndexPath).href)});\n` +
        `if (!legacy?.defaultUpgradeRuntime || typeof legacy.defaultUpgradeRuntime.probeStagedVersion !== 'function') throw new Error('legacy_upgrade_runtime_missing');\n` +
        `fs.writeFileSync(${JSON.stringify(sentinel)}, JSON.stringify({ version: ${JSON.stringify(version)}, pid: process.pid }));\n`;
    const child = cp.spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: legacyRoot, env: { PATH: process.env.PATH, HOME: workDir, TMPDIR: workDir }, stdio: 'ignore' });
    const outcome = await new Promise(resolve => {
        const deadline = setTimeout(() => resolve({ timeout: true }), 60000);
        child.once('close', (code, signal) => { clearTimeout(deadline); resolve({ timeout: false, code, signal }); });
        child.once('error', cause => { clearTimeout(deadline); resolve({ timeout: false, error: String(cause?.message ?? cause) }); });
    });
    if (outcome.timeout) {
        try {
            child.kill('SIGKILL');
        }
        catch { }
        return fail(`legacy ${version} worker pid ${child.pid} still alive after 60 s; own child stopped, closure unestablished`);
    }
    if (outcome.code !== 0) {
        return fail(`legacy ${version} worker pid ${child.pid} exited code ${outcome.code} signal ${outcome.signal ?? 'none'}; clean termination unobserved`);
    }
    let first;
    try {
        first = fs.readFileSync(sentinel, 'utf8');
        JSON.parse(first);
    }
    catch {
        return fail(`legacy ${version} worker pid ${child.pid} exited 0 without its mutation sentinel; termination unproven`);
    }
    await new Promise(resolve => setTimeout(resolve, quiescenceDelayMs));
    let second;
    try {
        second = fs.readFileSync(sentinel, 'utf8');
    }
    catch {
        return fail(`legacy ${version} worker sentinel vanished after exit of pid ${child.pid}; late mutation suspected`);
    }
    if (second !== first) {
        return fail(`legacy ${version} worker pid ${child.pid} mutated after exit; late write observed`);
    }
    const others = liveCwdHolders(legacyRoot, process.pid);
    if (others.length) {
        return fail(`legacy ${version} live worker pids ${others.join(',')} still hold ${legacyRoot}; termination unobserved`);
    }
    const sha = createHash('sha256').update(first).digest('hex').slice(0, 16);
    return Object.freeze({ established: true,
        detail: `legacy ${version} worker pid ${child.pid} exited 0, sentinel ${sha} stable, no other live cwd holder under ${legacyRoot}` });
}
function liveCwdHolders(root, selfPid) {
    const holders = [];
    let entries;
    try {
        entries = fs.readdirSync('/proc');
    }
    catch {
        throw new Error('legacy_observer_proc_unreadable');
    }
    for (const entry of entries) {
        if (!/^[0-9]+$/.test(entry))
            continue;
        const pid = Number(entry);
        if (pid === selfPid)
            continue;
        let cwd;
        try {
            cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
        }
        catch {
            continue;
        }
        if (cwd === root || cwd.startsWith(root + '/')) {
            let alive = false;
            try {
                const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
                alive = stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[2] !== 'Z';
            }
            catch {
                continue;
            }
            if (alive)
                holders.push(pid);
        }
    }
    return holders;
}
// Closed relaunch sources: scan the temp-scoped home and the legacy tree
// for well-known autostart/supervisor entries referencing the legacy root.
// Any reference keeps the closure unestablished with the offending path.
const RELAUNCH_LOCATIONS = ['.config/systemd/user', '.config/autostart', '.config/supervisor', 'Library/LaunchAgents'];
export function observeRelaunchSourcesClosed({ legacyRoot, version, homeDir } = {}) {
    checkEnvelope({ legacyRoot });
    verifyLegacyRoot(legacyRoot, version);
    if (typeof homeDir !== 'string' || !isAbsolute(homeDir))
        throw new Error('legacy_observer_invalid');
    let scanned = 0;
    const offenders = [];
    const visit = directory => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isSymbolicLink())
                continue;
            if (entry.isDirectory()) {
                visit(path);
                continue;
            }
            if (!entry.isFile())
                continue;
            scanned += 1;
            let bytes;
            try {
                bytes = fs.readFileSync(path, 'utf8');
            }
            catch {
                continue;
            }
            if (bytes.includes(legacyRoot))
                offenders.push(path);
        }
    };
    for (const location of RELAUNCH_LOCATIONS)
        visit(join(homeDir, location));
    visit(legacyRoot);
    if (offenders.length) {
        return fail(`legacy ${version} relaunch reference in ${offenders[0]}; sources stay open`);
    }
    return Object.freeze({ established: true,
        detail: `legacy ${version} no relaunch reference in ${scanned} files under ${RELAUNCH_LOCATIONS.length} home locations and the legacy tree` });
}
// Routed future starts: the real npm command classifier must report the
// command path as managed (resolving to the managed launcher), never as
// the legacy entry. Any other state keeps the closure unestablished.
export function observeFutureStartsRouted({ commandPath, managedLauncher, legacyEntry, version } = {}) {
    checkEnvelope({ commandPath });
    const verdict = assessNpmCommand({ commandPath, managedLauncher, legacyEntry });
    if (verdict.state === 'managed') {
        return Object.freeze({ established: true,
            detail: `command ${commandPath} resolves to the managed launcher, not the legacy ${version} entry` });
    }
    return fail(`command ${commandPath} classified ${verdict.state}, not managed; future starts unrouted`);
}
// Barred reintroduction: no symlink inside the managed tree may resolve
// into the legacy root, and no managed file may share the legacy
// installer bytes (hardlink alias). Both checks are read-only.
export function observeInstallerReintroductionBarred({ legacyRoot, version, managedDir } = {}) {
    checkEnvelope({ legacyRoot });
    const identity = verifyLegacyRoot(legacyRoot, version);
    if (typeof managedDir !== 'string' || !isAbsolute(managedDir))
        throw new Error('legacy_observer_invalid');
    const installerStat = fs.statSync(identity.installerPath);
    let scanned = 0;
    const visit = directory => {
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        }
        catch {
            return null;
        }
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                scanned += 1;
                const actual = resolve(dirname(path), fs.readlinkSync(path));
                if (actual === legacyRoot || actual.startsWith(legacyRoot + '/'))
                    return path;
                continue;
            }
            if (entry.isDirectory()) {
                const hit = visit(path);
                if (hit)
                    return hit;
                continue;
            }
            if (entry.isFile()) {
                scanned += 1;
                let stat;
                try {
                    stat = fs.statSync(path);
                }
                catch {
                    continue;
                }
                if (stat.dev === installerStat.dev && stat.ino === installerStat.ino)
                    return path;
            }
        }
        return null;
    };
    const hit = visit(managedDir);
    if (hit)
        return fail(`managed tree reaches the legacy installer through ${hit}; reintroduction open`);
    return Object.freeze({ established: true,
        detail: `legacy ${version} installer unreachable from ${scanned} managed entries; no link or shared inode into ${legacyRoot}` });
}
// Full live observation feeding the canonical verdict producer.
export async function observeLegacyClosures(envelope = {}) {
    checkEnvelope(envelope);
    const { legacyRoot, version, workDir, homeDir, commandPath, managedLauncher, legacyEntry, managedDir } = envelope;
    const workersTerminated = await observeWorkersTerminated({ legacyRoot, version, workDir });
    const relaunchSourcesClosed = observeRelaunchSourcesClosed({ legacyRoot, version, homeDir });
    const futureStartsRouted = observeFutureStartsRouted({ commandPath, managedLauncher, legacyEntry, version });
    const installerReintroductionBarred = observeInstallerReintroductionBarred({ legacyRoot, version, managedDir });
    return Object.freeze({ workersTerminated, relaunchSourcesClosed, futureStartsRouted, installerReintroductionBarred });
}
// M18 external proof producer: run the four live observers against the real
// legacy tree, persist the observed envelope as exclusion-evidence.json for
// the real bootstrap path (`readH4ExclusionEvidence`), and return the
// assessed verdict. The file is a truthful record of what was observed: an
// unfenced observation is persisted as observed (selection then defers via
// `selection_deferred:legacy_installer_unfenced`), never upgraded into a
// proof. Atomic write (tmp + rename + directory fsync), mode 0600.
export async function produceLegacyExclusionEvidence(envelope = {}) {
    checkEnvelope(envelope);
    const { legacyRoot, version, workDir, homeDir, commandPath, managedLauncher, legacyEntry, managedDir, managedRoot } = envelope;
    if (typeof managedRoot !== 'string' || !isAbsolute(managedRoot)) throw new Error('legacy_observer_invalid');
    const evidence = await observeLegacyClosures({ legacyRoot, version, workDir, homeDir, commandPath, managedLauncher, legacyEntry, managedDir });
    const verdict = assessLegacyExclusion(evidence);
    const path = join(managedRoot, 'exclusion-evidence.json');
    const staging = join(managedRoot, `.exclusion-evidence.json.${process.pid}.tmp`);
    fs.writeFileSync(staging, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(staging, path);
    const dirFd = fs.openSync(managedRoot, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    return Object.freeze({ path, verdict });
}