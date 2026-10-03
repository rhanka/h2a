import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

test("T-public-api: 0.97.x contextually typed and derived hook consumers still type-check", async () => {
  const fixture = fileURLToPath(new URL("./upgrade-runtime-hooks-compat.ts", import.meta.url));
  const program = ts.createProgram([fixture], {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    []
  );
  const runtime = await import("../dist/index.js");
  assert.equal(Object.hasOwn(runtime, "PrefixLockHooks"), false, "compatibility aliases are type-only");
  assert.equal(Object.hasOwn(runtime, "PrefixLockHookContext"), false, "compatibility aliases are type-only");
  assert.equal(
    Object.hasOwn(await import("../dist/index.js"), "__test"),
    false,
    "the root package never exposes the test seam"
  );
});

test("T-public-api: only the legacy hook type aliases are deprecated", () => {
  const declarations = readFileSync(
    fileURLToPath(new URL("../dist/runtime/upgrade/index.d.ts", import.meta.url)),
    "utf8"
  );
  const acquirePrefixLock = declarations.indexOf("acquirePrefixLock?(prefix");
  assert.notEqual(acquirePrefixLock, -1, "UpgradeRuntime must expose acquirePrefixLock");
  const documentationStart = declarations.lastIndexOf("/**", acquirePrefixLock);
  assert.equal(
    declarations.slice(documentationStart, acquirePrefixLock).includes("@deprecated"),
    false,
    "supported acquirePrefixLock calls must not be deprecated"
  );
});

test("T-public-api: compatibility declarations are deprecated type aliases only", () => {
  const text = readFileSync(new URL("../dist/runtime/local-files/succession-lock.d.ts", import.meta.url), "utf8");
  for (const name of ["PrefixLockHooks", "PrefixLockHookContext"]) {
    const marker = text.indexOf(`export type ${name} =`);
    assert.notEqual(marker, -1, name);
    assert.match(text.slice(text.lastIndexOf("/**", marker), marker), /@deprecated/);
  }
  const options = text.slice(text.indexOf("export interface AcquirePrefixLockOptions"), text.indexOf("interface LockIdent"));
  assert.match(options, /readFirst/);
  assert.doesNotMatch(options, /hooks|self|beforePublish|afterReadFirst/);
});
