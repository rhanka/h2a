#!/usr/bin/env node
// Runnable end-to-end demo: 1 PRINCIPAL ("human:antoine") + 15 CONDUCTORS
// (`conductor:01..15`). Exercises the full h2a stack against the real
// library API and then probes the MCP server over JSON-RPC 2.0 stdio.
//
// Topology:
//   - 1 PRINCIPAL : human:antoine
//   - 15 CONDUCTORS : conductor:01..15 (all bound to scope:principal/antoine)
//
// Flow:
//   1. Bootstrap a temp `<root>/.h2a` store.
//   2. Generate 16 ed25519 keypairs (PEM, PKCS8 private + SPKI public).
//   3. Register the 16 instances through `createLocalStore`.
//   4. Open negotiation `nego-charter` with quorum
//        requiredSigners = [conductor:01, conductor:02, conductor:03].
//   5. conductor:01 offers an ENGAGEMENT artifact; 02 & 03 counter and sign
//      the same final canonical artifact.
//   6. Stabilize the negotiation and print the resulting record + winning
//      artifactHash.
//   7. Spawn `dist/bin.js mcp-serve` and exchange JSON-RPC tools/list +
//      tools/call h2a_discover_instances({role:"CONDUCTOR"}).
//   8. Clean up.
//
// Constraints (DEC-026): only Node built-ins; imports via the workspace
// packages `@sentropic/h2a` and `@sentropic/h2a-cli`.

import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { computeHash, signCanonical } from "@sentropic/h2a";
import { createLocalStore } from "@sentropic/h2a-cli";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const CLI_BIN = join(REPO_ROOT, "packages", "h2a-cli", "dist", "bin.js");

const NEGOTIATION_ID = "nego-charter";
const SCOPE = "scope:engagement/ship-v1";
const PRINCIPAL_ID = "human:antoine";
const CONDUCTOR_COUNT = 15;
const REQUIRED_SIGNERS = ["conductor:01", "conductor:02", "conductor:03"];

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const BOLD = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

function step(label) {
  process.stdout.write(`\n${BOLD(label)}\n`);
}

function info(label, value) {
  process.stdout.write(`  ${label.padEnd(22)} ${DIM(String(value))}\n`);
}

function newKeyPair(keysDir, instance) {
  const safeName = instance.replace(/[^A-Za-z0-9._-]/g, "_");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privatePath = join(keysDir, `${safeName}.pkcs8.pem`);
  writeFileSync(privatePath, privatePem, "utf8");
  return { privatePath, privatePem, publicPem };
}

function nowIso() {
  return new Date().toISOString();
}

function buildRegistration({ id, role, principal, publicPem }) {
  return {
    id,
    instance: id,
    roles: [role],
    scopes: [SCOPE, "scope:principal/antoine"],
    principal,
    capabilities: role === "PRINCIPAL" ? ["decide"] : ["negotiate", "sign"],
    endpoints: [{ kind: "local-files", uri: `file://<root>` }],
    publicKeys: [publicPem],
    acceptedPolicies: [],
    createdAt: nowIso()
  };
}

