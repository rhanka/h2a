// Real-process regression driver. Only the injected temporary store is read.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const [moduleUrl, root, id, operation, cut] = process.argv.slice(2);
const path = join(root, "live", "declarations.json");
const lockDir = join(root, "live", ".declarations.lock");
const report = (value) => fs.writeSync(1, `${JSON.stringify(value)}\n`);
let paused = false;
const pause = () => {
  if (paused) return;
  paused = true;
  report({ paused: true, pid: process.pid });
  process.kill(process.pid, "SIGSTOP");
};

// Stop AFTER update's revision reread returned its bytes, BEFORE the
// atomic rename, or after lock publication (cut "acquire"). The old mkdir
// cut stays too, so the regression kills a return to two-step acquisition. No fake
// filesystem, clock, module instance or lock is used.
if (operation === "A" || cut === "hold" || cut === "acquire") {
  let reads = 0;
  const read = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    const result = read.call(this, file, ...args);
    if (String(file) === path && ++reads === 2 && cut === "read") pause();
    return result;
  };
  const mkdir = fs.mkdirSync;
  fs.mkdirSync = function (file, ...args) {
    const result = mkdir.call(this, file, ...args);
    if (String(file) === lockDir && cut === "acquire") pause();
    return result;
  };
  const rename = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (String(to) === path && (cut === "rename" || cut === "hold")) pause();
    const result = rename.call(this, from, to);
    if (String(to) === lockDir && cut === "acquire") pause();
    return result;
  };
  syncBuiltinESMExports();
}

const { createLiveDeclarationStore } = await import(moduleUrl);
const store = createLiveDeclarationStore(root);
try {
  if (operation === "delete") {
    report({ ok: store.remove(id), pid: process.pid });
  } else if (operation === "replace") {
    // An ABA at the same revision must still fence the old lock holder.
    const original = store.get(id);
    store.remove(id);
    store.insert(original);
    report({ ok: true, pid: process.pid });
  } else {
    store.update(id, 1, (record) => ({
      ...record,
      declaration: {
        ...record.declaration,
        declarationRevision: 2,
        serverWorkspaceId: `workspace-${operation}`,
        serverIssuer: "https://auth.sentropic.example.invalid",
        bindingRevision: 1,
      },
      updatedAt: "2026-10-12T00:00:00.000Z",
    }));
    report({ ok: true, pid: process.pid });
  }
} catch (error) {
  report({
    name: error.name,
    message: error.message,
    expected: error.expectedDeclarationRevision,
    actual: error.actualDeclarationRevision ?? null,
    pid: process.pid,
  });
}
