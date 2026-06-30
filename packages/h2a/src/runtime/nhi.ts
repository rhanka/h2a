/**
 * DEC-087: gather the NHI posture snapshot from a local store for
 * `auditNhiPosture` (core). Shared by the CLI (`nhi report`) and the MCP tool
 * (`h2a_nhi_report`) so both classify the same registry view. Pure read.
 */
import type {
  H2ANhiInstanceSnapshot,
  H2ANhiKeyEventSnapshot,
  H2ANhiOffboardSnapshot,
  H2ANhiSubagentSnapshot
} from "@sentropic/h2a";

import type { LocalStore } from "./local-files/store.js";

export interface H2ANhiSnapshot {
  instances: H2ANhiInstanceSnapshot[];
  subagents: H2ANhiSubagentSnapshot[];
  keyEvents: H2ANhiKeyEventSnapshot[];
  offboards: H2ANhiOffboardSnapshot[];
}

export function gatherNhiSnapshot(store: LocalStore): H2ANhiSnapshot {
  const instances: H2ANhiInstanceSnapshot[] = store.listInstances().map((reg) => ({
    id: reg.id,
    ...(reg.roles && reg.roles.length > 0 ? { role: reg.roles.join(",") } : {}),
    activeKeys: store.listInstanceKeys(reg.id)
  }));
  const subagents: H2ANhiSubagentSnapshot[] = store.listSubagents().map((b) => ({
    id: b.id,
    parentInstance: b.parentInstance,
    status: store.subagentStatus(b.id),
    ...(b.capabilities ? { capabilities: b.capabilities } : {})
  }));
  const keyEvents: H2ANhiKeyEventSnapshot[] = store.listKeyEvents().map((e) => ({
    instance: e.instance,
    publicKey: e.publicKey,
    type: e.type,
    at: e.at
  }));
  const offboards: H2ANhiOffboardSnapshot[] = store.listOffboards().map((o) => ({
    instance: o.instance,
    at: o.at,
    ...(o.reason ? { reason: o.reason } : {})
  }));
  return { instances, subagents, keyEvents, offboards };
}
