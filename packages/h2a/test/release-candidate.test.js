import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import YAML from 'yaml'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const script = join(repo, 'scripts/release-candidate.mjs')
const workflow = YAML.parse(readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8'))
const names = ['track', 'h2a-runtime', 'h2a', 'h2a-cli', 'focus']
const packageVersion = name => name === 'focus' ? '0.5.0-rc.1' : version
const version = '0.98.6-rc.1', tree = 'a'.repeat(40), sha = 'b'.repeat(40)

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'release-candidate-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ['bin', 'run', 'scripts', 'dist-tarballs']) mkdirSync(join(root, dir))
  for (const name of names) {
    mkdirSync(join(root, 'packages', name), { recursive: true })
    writeFileSync(join(root, 'packages', name, 'package.json'), JSON.stringify({
      name: '@sentropic/' + name, version: name === 'focus' ? '0.5.0' : '0.98.6',
      dependencies: { '@sentropic/track': '0.98.6', external: '^1.0.0' },
      peerDependencies: { '@sentropic/h2a-runtime': '0.98.6' },
      optionalDependencies: { '@sentropic/h2a-cli': '0.98.6' },
      devDependencies: { '@sentropic/h2a': '0.98.6' },
    }))
    writeFileSync(join(root, 'dist-tarballs', `sentropic-${name}-${packageVersion(name)}.tgz`), 'verified bytes: ' + name)
  }
  writeFileSync(join(root, 'scripts/smoke-artifact.mjs'), "const PINNED_RUNTIME_VERSION = '0.98.6'\nconst PINNED_FOCUS_VERSION = '0.5.0'\n")
  const env = { PATH: join(root, 'bin') + ':' + process.env.PATH, HOME: root,
    XDG_RUNTIME_DIR: join(root, 'run'), TMPDIR: root,
    GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/tags/v' + version,
    GITHUB_REPOSITORY: 'rhanka/h2a', GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: sha, GITHUB_ENV: join(root, 'env'), GITHUB_OUTPUT: join(root, 'output'),
    FAKE_ROOT: root, FAKE_LATEST: '99.0.0', FAKE_TREE: tree, RC_SMOKE_PASSED: 'true' }
  function fake(name, body) {
    writeFileSync(join(root, 'bin', name), '#!' + process.execPath + '\n' + body, { mode: 0o700 })
  }
  fake('git', "console.log(process.argv.includes('HEAD^{tree}') ? process.env.FAKE_TREE : '" + sha + "')")
  fake('npm', `const fs=require('node:fs'),a=process.argv.slice(2);
    fs.appendFileSync(process.env.FAKE_ROOT+'/npm-calls',JSON.stringify(a)+'\\n');
    if(a[0]==='publish'){fs.writeFileSync(process.env.FAKE_ROOT+'/published','yes');process.exit(process.env.FAKE_PUBLISH_FAIL==='1'?37:0)}
    if(a[0]==='view'&&a[2]==='dist-tags.next'){console.log(JSON.stringify((a[1]==='@sentropic/focus'?process.env.FAKE_FOCUS_NEXT:process.env.FAKE_NEXT)||(a[1]==='@sentropic/focus'?'0.5.0-rc.1':'${version}')));process.exit(0)}
    if(a[0]==='view'&&a[2]==='dist.integrity'){
      const name=a[1].slice('@sentropic/'.length).split('@')[0];
      const bytes=fs.readFileSync(process.env.FAKE_ROOT+'/dist-tarballs/sentropic-'+name+'-'+(name==='focus'?'0.5.0-rc.1':'${version}')+'.tgz');
      console.log(JSON.stringify('sha512-'+require('node:crypto').createHash('sha512').update((process.env.FAKE_BAD_INTEGRITY==='1'||(name==='focus'&&process.env.FAKE_FOCUS_BAD_INTEGRITY==='1'))?'other source tree':bytes).digest('base64')));process.exit(0);
    }
    if(a[0]==='view'&&a[2]==='dist-tags.latest'){console.log(process.env.FAKE_LATEST);process.exit(0)}
    if(a[0]==='view'&&a[2]==='version')process.exit(fs.existsSync(process.env.FAKE_ROOT+'/published')?0:1);
    if(a[0]==='i')process.exit(process.env.FAKE_INSTALL_FAIL==='1'?1:0);
    process.exit(79);`)
  fake('h2a', `if(process.argv[2]==='doctor')console.log(process.env.FAKE_DOCTOR||'{"ok":true}');else if(process.argv[2]!=='init')process.exit(89);`)
  fake('sleep', 'process.exit(0)')
  const run = { id: 100, run_attempt: 1, event: 'push', status: 'completed', conclusion: 'success',
    path: '.github/workflows/release.yml', head_branch: 'v' + version, head_sha: sha,
    head_repository: { full_name: 'rhanka/h2a' } }
  const record = { schema: 1, kind: 'rc', repository: 'rhanka/h2a', runId: '100', runAttempt: '1',
    version, sourceSha: sha, sourceTree: tree, registryTag: 'next', smokePassed: true,
    packages: Object.fromEntries(names.map(name => ['@sentropic/' + name, packageVersion(name)])) }
  writeFileSync(join(root, 'runs.json'), JSON.stringify([{ workflow_runs: [run] }]))
  writeFileSync(join(root, 'record.json'), JSON.stringify(record))
  fake('gh', `const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2),r=process.env.FAKE_ROOT;
    fs.appendFileSync(r+'/gh-calls',JSON.stringify(a)+'\\n');
    if(process.env.FAKE_API_FAIL==='1')process.exit(42);
    if(a[0]==='api'){
      const endpoint=a.find(x=>x.startsWith('repos/'));
      if(endpoint.includes('/runs?'))console.log(fs.readFileSync(r+'/runs.json','utf8'));
      else if(endpoint.includes('/artifacts'))console.log(JSON.stringify([{artifacts:process.env.FAKE_EXPIRED==='1'?[]:[{id:200,name:'release-attestation-1',expired:false,workflow_run:{id:100,head_sha:'${sha}'}}]}]));
      else if(endpoint.includes('/git/commits/'))console.log(JSON.stringify({tree:{sha:process.env.FAKE_RC_TREE||'${tree}'}}));
      else process.exit(77);
    }else if(a[0]==='run'&&a[1]==='download'){
      const dest=a[a.indexOf('--dir')+1];fs.mkdirSync(dest,{recursive:true});fs.copyFileSync(r+'/record.json',path.join(dest,'attestation.json'));
    }else process.exit(78);`)
  return { root, env, run, record,
    invoke: (mode, overrides = {}) => spawnSync(process.execPath, [script, mode], {
      cwd: root, encoding: 'utf8', env: { ...env, ...overrides }, timeout: 20_000,
    }),
    saveRuns: (runs) => writeFileSync(join(root, 'runs.json'), JSON.stringify([{ workflow_runs: runs }])),
    saveRecord: (value) => writeFileSync(join(root, 'record.json'), JSON.stringify(value)),
  }
}

