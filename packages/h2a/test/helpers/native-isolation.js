/**
 * Lot L0 (D16) — ordinary Node `--import` preload and isolation helper wrapper.
 *
 * Statically imports ONLY Node stdlib and the pure zero-dep D16 contract
 * (`scripts/test-sandbox-contract.mjs`). Verifies the live OS confinement
 * barrier and read-only receipt BEFORE dynamically loading the core module
 * (`native-isolation-core.js`) or evaluating any test/product code.
 *
 * An unconfined direct invocation refuses here immediately, even on a cold
 * checkout with no installed dependencies.
 */
import {
  ensureWorkerEnvironment,
  verifySandboxConfinement,
} from "../../../../scripts/test-sandbox-contract.mjs";

const receipt = verifySandboxConfinement(process.env);
ensureWorkerEnvironment(receipt, process.env);

const { createNativeIsolationApi } = await import("./native-isolation-core.js");
const api = createNativeIsolationApi({
  root: receipt.root,
  preloadUrl: import.meta.url,
  receipt,
});
api.activateForCurrentProcess();

export { verifySandboxConfinement as assertConfinedTestEnvironment };
export const nativeQualificationRoot = api.nativeQualificationRoot;
export const assertPrivateQualificationPath = api.assertPrivateQualificationPath;
export const createPrivateTestDirectory = api.createPrivateTestDirectory;
export const assertIsolatedEnvironment = api.assertIsolatedEnvironment;
export const isolatedNativeTestEnvironment = api.isolatedNativeTestEnvironment;
export const assertIsolatedNativeOperation = api.assertIsolatedNativeOperation;
export const nativeTestEnvironment = api.nativeTestEnvironment;
export const installNativeTestEnvironment = api.installNativeTestEnvironment;
export const setupNativeTestEnvironment = api.setupNativeTestEnvironment;
export const pinPrivateNativeProcess = api.pinPrivateNativeProcess;
export const installNativeTestSpawnGuard = api.installNativeTestSpawnGuard;
export const assertNativeTestSpawnRefused = api.assertNativeTestSpawnRefused;
export const assertNoNativeTestSpawnViolations = api.assertNoNativeTestSpawnViolations;
export const stopPrivateNativeProcesses = api.stopPrivateNativeProcesses;
export const waitForPrivateNativeProcesses = api.waitForPrivateNativeProcesses;
export const spawnIsolatedNative = api.spawnIsolatedNative;
export const spawnSyncIsolatedNative = api.spawnSyncIsolatedNative;
