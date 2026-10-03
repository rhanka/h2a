import { defaultUpgradeRuntime, type UpgradeRuntime, type PrefixLockHooks, type PrefixLockHookContext, type AcquirePrefixLockOptions } from "@sentropic/h2a";

// The contextual implementer and member-derived hook cases below use
// UpgradeRuntime/defaultUpgradeRuntime, exported by 0.97.9. The later cases
// exercise hook aliases and AcquirePrefixLockOptions newly exported at the root.
const contextualRuntime: Pick<UpgradeRuntime, "acquirePrefixLock"> = {
  acquirePrefixLock(prefix, hooks) {
    hooks?.beforePublishLock?.({} as never);
    void prefix;
    return { acquired: false, reason: "busy", stillHeld: () => false, release: () => {} };
  }
};

type DerivedHooks = NonNullable<Parameters<NonNullable<UpgradeRuntime["acquirePrefixLock"]>>[1]>;
declare const derivedHooks: DerivedHooks;
derivedHooks.beforePublishLock?.({} as never);

defaultUpgradeRuntime.acquirePrefixLock?.("/tmp/prefix", derivedHooks);
void contextualRuntime;

const legacy: PrefixLockHooks = { beforePublishLock(ctx: PrefixLockHookContext) { void ctx.lockPath; } };
defaultUpgradeRuntime.acquirePrefixLock?.("/tmp/prefix", legacy);
defaultUpgradeRuntime.acquirePrefixLock?.("/tmp/prefix", { beforePublishLock(ctx) { void ctx.prefix; } });
const options: AcquirePrefixLockOptions = { readFirst: true };
defaultUpgradeRuntime.acquirePrefixLock?.("/tmp/prefix", options);
defaultUpgradeRuntime.acquirePrefixLock?.("/tmp/prefix");