test('RC tag stamps five packages with independent focus version and every internal exact pin, then publishes next only', t => {
  const f = fixture(t)
  const stamped = f.invoke('prepare')
  assert.equal(stamped.status, 0, stamped.stdout + stamped.stderr)
  const sums = []
  for (const name of names) {
    const pkg = JSON.parse(readFileSync(join(f.root, 'packages', name, 'package.json')))
    assert.equal(pkg.version, packageVersion(name))
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
      for (const [key, value] of Object.entries(pkg[field])) assert.equal(value, key === 'external' ? '^1.0.0' : version)
    }
    const file = `sentropic-${name}-${packageVersion(name)}.tgz`, bytes = Buffer.from(name)
    writeFileSync(join(f.root, 'dist-tarballs', file), bytes)
    sums.push(createHash('sha256').update(bytes).digest('hex') + '  ' + file)
  }
  assert.match(readFileSync(join(f.root, 'scripts/smoke-artifact.mjs'), 'utf8'), /0\.98\.6-rc\.1/)
  writeFileSync(join(f.root, 'dist-tarballs/sha256sums.txt'), sums.join('\n') + '\n')
  const publishes = workflow.jobs.publish.steps.filter(s => String(s.run).includes('npm publish "./dist-tarballs/'))
  assert.equal(publishes.length, 5)
  for (const latest of ['', '0.98.5', '99.0.0']) for (const step of publishes) {
    rmSync(join(f.root, 'published'), { force: true })
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      cwd: f.root, env: { ...f.env, FAKE_LATEST: latest }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
  const calls = readFileSync(join(f.root, 'npm-calls'), 'utf8').trim().split('\n').map(JSON.parse).filter(a => a[0] === 'publish')
  assert.equal(calls.length, 15)
  for (const args of calls) assert.deepEqual(args.slice(2), ['--access', 'public', ...(args[1].includes('sentropic-focus-') ? ['--provenance'] : []), '--tag', 'next'])
})

