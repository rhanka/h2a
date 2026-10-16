// R1 real-process cut. Only the injected temporary source/store are touched.
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const [moduleUrl, optionsJson, requestJson, cut] = process.argv.slice(2);
const options = JSON.parse(optionsJson);
const report = value => fs.writeSync(1, JSON.stringify(value) + "\n");
let paused = false;
function pause() {
  if (paused) return;
  paused = true; report({ paused: true }); process.kill(process.pid, "SIGSTOP");
}
const rename = fs.renameSync;
fs.renameSync = function (from, to) {
  if (cut === "pack" && String(to).includes("objects.git/objects/pack/") && String(to).endsWith(".pack")) pause();
  return rename.call(this, from, to);
};
const exec = childProcess.execFileSync;
childProcess.execFileSync = function (command, args, ...rest) {
  if (cut === "pin" && command === "git" && args.includes("update-ref")) pause();
  return exec.call(this, command, args, ...rest);
};
syncBuiltinESMExports();
const { createLiveObjectStore } = await import(moduleUrl);
const store = createLiveObjectStore(options);
await store.recordRequest(JSON.parse(requestJson));
report({ done: true, pending: await store.pending() });
