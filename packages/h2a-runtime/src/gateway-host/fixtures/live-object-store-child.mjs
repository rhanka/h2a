// R1 real-process cut. Only the injected temporary source/store are touched.
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const [moduleUrl, optionsJson, requestJson, cut] = process.argv.slice(2);
const options = JSON.parse(optionsJson);
const report = value => fs.writeSync(1, JSON.stringify(value) + "\n");
let paused = false;
let fscks = 0;
let vanished = false;
const stat = fs.statSync;
fs.statSync = function(path, ...args) {
  if (cut === "vanish-lock" && String(path).endsWith("/acquisition.lock") && !vanished) {
    vanished = true; fs.rmSync(path, { recursive: true, force: true });
  }
  return stat.call(this, path, ...args);
};
const writes = [];
function pause() {
  if (paused) return;
  paused = true; report({ paused: true }); writes.length = 0; process.kill(process.pid, "SIGSTOP");
}
const rename = fs.renameSync;
fs.renameSync = function (from, to) {
  if (cut === "pack" && String(to).includes("objects.git/objects/pack/") && String(to).endsWith(".pack")) pause();
  if (cut === "pin" && String(to).includes("objects.git/refs/h2a/retained/")) pause();
  if (cut === "receipt" && String(to).includes("/receipts/")) pause();
  const result = rename.call(this, from, to);
  if (String(to).includes("objects.git/") || String(to).includes("/receipts/") || String(to).includes("/gaps/")) writes.push(String(to));
  return result;
};
const exec = childProcess.execFileSync;
childProcess.execFileSync = function (command, args, ...rest) {
  if (cut === "pin" && command === "git" && args.includes("update-ref")) pause();
  if (command === "git" && args.includes("fsck")) fscks++;
  const result = exec.call(this, command, args, ...rest);
  if (command === "git" && args.includes("update-ref")) writes.push("update-ref");
  return result;
};
syncBuiltinESMExports();
const { createLiveObjectStore } = await import(moduleUrl);
const store = createLiveObjectStore(options);
await store.recordRequest(JSON.parse(requestJson));
const acquisitionFscks = fscks;
if (cut === "audit") {
  await store.loadReceipts({ scope: options.scope, algorithm: options.algorithm });
  await store.recordRequest(JSON.parse(requestJson));
}
report({ done: true, pending: await store.pending(), readFscks: fscks - acquisitionFscks, vanished, writes });