test('RC prepare rewrites both smoke pins to the exact RC versions so the smoke version gate passes', t => {
  const f = fixture(t)
  const stamped = f.invoke('prepare')
  assert.equal(stamped.status, 0, stamped.stdout + stamped.stderr)
  const smoke = readFileSync(join(f.root, 'scripts/smoke-artifact.mjs'), 'utf8')
  assert.match(smoke, /^const PINNED_RUNTIME_VERSION = '0\.98\.6-rc\.1'$/m)
  assert.match(smoke, /^const PINNED_FOCUS_VERSION = '0\.5\.0-rc\.1'$/m)
  // The smoke version gate compares each prepared manifest to its rewritten
  // pin: both must match exactly, otherwise verify fails before publish.
  const runtimeVersion = JSON.parse(readFileSync(join(f.root, 'packages', 'h2a-runtime', 'package.json'))).version
  const focusVersion = JSON.parse(readFileSync(join(f.root, 'packages', 'focus', 'package.json'))).version
  assert.equal(runtimeVersion, '0.98.6-rc.1')
  assert.equal(focusVersion, '0.5.0-rc.1')
})

test('stable prepare leaves both smoke pins on their trains', t => {
  const f = fixture(t)
  const stable = f.invoke('prepare', { GITHUB_REF: 'refs/tags/v0.98.6' })
  assert.equal(stable.status, 0, stable.stdout + stable.stderr)
  const smoke = readFileSync(join(f.root, 'scripts/smoke-artifact.mjs'), 'utf8')
  assert.match(smoke, /^const PINNED_RUNTIME_VERSION = '0\.98\.6'$/m)
  assert.match(smoke, /^const PINNED_FOCUS_VERSION = '0\.5\.0'$/m)
})

test('RC prepare fails closed when the focus pin drifts, before writing any manifest', t => {
  const f = fixture(t), manifest = join(f.root, 'packages/track/package.json')
  const before = readFileSync(manifest, 'utf8')
  writeFileSync(join(f.root, 'scripts/smoke-artifact.mjs'), "const PINNED_RUNTIME_VERSION = '0.98.6'\nconst PINNED_FOCUS_VERSION = '0.4.0'\n")
  const result = f.invoke('prepare')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /focus.*pin/)
  assert.equal(readFileSync(manifest, 'utf8'), before)
})

test('stable tag without a matching RC is refused, including backfill dispatch', t => {
  const f = fixture(t)
  f.saveRuns([])
  for (const overrides of [{ GITHUB_REF: 'refs/tags/v0.98.6' }, { BACKFILL_VERSION: '0.98.6' }]) {
    const result = f.invoke('require-rc', overrides)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /No successful RC attestation/)
  }
})

test('stable tag accepts a successful same-tree RC with next publication and completed smoke', t => {
  const f = fixture(t)
  const result = f.invoke('require-rc', { GITHUB_REF: 'refs/tags/v0.98.6' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /100.*0\.98\.6-rc\.1/)
})

test('stable tag refuses a different source tree, including a falsified record', t => {
  const f = fixture(t)
  for (const overrides of [{ FAKE_TREE: 'c'.repeat(40) }, { FAKE_RC_TREE: 'd'.repeat(40) }]) {
    const result = f.invoke('require-rc', { GITHUB_REF: 'refs/tags/v0.98.6', ...overrides })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /No successful RC attestation/)
  }
})

test('RC attestation requires every next tag and an explicit completed post-publish smoke', t => {
  const f = fixture(t)
  for (const overrides of [{ RC_SMOKE_PASSED: '' }, { FAKE_NEXT: '0.98.5-rc.9' }]) {
    const result = f.invoke('attest', overrides)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /smoke|next/)
  }
  const result = f.invoke('attest')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(join(f.root, 'release-attestation/attestation.json'))), f.record)
})

test('RC attestation refuses already-published bytes from a different source tree', t => {
  const f = fixture(t)
  const result = f.invoke('attest', { FAKE_BAD_INTEGRITY: '1' })
  assert.notEqual(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stderr, /integrity/)
})

