import { expect, it } from "vitest";
import { NativeTerminalPublicationRefusal } from "./publication-refusal.js";

it.each([
  ["H2A_MACHINE_ID_UNREADABLE", "native host machine-id is unreadable or invalid; recovery remains blocked until a valid machine identity is restored; see docs/runbooks/2026-10-11-recuperation-parc-0.98.2-0.98.4.md#machine-id"],
  ["H2A_PROC_FRAME_UNKNOWN", "native host process frame is unknown; refusing socket publication"],
  ["H2A_ENDPOINT_PROBE_TIMEOUT", "native host endpoint probe timed out; refusing socket publication"],
  ["H2A_PUBLICATION_LOCK_TIMEOUT", "terminal socket publication lock timed out"],
  ["H2A_SOCKET_PUBLICATION_TIMEOUT", "terminal host socket publication timed out"],
  ["H2A_ENDPOINT_OWNER_UNPROVEN", "terminal host owner death is unproven; refusing socket publication"],
  ["H2A_STALE_SOCKET_UNPROVEN", "terminal host owner death is unproven; refusing stale socket reclamation"],
] as const)("should freeze the literal, diagnostic and exit code for %s", (code, literal) => {
  const refusal = new NativeTerminalPublicationRefusal(code);
  expect(refusal.message).toBe(literal);
  expect(refusal.code).toBe(code);
  expect(refusal.exitCode).toBe(3);
});