async function sendJsonRpc(child, message) {
  return new Promise((resolveOnce, rejectOnce) => {
    let buffered = "";
    const onChunk = (chunk) => {
      buffered += chunk.toString("utf8");
      const newlineIdx = buffered.indexOf("\n");
      if (newlineIdx === -1) return;
      const line = buffered.slice(0, newlineIdx);
      child.stdout.off("data", onChunk);
      try {
        resolveOnce(JSON.parse(line));
      } catch (err) {
        rejectOnce(err);
      }
    };
    child.stdout.on("data", onChunk);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

async function main() {
  if (!existsSync(CLI_BIN)) {
    console.error(
      `\nFATAL: ${CLI_BIN} not found.\n` +
        `Build the workspace first:  npm --workspaces run build  (or npm test).\n`
    );
    process.exit(1);
  }

  const workDir = mkdtempSync(join(tmpdir(), "h2a-pc-"));
  const root = join(workDir, ".h2a");
  const keysDir = join(workDir, "keys");
  mkdirSync(keysDir, { recursive: true });

  let mcpChild = null;

  try {
    step("1. Bootstrap local-files store");
    const store = createLocalStore({ root });
    info("root", store.paths.root);

    step("2. Generate 16 ed25519 keypairs (PRINCIPAL + 15 CONDUCTORS)");
    const keys = new Map();
    keys.set(PRINCIPAL_ID, newKeyPair(keysDir, PRINCIPAL_ID));
    info(PRINCIPAL_ID, keys.get(PRINCIPAL_ID).privatePath);
    for (let i = 1; i <= CONDUCTOR_COUNT; i++) {
      const id = `conductor:${String(i).padStart(2, "0")}`;
      keys.set(id, newKeyPair(keysDir, id));
    }
    info("conductors", `${CONDUCTOR_COUNT} keys generated under ${keysDir}`);

    step("3. Register the 16 instances via createLocalStore");
    store.registerInstance(
      buildRegistration({
        id: PRINCIPAL_ID,
        role: "PRINCIPAL",
        publicPem: keys.get(PRINCIPAL_ID).publicPem
      })
    );
    for (let i = 1; i <= CONDUCTOR_COUNT; i++) {
      const id = `conductor:${String(i).padStart(2, "0")}`;
      store.registerInstance(
        buildRegistration({
          id,
          role: "CONDUCTOR",
          principal: PRINCIPAL_ID,
          publicPem: keys.get(id).publicPem
        })
      );
    }
    const registered = store.listInstances();
    info("instances total", `${registered.length} (1 PRINCIPAL + 15 CONDUCTORS)`);

    step(`4. Open negotiation ${NEGOTIATION_ID} (quorum 3 of 15)`);
    const record = {
      id: NEGOTIATION_ID,
      scope: SCOPE,
      parties: REQUIRED_SIGNERS,
      subject: "engagement",
      status: "draft",
      requiredSigners: REQUIRED_SIGNERS
    };
    store.openNegotiation(record);
    info("subject", record.subject);
    info("requiredSigners", REQUIRED_SIGNERS.join(", "));

    step("5. conductor:01 issues the initial offer (ENGAGEMENT)");
    const draftArtifact = {
      kind: "ENGAGEMENT",
      id: "engagement:ship-v1",
      scope: SCOPE,
      goal: "ship v1",
      roleBindings: [
        { role: "PRINCIPAL", instance: PRINCIPAL_ID },
        { role: "CONDUCTOR", instance: "conductor:01", binding: "lead" },
        { role: "CONDUCTOR", instance: "conductor:02", binding: "co-lead" },
        { role: "CONDUCTOR", instance: "conductor:03", binding: "review" }
      ]
    };
    const offerEntry = store.appendNegotiationEvent(NEGOTIATION_ID, {
      id: "evt-offer-01",
      type: "propose",
      actor: { instance: "conductor:01", role: "CONDUCTOR", scope: SCOPE },
      body: { artifact: draftArtifact },
      createdAt: nowIso()
    });
    info("offer sequence", offerEntry.sequence);
    info("offer contentHash", offerEntry.contentHash);

    step("6. conductors 02 & 03 counter, then all 3 sign the final artifact");
    const finalArtifact = {
      ...draftArtifact,
      goal: "ship v1 by 2026-06-30",
      successCriteria: ["green ci", "principal sign-off"]
    };

    const counter02 = store.appendNegotiationEvent(NEGOTIATION_ID, {
      id: "evt-counter-02",
      type: "counter",
      actor: { instance: "conductor:02", role: "CONDUCTOR", scope: SCOPE },
      body: { artifact: finalArtifact },
      createdAt: nowIso()
    });
    info("counter 02 sequence", counter02.sequence);

    const counter03 = store.appendNegotiationEvent(NEGOTIATION_ID, {
      id: "evt-counter-03",
      type: "counter",
      actor: { instance: "conductor:03", role: "CONDUCTOR", scope: SCOPE },
      body: { artifact: finalArtifact },
      createdAt: nowIso()
    });
    info("counter 03 sequence", counter03.sequence);

    const artifactHash = computeHash(finalArtifact);
    info("final artifactHash", artifactHash);

    for (const signer of REQUIRED_SIGNERS) {
      const privatePem = keys.get(signer).privatePem;
      const signature = signCanonical({ artifactHash }, { by: signer, privateKeyPem: privatePem });
      const signEntry = store.appendNegotiationEvent(NEGOTIATION_ID, {
        id: `evt-sign-${signer.replace(":", "-")}`,
        type: "event",
        actor: { instance: signer, role: "CONDUCTOR", scope: SCOPE },
        body: { kind: "signature", artifactHash, signature },
        createdAt: nowIso()
      });
      info(`sign ${signer}`, `seq=${signEntry.sequence} alg=${signature.alg}`);
    }

    step("7. Stabilize the negotiation (quorum check + ed25519 verify)");
    const stab = store.stabilizeNegotiation(NEGOTIATION_ID);
    info("status", stab.record.status);
    info("winning artifactHash", stab.artifactHash);
    info("signers", stab.signers.join(", "));
    info("final event id", stab.finalEvent.id);
    info("journal length", store.readNegotiationJournal(NEGOTIATION_ID).length);

    if (stab.record.status !== "stabilized") {
      throw new Error(`expected status 'stabilized', got '${stab.record.status}'`);
    }
    if (stab.artifactHash !== artifactHash) {
      throw new Error("winning artifactHash does not match the signed artifact");
    }

    step("8. Probe the MCP server (JSON-RPC 2.0 over stdio)");
    mcpChild = spawn("node", [CLI_BIN, "mcp-serve", "--root", root], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    mcpChild.stderr.on("data", (chunk) => {
      process.stderr.write(`[mcp-serve] ${chunk}`);
    });

    const init = await sendJsonRpc(mcpChild, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize"
    });
    info("server", `${init.result.serverInfo.name}@${init.result.serverInfo.version}`);
    info("protocol", init.result.protocolVersion);

    const tools = await sendJsonRpc(mcpChild, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    });
    info("tools/list", `${tools.result.tools.length} tools`);

    const discover = await sendJsonRpc(mcpChild, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "h2a_discover_instances",
        arguments: { role: "CONDUCTOR" }
      }
    });
    if (discover.result.isError) {
      throw new Error(`discover returned isError: ${discover.result.content[0].text}`);
    }
    const discoverPayload = JSON.parse(discover.result.content[0].text);
    const conductorIds = discoverPayload.instances.map((i) => i.id).sort();
    info("MCP returned", `${conductorIds.length} conductors`);
    process.stdout.write(`  ${DIM(conductorIds.join(", "))}\n`);

    if (conductorIds.length !== CONDUCTOR_COUNT) {
      throw new Error(
        `expected ${CONDUCTOR_COUNT} conductors, MCP returned ${conductorIds.length}`
      );
    }

    step("9. Full negotiation lifecycle over MCP JSON-RPC (open / offer / sign / stabilize)");
    // Open a *second* negotiation and drive its entire lifecycle through the
    // MCP server, never touching the in-process LocalStore. The store is
    // backed by the same root, so we reuse the conductors registered in
    // step 3 (their public keys are already on file).
    const MCP_NEGO_ID = "nego-mcp-lifecycle";
    const MCP_REQUIRED = ["conductor:04", "conductor:05"];

    async function callTool(name, args, id) {
      const resp = await sendJsonRpc(mcpChild, {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args }
      });
      if (resp.result.isError) {
        throw new Error(
          `${name} returned isError: ${resp.result.content[0].text}`
        );
      }
      return JSON.parse(resp.result.content[0].text);
    }

    const openResult = await callTool(
      "h2a_open_negotiation",
      {
        record: {
          id: MCP_NEGO_ID,
          scope: SCOPE,
          parties: MCP_REQUIRED,
          subject: "engagement",
          status: "draft",
          requiredSigners: MCP_REQUIRED
        }
      },
      10
    );
    info("mcp open status", openResult.record.status);

    const mcpArtifact = {
      kind: "ENGAGEMENT",
      id: "engagement:mcp-lifecycle",
      scope: SCOPE,
      goal: "demonstrate MCP-driven negotiation"
    };

    const offerResult = await callTool(
      "h2a_offer",
      {
        negotiationId: MCP_NEGO_ID,
        instance: MCP_REQUIRED[0],
        artifact: mcpArtifact,
        eventId: "evt-mcp-offer"
      },
      11
    );
    info("mcp offer sequence", offerResult.entry.sequence);

    for (let i = 0; i < MCP_REQUIRED.length; i++) {
      const signer = MCP_REQUIRED[i];
      const signResult = await callTool(
        "h2a_sign",
        {
          negotiationId: MCP_NEGO_ID,
          instance: signer,
          artifact: mcpArtifact,
          privateKeyPem: keys.get(signer).privatePem,
          eventId: `evt-mcp-sign-${signer.replace(":", "-")}`
        },
        12 + i
      );
      info(`mcp sign ${signer}`, `seq=${signResult.entry.sequence}`);
    }

    const stabResult = await callTool(
      "h2a_stabilize",
      { negotiationId: MCP_NEGO_ID, eventId: "evt-mcp-stabilize" },
      20
    );
    info("mcp stabilize status", stabResult.record.status);
    info("mcp winning hash", stabResult.artifactHash);

    if (stabResult.record.status !== "stabilized") {
      throw new Error(
        `MCP lifecycle: expected stabilized, got ${stabResult.record.status}`
      );
    }
    if (stabResult.artifactHash !== computeHash(mcpArtifact)) {
      throw new Error("MCP lifecycle: winning artifactHash does not match expected hash");
    }

    process.stdout.write(`\n${GREEN("✅ Full MCP lifecycle: stabilized via JSON-RPC")}\n`);

    process.stdout.write(
      `\n${GREEN(
        `[OK] stabilized engagement:ship-v1 / quorum ${REQUIRED_SIGNERS.length} of ${CONDUCTOR_COUNT} conductors / 15 conductors discovered via MCP`
      )}\n`
    );
  } finally {
    if (mcpChild && !mcpChild.killed) {
      mcpChild.stdin.end();
      // Give the loop a moment to flush, then ensure we don't leak the child.
      await new Promise((r) => {
        const t = setTimeout(() => {
          try {
            mcpChild.kill("SIGTERM");
          } catch {
            /* noop */
          }
          r();
        }, 500);
        mcpChild.once("exit", () => {
          clearTimeout(t);
          r();
        });
      });
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n[FAIL] ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