test('stable gate fails closed for incomplete, foreign, expired, stale or malformed evidence', t => {
  const f = fixture(t)
  for (const change of [{ conclusion: 'failure' }, { event: 'workflow_dispatch' },
    { path: '.github/workflows/other.yml' }, { head_branch: 'v0.98.7-rc.1' },
    { head_repository: { full_name: 'other/h2a' } }, { head_branch: version }, { run_attempt: 2 }]) {
    f.saveRuns([{ ...f.run, ...change }])
    assert.notEqual(f.invoke('require-rc', { GITHUB_REF: 'refs/tags/v0.98.6' }).status, 0, JSON.stringify(change))
  }
  f.saveRuns([f.run])
  for (const change of [{ smokePassed: false }, { registryTag: 'latest' }, { sourceSha: 'e'.repeat(40) },
    { repository: 'other/h2a' }, { runId: '101' }, { runAttempt: '2' }, { packages: {} }, { schema: 2 }]) {
    f.saveRecord({ ...f.record, ...change })
    assert.notEqual(f.invoke('require-rc', { GITHUB_REF: 'refs/tags/v0.98.6' }).status, 0, JSON.stringify(change))
  }
  f.saveRecord(f.record)
  for (const overrides of [{ FAKE_API_FAIL: '1' }, { FAKE_EXPIRED: '1' }]) {
    assert.notEqual(f.invoke('require-rc', { GITHUB_REF: 'refs/tags/v0.98.6', ...overrides }).status, 0)
  }
  writeFileSync(join(f.root, 'record.json'), '{')
  assert.notEqual(f.invoke('require-rc', { GITHUB_REF: 'refs/tags/v0.98.6' }).status, 0)
})

test('workflow always gates stable publication and attests only after the real install smoke', () => {
  const verify = workflow.jobs.verify.steps, publish = workflow.jobs.publish.steps
  const prepare = steps => steps.findIndex(s => s.run === 'node scripts/release-candidate.mjs prepare')
  assert.ok(prepare(verify) > verify.findIndex(s => s.run === 'npm test'))
  assert.ok(prepare(verify) < verify.findIndex(s => String(s.run).includes('node scripts/pack-candidate.mjs')))
  assert.ok(prepare(publish) >= 0)
  const gate = publish.findIndex(s => s.run === 'node scripts/release-candidate.mjs require-rc')
  const firstPublish = publish.findIndex(s => String(s.run).includes('npm publish "./dist-tarballs/'))
  assert.ok(gate >= 0 && gate < firstPublish)
  assert.equal(publish[gate].if, undefined)
  assert.equal(workflow.permissions.actions, 'read')
  const smoke = publish.findIndex(s => s.id === 'post-publish-smoke')
  const attest = publish.findIndex(s => s.run === 'node scripts/release-candidate.mjs attest')
  const upload = publish.findIndex(s => s.with?.name === 'release-attestation-${{ github.run_attempt }}')
  assert.ok(firstPublish < smoke && smoke < attest && attest < upload)
  assert.equal(publish[attest].env.RC_SMOKE_PASSED, '${{ steps.post-publish-smoke.outputs.smoke-passed }}')
  assert.equal(publish[upload].with['if-no-files-found'], 'error')
  assert.equal(publish[upload].if, undefined)
})

test('RC install smoke refuses install propagation lag and broken doctor; only completion emits proof', t => {
  const f = fixture(t)
  const smoke = workflow.jobs.publish.steps.find(s => s.id === 'post-publish-smoke')
  assert.ok(smoke)
  writeFileSync(join(f.root, 'published'), 'yes')
  for (const overrides of [{ FAKE_INSTALL_FAIL: '1' }, { FAKE_DOCTOR: '{"ok":false,"unrepaired":[{"code":"broken"}]}' }, {}]) {
    rmSync(f.env.GITHUB_OUTPUT, { force: true })
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', smoke.run], {
      cwd: f.root, encoding: 'utf8', env: { ...f.env, RELEASE_VERSION: version, ...overrides },
    })
    if (Object.keys(overrides).length) {
      assert.notEqual(result.status, 0, result.stdout + result.stderr)
      assert.throws(() => readFileSync(f.env.GITHUB_OUTPUT), /ENOENT/)
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.equal(readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), 'smoke-passed=true\n')
    }
  }
})

