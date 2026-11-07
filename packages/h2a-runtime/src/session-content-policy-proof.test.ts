import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { canonicalJson, RC2_R3_PIN } from "./remote-action-contract.js";
import {
  CONTENT_POLICY_ACCEPTANCE,
  parseContentPolicyRecord,
  type ContentPolicyRecordName,
} from "./session-content-v3-api.js";
import { verifyContentPolicyProof } from "./session-content-policy-proof.js";

const root = new URL("./fixtures/session-content/v3/policy-proof/", import.meta.url);
const bytes = (p: string) => readFileSync(new URL(p, root));
const json = (p: string): any => JSON.parse(bytes(p).toString("utf8"));
const hash = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const manifest = json("remote-session-contract-manifest.v1.json");
const records = manifest.records.filter((r: any) => r.name.startsWith("ContentPolicy"));
const corpus = json("vectors/policy-coherent.json");
const blocked = { ok: false, code: "unsupported_version" };
const schemaOracle = new Ajv2020({ strict: true });
for (const r of records) schemaOracle.addSchema(json(r.schema));

describe("N4 pre-SG-R15 policy parsing and purpose separation", () => {
  it("should pin every executed r3 schema and vector to the sealed manifest", () => {
    const pin = json("pin.json");
    expect(pin.manifestSha256).toBe(RC2_R3_PIN.manifestSha256);
    expect(pin.contractManifestSha256).toBe(RC2_R3_PIN.contractManifestSha256);
    expect(CONTENT_POLICY_ACCEPTANCE).toEqual(manifest.policySupplement);
    expect(CONTENT_POLICY_ACCEPTANCE.accepted).toBe(false);
    for (const [p, sha] of Object.entries(pin.files)) expect(hash(bytes(p)), p).toBe(sha);
    const seal = new Map(bytes("MANIFEST.sha256").toString().trim().split("\n")
      .map(line => [line.slice(66), line.slice(0, 64)]));
    for (const [p, sha] of Object.entries(pin.files)) {
      if (p !== "MANIFEST.sha256") expect(seal.get(p), p).toBe(sha);
    }
    for (const r of records) {
      expect(pin.files[r.schema]).toBe(r.schemaSha256);
      expect(pin.files[r.vectors]).toBe(r.vectorSha256);
    }
    expect(records).toHaveLength(17);
  });

  for (const r of records) {
    const vectors = json(r.vectors);
    for (const c of [...vectors.positive, ...vectors.negative]) {
      it(`should parse only untrusted schema data for ${c.id}`, () => {
        const parse = () => parseContentPolicyRecord(r.name as ContentPolicyRecordName, c.value);
        if (c.expect === "REJECT_SCHEMA") {
          expect(parse).toThrowError(expect.objectContaining({ code: "invalid_request" }));
        } else {
          const parsed = parse();
          expect(parsed.status).toBe("parsed-untrusted");
          expect(parsed.value).toEqual(c.value);
          expect(parsed.value).not.toBe(c.value);
          expect(verifyContentPolicyProof(parsed)).toEqual(blocked);
        }
      });
    }
  }

  it("should reproduce coherent fixture digests and signatures without admitting authority", () => {
    const trust = new Map(json("vectors/public-fixture-trust.json").keys.map((k: any) => [k.role, k]));
    let checked = 0;
    for (const scenario of [...corpus.positive, corpus.reconnect]) {
      for (const r of scenario.records) {
        const parsed = parseContentPolicyRecord(r.schema, r.value);
        expect(parsed.status).toBe("parsed-untrusted");
        for (const witness of Object.values(r.bytes) as any[]) {
          if (!witness || typeof witness !== "object" || !Object.hasOwn(witness, "base64")) continue;
          const b = Buffer.from(witness.base64, "base64");
          expect(b.length).toBe(witness.byteLength);
          expect(hash(b)).toBe(witness.sha256);
        }
        expect(Buffer.from(r.bytes.json.base64, "base64").toString()).toBe(canonicalJson(r.value));
        if (r.bytes.signingInput) {
          const spec = records.find((s: any) => s.name === r.schema);
          const input = Buffer.from(spec.signingDomain + canonicalJson(r.value.body));
          expect(input.toString("base64")).toBe(r.bytes.signingInput.base64);
          const key: any = trust.get(spec.signerRole);
          expect(r.value.body.issuer).toBe(key.issuer);
          expect(r.value.body.kid).toBe(key.kid);
          expect(verify(null, input, createPublicKey({ key: Buffer.from(key.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }), Buffer.from(r.value.signature.value, "base64url"))).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    for (const c of corpus.positive) {
      expect(hash("h2a.session-content-policy/1/policy\0" + canonicalJson(c.proof.body.policy))).toBe(c.digests.policy);
      expect(hash("sentropic.remote-action-v1/target\0" + canonicalJson(c.proof.body.nonce.body.target))).toBe(c.digests.target);
      expect(hash(c.proof.body.idpEvidence.compactJws)).toBe(c.digests.rawJws);
      expect(verifyContentPolicyProof(c.proof)).toEqual(blocked);
    }
  });

  it("should match original r3 schemas for missing fields and wrong field types", () => {
    let mutations = 0;
    for (const r of records) {
      const valid = json(r.vectors).positive[0].value;
      const oracle = schemaOracle.getSchema("https://schemas.sentropic.invalid/rc2/v1/" + r.name + ".schema.json")!;
      for (const path of [[], ...(valid.body ? [["body"], ["signature"]] : [])]) {
        const object = path.reduce((v, k) => v[k], valid);
        for (const key of Object.keys(object)) {
          for (const replacement of [undefined, null, false, -1, 1.5, [], {}, ""]) {
            const changed = structuredClone(valid);
            const target = path.reduce((v, k) => v[k], changed);
            if (replacement === undefined) delete target[key]; else target[key] = replacement;
            const expected = oracle(changed);
            const parse = () => parseContentPolicyRecord(r.name, changed);
            if (expected) expect(parse().status).toBe("parsed-untrusted");
            else expect(parse, r.name + "/" + [...path, key].join("/")).toThrowError(expect.objectContaining({ code: "invalid_request" }));
            mutations++;
          }
        }
      }
    }
    expect(mutations).toBe(1880);
  });

  for (const id of manifest.policySupplement.routes) {
    it(`should keep every r3 ${id} carrier vector behind the unaccepted supplement gate`, () => {
      const vectors = json(`vectors/route-${id}.json`);
      let executed = 0;
      for (const c of [...vectors.positive, ...vectors.negative]) {
        // The operational gate runs before route/body handling. Expected allow
        // entries describe a future accepted supplement, never local activation.
        expect(verifyContentPolicyProof(c.input), c.id).toEqual(blocked);
        executed++;
      }
      expect(executed).toBeGreaterThan(10);
    });
  }

  it("should parse the pinned retention shapes while refusing all admission and deadline activation", () => {
    const cases = json("vectors/r2-semantics.json").cases.filter((c: any) => c.evaluator === "retentionDeadline");
    expect(cases).toHaveLength(5);
    for (const c of cases) {
      const policy = structuredClone(corpus.positive[0].proof.body.policy);
      policy.channels["session.events"].retention = c.input.kind === "none"
        ? { kind: "none" } : { kind: "finite", durationMs: c.input.durationMs };
      const parse = () => parseContentPolicyRecord("ContentPolicyV1", policy);
      if (c.id === "retention-over-cap") expect(parse).toThrowError(expect.objectContaining({ code: "invalid_request" }));
      else expect(parse().status).toBe("parsed-untrusted");
      // firstAdmissionAt and overflow are store semantics after acceptance;
      // parsing a retention shape does not compute or extend any deadline.
      expect(verifyContentPolicyProof(c.input)).toEqual(blocked);
    }
  });

  for (const c of [...corpus.positive, ...corpus.negative]) {
    it(`should refuse before policy verification for r3 ${c.id}`, () => {
      // Post-acceptance semantic expectations deliberately remain unclaimed.
      expect(verifyContentPolicyProof(c.proof)).toEqual(blocked);
    });
  }

  it("should keep the policy gate closed without reading input or caller acceptance", () => {
    const unreadable = new Proxy({}, { get() { throw new Error("authority input acquired"); }, ownKeys() { throw new Error("body acquired"); } });
    expect(verifyContentPolicyProof(unreadable)).toEqual(blocked);
    expect(verifyContentPolicyProof({ accepted: true, r15Accepted: true })).toEqual(blocked);
    expect(Object.isFrozen(CONTENT_POLICY_ACCEPTANCE)).toBe(true);
    expect(Object.isFrozen(CONTENT_POLICY_ACCEPTANCE.routes)).toBe(true);
  });

  it("should reject action bodies, nested extra fields, version drift and malformed data", () => {
    const proof = corpus.positive[0].proof;
    for (const value of [null, [], {}, { ...proof, actionId: "x" }, { body: { version: "remote-action-v1", kind: "action-envelope" } }, { ...proof, body: { ...proof.body, purpose: "input" } }, { ...proof, body: { ...proof.body, format: "h2a.session-content-policy/2" } }]) {
      expect(() => parseContentPolicyRecord("ContentPolicyProofV1", value)).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    }
    const extra = structuredClone(proof);
    extra.body.nonce.body.target.extra = "forbidden";
    expect(() => parseContentPolicyRecord("ContentPolicyProofV1", extra)).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(() => parseContentPolicyRecord("unknown" as ContentPolicyRecordName, proof)).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    const cycle: any = {}; cycle.body = cycle;
    expect(() => parseContentPolicyRecord("ContentPolicyProofV1", cycle)).toThrowError(expect.objectContaining({ code: "invalid_request" }));
    expect(() => parseContentPolicyRecord("ContentPolicyProofV1", { ...proof, padding: "x".repeat(65536) })).toThrowError(expect.objectContaining({ code: "oversize" }));
  });

  it("should preserve exact full Target and stable sourceBinding schema bounds", () => {
    const p = corpus.positive[0].proof;
    for (const key of Object.keys(p.body.nonce.body.target)) {
      const missing = structuredClone(p); delete missing.body.nonce.body.target[key];
      expect(() => parseContentPolicyRecord("ContentPolicyProofV1", missing)).toThrowError();
    }
    for (const key of ["connectionId", "connectionGeneration"]) {
      const changed = structuredClone(p); changed.body.policy.sourceBinding[key] = p.body.nonce.body.target[key];
      expect(() => parseContentPolicyRecord("ContentPolicyProofV1", changed)).toThrowError();
    }
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) {
      const changed = structuredClone(p); changed.body.nonce.body.target.sourceGeneration = value;
      expect(() => parseContentPolicyRecord("ContentPolicyProofV1", changed)).toThrowError();
    }
  });
});