test('tag validation and manifest drift fail before any RC file is written; stable prepare leaves source unchanged', t => {
  const f = fixture(t), manifest = join(f.root, 'packages/track/package.json')
  const before = readFileSync(manifest, 'utf8')
  for (const ref of ['v0.98.6-rc.01', 'v0.98.6-beta.1', 'v0.98.6-rc.1+build', 'v00.98.6', 'v0.98.7-rc.1']) {
    const result = f.invoke('prepare', { GITHUB_REF: 'refs/tags/' + ref })
    assert.notEqual(result.status, 0, ref)
    assert.equal(readFileSync(manifest, 'utf8'), before)
  }
  const stable = f.invoke('prepare', { GITHUB_REF: 'refs/tags/v0.98.6' })
  assert.equal(stable.status, 0, stable.stderr)
  assert.equal(readFileSync(manifest, 'utf8'), before)
  writeFileSync(join(f.root, 'scripts/smoke-artifact.mjs'), "const PINNED_RUNTIME_VERSION = '0.98.5'\nconst PINNED_FOCUS_VERSION = '0.5.0'\n")
  assert.notEqual(f.invoke('prepare').status, 0)
  assert.equal(readFileSync(manifest, 'utf8'), before)
})

test('focus alone must have the intended next tag and verified RC bytes', t => {
  const f = fixture(t)
  for (const overrides of [{ FAKE_FOCUS_NEXT: '0.5.0-rc.9' }, { FAKE_FOCUS_BAD_INTEGRITY: '1' }]) {
    const result = f.invoke('attest', overrides)
    assert.notEqual(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stderr, /focus.*(next|integrity)/)
  }
})

test('stable refuses an RC proof missing focus or carrying a wrong focus version', t => {
  const f = fixture(t)
  for (const value of [undefined, version, '0.4.0-rc.1']) {
    const record = structuredClone(f.record)
    if (value === undefined) delete record.packages['@sentropic/focus']
    else record.packages['@sentropic/focus'] = value
    f.saveRecord(record)
    const result = f.invoke('require-rc', { GITHUB_REF: 'refs/tags/v0.98.6' })
    assert.notEqual(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stderr, /No successful RC attestation/)
  }
})

test('publish sanity refuses legacy four-package preparation and stale focus versions before publication', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'scripts/check-lockstep-versions.mjs'), readFileSync(join(repo, 'scripts/check-lockstep-versions.mjs')))
  const sanity = workflow.jobs.publish.steps.find(s => s.name === 'Version sanity gate (tag vs package.json)')
  const script = sanity.run.replaceAll('${{ needs.verify.outputs.release-sha }}', sha)
  for (const tagVersion of [version, '0.98.6']) {
    // Simulate the four-package prepare helper from an older gated checkout.
    for (const name of names) {
      const path = join(f.root, 'packages', name, 'package.json')
      const pkg = JSON.parse(readFileSync(path))
      pkg.version = name === 'focus' ? '0.5.0' : tagVersion
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
        for (const dep of Object.keys(pkg[field])) if (dep.startsWith('@sentropic/')) pkg[field][dep] = tagVersion
      }
      writeFileSync(path, JSON.stringify(pkg))
    }
    for (const marker of [undefined, '0.4.0-rc.1']) {
      const env = { ...f.env, GITHUB_REF: 'refs/tags/v' + tagVersion }
      if (marker !== undefined) env.FOCUS_RELEASE_VERSION = marker
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd: f.root, env, encoding: 'utf8' })
      assert.notEqual(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stderr, /focus.*prepar/i)
    }
  }
})

test('five-package prepare hands the independent focus version to the publication sanity gate', t => {
  for (const tagVersion of [version, '0.98.6']) {
    const f = fixture(t)
    writeFileSync(join(f.root, 'scripts/check-lockstep-versions.mjs'), readFileSync(join(repo, 'scripts/check-lockstep-versions.mjs')))
    const result = f.invoke('prepare', { GITHUB_REF: 'refs/tags/v' + tagVersion })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const prepared = Object.fromEntries(readFileSync(f.env.GITHUB_ENV, 'utf8').trim().split('\n').map(line => line.split('=')))
    assert.equal(prepared.FOCUS_RELEASE_VERSION, tagVersion === version ? '0.5.0-rc.1' : '0.5.0')
    const sanity = workflow.jobs.publish.steps.find(s => s.name === 'Version sanity gate (tag vs package.json)')
    const script = sanity.run.replaceAll('${{ needs.verify.outputs.release-sha }}', sha)
    const gate = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd: f.root, env: { ...f.env, ...prepared, GITHUB_REF: 'refs/tags/v' + tagVersion }, encoding: 'utf8' })
    assert.equal(gate.status, 0, gate.stdout + gate.stderr)
  }
})
