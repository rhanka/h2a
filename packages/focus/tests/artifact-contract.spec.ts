import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import {
  FOCUS_ARTIFACT_TYPE,
  FOCUS_DEFAULT_MAX_BINDING_NAME_LENGTH,
  FOCUS_DOCUMENT_PATH,
  FOCUS_DOSSIER_CONTRACT,
  FOCUS_MANIFEST_PATH,
  FOCUS_MAX_ANCHOR_LENGTH,
  FOCUS_MAX_DOCUMENT_BYTES,
  FOCUS_TEMPLATE_ID,
  FOCUS_VIEWS_CONTRACT,
  FOCUS_VIEWS_PATH,
  bindingNameForDocumentRef,
  buildDerivedFileEntry,
  buildFocusArtifactManifest,
  buildFocusViewsDocument,
  canonicalJsonBytes,
  canonicalJsonString,
  checkFocusArtifact,
  documentDigest,
  extractDocumentAnchors,
  rendererManifestDigest,
  validateFocusArtifactManifest,
  validateFocusViewsDocument,
} from "../src/artifact/index.js";
import type {
  FocusArtifactManifest,
  FocusManifestGenerator,
  FocusManifestRenderer,
  FocusManifestValidator,
} from "../src/artifact/index.js";
import { baseDigest, canonicalJson } from "../src/editing/digest.js";
import type {
  DecisionDossierDocumentV1,
  DecisionDossierDocumentV2,
  ReportDocument,
} from "../src/model.js";

const require = createRequire(import.meta.url);

const loadJson = <T>(relPath: string): T =>
  JSON.parse(readFileSync(new URL(relPath, import.meta.url), "utf8")) as T;

const v1Fixture = (): DecisionDossierDocumentV1 =>
  loadJson<DecisionDossierDocumentV1>("../../h2a/focus-kit/dossier.template.json");

const v2Fixture = (): DecisionDossierDocumentV2 =>
  loadJson<DecisionDossierDocumentV2>("../../h2a/focus-kit/dossier.evidence.template.json");

const reportFixture = (): ReportDocument =>
  loadJson<ReportDocument>("./fixtures/benchmark-report.json");

const sampleStaticKitManifest = () => ({
  name: "@sentropic/design-system-elements",
  version: "0.3.0",
  entry: "renderer/dossier.js",
  files: [
    { path: "index.html", sha256: "a".repeat(64), bytes: 420 },
    { path: "renderer/dossier.js", sha256: "b".repeat(64), bytes: 12000 },
    { path: "renderer/dossier.css", sha256: "c".repeat(64), bytes: 2400 },
  ],
  capabilities: ["decision", "report", "diagrams", "review-root"],
});

const sampleRenderer = (version = "0.3.0"): FocusManifestRenderer => {
  const staticManifest = { ...sampleStaticKitManifest(), version };
  return {
    name: staticManifest.name,
    version: staticManifest.version,
    entry: staticManifest.entry,
    digest: rendererManifestDigest(staticManifest),
    files: staticManifest.files.map((f) => ({
      path: f.path,
      digest: `sha256:${f.sha256}`,
      bytes: f.bytes,
    })),
    capabilities: staticManifest.capabilities,
  };
};

const sampleValidator: FocusManifestValidator = {
  name: "@sentropic/focus",
  version: "0.6.1",
  digest: `sha256:${"d".repeat(64)}`,
};

const sampleGenerator: FocusManifestGenerator = {
  name: "@sentropic/h2a",
  version: "0.98.11",
};

describe("FA-H1 artifact contract: gate R2-R6, bounds, canonicalization and manifests", () => {
  it("accepts valid v1, v2 and report fixtures without a previous manifest and accepts shared targetRef", () => {
    for (const [label, doc] of [
      ["v1", v1Fixture()],
      ["v2", v2Fixture()],
      ["report", reportFixture()],
    ] as const) {
      const result = checkFocusArtifact(doc);
      expect(result.ok, `${label}: ${JSON.stringify(result)}`).toBe(true);
      if (!result.ok) continue;
      expect(result.documentDigest).toBe(baseDigest(doc));
      expect(result.bindingName).toBe(bindingNameForDocumentRef(doc.ref));
      expect(result.revisionSeq).toBe(1);
      expect(result.retiredRefs).toEqual([]);
      expect(result.bytes).toBe(canonicalJsonBytes(doc).byteLength);
      expect(result.canonicalJson.endsWith("\n")).toBe(false);
    }

    // Shared targetRef across distinct node ids is explicitly tolerated (SPEC §2.7).
    const sharedTarget = v1Fixture();
    const sections = sharedTarget.sections.map((section) =>
      section.kind === "prose" ? { ...section, targetRef: "shared:target" } : section,
    );
    const res = checkFocusArtifact({ ...sharedTarget, sections });
    expect(res.ok).toBe(true);
  });

  it("refuses R2 duplicate_id across v1 sections/options and v2 evidence families with paths", () => {
    const dupSection = v1Fixture();
    const s0 = dupSection.sections[0]!;
    const sLast = dupSection.sections.at(-1)!;
    const resSection = checkFocusArtifact({
      ...dupSection,
      sections: [...dupSection.sections.slice(0, -1), { ...sLast, id: s0.id }],
    });
    expect(resSection.ok).toBe(false);
    if (!resSection.ok) {
      expect(resSection.issues.some((i) => i.code === "duplicate_id" && i.path.startsWith("$.sections"))).toBe(true);
    }

    const dupV2 = v2Fixture();
    const resV2 = checkFocusArtifact({
      ...dupV2,
      annexes: dupV2.annexes.map((a, idx) => (idx === 0 ? { ...a, id: dupV2.sections[0]!.id } : a)),
    });
    expect(resV2.ok).toBe(false);
    if (!resV2.ok) {
      expect(resV2.issues.some((i) => i.code === "duplicate_id" && i.path === "$.annexes[0].id")).toBe(true);
    }
  });

  it("refuses R5 non-anchorable node ids and doc.ref (empty, >128 chars, whitespace, control chars) with exact paths", () => {
    const badIds = ["", "has space", "has\ttab", "has\nnewline", "ctrl\u0007bell", "a".repeat(FOCUS_MAX_ANCHOR_LENGTH + 1)];

    for (const badId of badIds) {
      const doc = v1Fixture();
      const resRef = checkFocusArtifact({ ...doc, ref: badId });
      expect(resRef.ok, `ref=${JSON.stringify(badId)}`).toBe(false);
      if (!resRef.ok) {
        expect(resRef.issues.some((i) => i.code === "focus-anchor-not-anchorable" && i.path === "$.ref")).toBe(true);
      }

      const resSection = checkFocusArtifact({
        ...doc,
        sections: doc.sections.map((s, idx) => (idx === 0 ? { ...s, id: badId } : s)),
      });
      expect(resSection.ok, `section.id=${JSON.stringify(badId)}`).toBe(false);
      if (!resSection.ok) {
        expect(resSection.issues.some((i) => i.code === "focus-anchor-not-anchorable" && i.path === "$.sections[0].id")).toBe(true);
      }
    }

    // Also check nested option id and v2 annex id.
    const docOption = v1Fixture();
    const optSetIdx = docOption.sections.findIndex((s) => s.kind === "optionSet");
    const mutatedOptionSections = docOption.sections.map((s, idx) =>
      idx === optSetIdx && s.kind === "optionSet"
        ? { ...s, options: s.options.map((o, j) => (j === 1 ? { ...o, id: "bad option" } : o)) }
        : s,
    );
    const resOpt = checkFocusArtifact({ ...docOption, sections: mutatedOptionSections });
    expect(resOpt.ok).toBe(false);
    if (!resOpt.ok) {
      expect(
        resOpt.issues.some(
          (i) => i.code === "focus-anchor-not-anchorable" && i.path === `$.sections[${optSetIdx}].options[1].id`,
        ),
      ).toBe(true);
    }

    const docV2 = v2Fixture();
    const resAnnex = checkFocusArtifact({
      ...docV2,
      annexes: docV2.annexes.map((a, idx) => (idx === 0 ? { ...a, id: "annex with space" } : a)),
    });
    expect(resAnnex.ok).toBe(false);
    if (!resAnnex.ok) {
      expect(resAnnex.issues.some((i) => i.code === "focus-anchor-not-anchorable" && i.path === "$.annexes[0].id")).toBe(true);
    }
  });

  it("refuses R6 when any node id equals doc.ref (reserved for header anchor) with exact path", () => {
    const doc = v1Fixture();
    const resSection = checkFocusArtifact({
      ...doc,
      sections: doc.sections.map((s, idx) => (idx === 0 ? { ...s, id: doc.ref } : s)),
    });
    expect(resSection.ok).toBe(false);
    if (!resSection.ok) {
      expect(
        resSection.issues.some((i) => i.code === "focus-anchor-equals-document-ref" && i.path === "$.sections[0].id"),
      ).toBe(true);
    }

    const docV2 = v2Fixture();
    const resAnnex = checkFocusArtifact({
      ...docV2,
      annexes: docV2.annexes.map((a, idx) => (idx === 0 ? { ...a, id: docV2.ref } : a)),
    });
    expect(resAnnex.ok).toBe(false);
    if (!resAnnex.ok) {
      expect(
        resAnnex.issues.some((i) => i.code === "focus-anchor-equals-document-ref" && i.path === "$.annexes[0].id"),
      ).toBe(true);
    }
  });

  it("enforces bindingName profile ceiling (focus:<ref> <= 128) and canonical document size ceiling (<= 1 048 576 bytes)", () => {
    // focus: is 6 code units -> 122 chars fits 128, 123 chars overflows 128.
    const docOkRef = { ...v1Fixture(), ref: "r".repeat(FOCUS_DEFAULT_MAX_BINDING_NAME_LENGTH - "focus:".length) };
    expect(bindingNameForDocumentRef(docOkRef.ref).length).toBe(128);
    expect(checkFocusArtifact(docOkRef).ok).toBe(true);

    const docLongRef = { ...v1Fixture(), ref: "r".repeat(FOCUS_DEFAULT_MAX_BINDING_NAME_LENGTH - "focus:".length + 1) };
    expect(bindingNameForDocumentRef(docLongRef.ref).length).toBe(129);
    const resLongRef = checkFocusArtifact(docLongRef);
    expect(resLongRef.ok).toBe(false);
    if (!resLongRef.ok) {
      expect(resLongRef.issues.some((i) => i.code === "focus-binding-name-too-long" && i.path === "$.ref")).toBe(true);
    }

    // Document canonical bytes > 1 048 576 must refuse at "$".
    const huge = v2Fixture();
    const rawPayload = Buffer.alloc(790_000, 0x61); // ~1.053M base64 bytes -> canonical JSON > 1 048 576
    const hugeSource = {
      id: "huge-blob",
      title: "Volume excessif",
      origin: { uri: "urn:fixture:huge" },
      mediaType: "text/plain",
      encoding: "base64" as const,
      data: rawPayload.toString("base64"),
      sha256: createHash("sha256").update(rawPayload).digest("hex"),
      size: rawPayload.byteLength,
    };
    const oversizedDoc: DecisionDossierDocumentV2 = {
      ...huge,
      sources: [...huge.sources, hugeSource],
    };
    expect(canonicalJsonBytes(oversizedDoc).byteLength).toBeGreaterThan(FOCUS_MAX_DOCUMENT_BYTES);
    const resSize = checkFocusArtifact(oversizedDoc);
    expect(resSize.ok).toBe(false);
    if (!resSize.ok) {
      expect(resSize.issues.some((i) => i.code === "focus-document-too-large" && i.path === "$")).toBe(true);
    }
  });

  it("enforces R3 (kind/family change) and R4 (reused retired id) only when previousManifest is supplied", () => {
    const rev1 = v2Fixture();
    const manifest1 = buildFocusArtifactManifest({
      document: rev1,
      renderer: sampleRenderer("0.3.0"),
      validator: sampleValidator,
      generator: sampleGenerator,
      createdAt: "2026-11-20T00:00:00Z",
    });
    expect(manifest1.revision).toEqual({ seq: 1, parentDigest: null, createdAt: "2026-11-20T00:00:00Z" });
    expect(manifest1.retiredRefs).toEqual([]);

    // R3: change section kind of "rationale" from prose to outcome.
    const revKindChanged: DecisionDossierDocumentV2 = {
      ...rev1,
      sections: rev1.sections.map((s) =>
        s.id === "rationale"
          ? {
              kind: "outcome" as const,
              id: "rationale",
              targetRef: "rationale",
              modality: "decision" as const,
              statement: "En bref : garder le fichier portable.",
              questionId: "format",
            }
          : s,
      ),
    };
    // Without previousManifest: local gate passes.
    expect(checkFocusArtifact(revKindChanged).ok).toBe(true);
    // With previousManifest: R3 refuses with exact path.
    const resR3Kind = checkFocusArtifact(revKindChanged, { previousManifest: manifest1 });
    expect(resR3Kind.ok).toBe(false);
    if (!resR3Kind.ok) {
      const idx = revKindChanged.sections.findIndex((s) => s.id === "rationale");
      expect(
        resR3Kind.issues.some(
          (i) => i.code === "focus-anchor-kind-changed" && i.path === `$.sections[${idx}].id`,
        ),
      ).toBe(true);
    }

    // R3 family change: move id "detail" from annex to prose section.
    const revFamilyChanged: DecisionDossierDocumentV2 = {
      ...rev1,
      sections: [
        ...rev1.sections,
        { kind: "prose", id: "detail", targetRef: "detail", markdown: "En bref : texte neutre." },
      ],
      annexes: [],
    };
    const resR3Family = checkFocusArtifact(revFamilyChanged, { previousManifest: manifest1 });
    expect(resR3Family.ok).toBe(false);
    if (!resR3Family.ok) {
      const idx = revFamilyChanged.sections.findIndex((s) => s.id === "detail");
      expect(
        resR3Family.issues.some(
          (i) => i.code === "focus-anchor-kind-changed" && i.path === `$.sections[${idx}].id`,
        ),
      ).toBe(true);
    }

    // R4: retire "detail" annex in rev 2, then try to reuse "detail" in rev 3.
    const rev2: DecisionDossierDocumentV2 = {
      ...rev1,
      annexes: [],
    };
    const checkRev2 = checkFocusArtifact(rev2, { previousManifest: manifest1 });
    expect(checkRev2.ok).toBe(true);
    if (checkRev2.ok) {
      expect(checkRev2.revisionSeq).toBe(2);
      expect(checkRev2.retiredRefs).toEqual(["detail"]);
    }
    const manifest2 = buildFocusArtifactManifest({
      document: rev2,
      renderer: sampleRenderer("0.3.0"),
      validator: sampleValidator,
      generator: sampleGenerator,
      previousManifest: manifest1,
      createdAt: "2026-11-20T01:00:00Z",
    });
    expect(manifest2.revision.seq).toBe(2);
    expect(manifest2.revision.parentDigest).toBe(manifest1.document.digest);
    expect(manifest2.retiredRefs).toEqual(["detail"]);

    // Reuse retired "detail" in rev 3 -> refused with R4!
    const resR4 = checkFocusArtifact(rev1, { previousManifest: manifest2 });
    expect(resR4.ok).toBe(false);
    if (!resR4.ok) {
      expect(resR4.issues.some((i) => i.code === "focus-anchor-reused" && i.path === "$.annexes[0].id")).toBe(true);
    }

    // Cumulative retiredRefs: retire "rationale" in rev 3 -> both "detail" and "rationale" retired.
    const rev3: DecisionDossierDocumentV2 = {
      ...rev2,
      sections: rev2.sections.filter((s) => s.id !== "rationale"),
    };
    const manifest3 = buildFocusArtifactManifest({
      document: rev3,
      renderer: sampleRenderer("0.3.0"),
      validator: sampleValidator,
      generator: sampleGenerator,
      previousManifest: manifest2,
      createdAt: "2026-11-20T02:00:00Z",
    });
    expect(manifest3.revision.seq).toBe(3);
    expect(manifest3.retiredRefs).toEqual(["detail", "rationale"]);

    // Kit upgrade on identical document preserves revision.seq, parentDigest, baseDigest and retiredRefs!
    const manifestKitUpgrade = buildFocusArtifactManifest({
      document: rev3,
      renderer: sampleRenderer("0.4.0"),
      validator: sampleValidator,
      generator: sampleGenerator,
      previousManifest: manifest3,
      createdAt: "2026-11-20T03:00:00Z",
    });
    expect(manifestKitUpgrade.revision.seq).toBe(3);
    expect(manifestKitUpgrade.revision.parentDigest).toBe(manifest3.revision.parentDigest);
    expect(manifestKitUpgrade.document.digest).toBe(manifest3.document.digest);
    expect(manifestKitUpgrade.renderer.version).toBe("0.4.0");
    expect(manifestKitUpgrade.renderer.digest).not.toBe(manifest3.renderer.digest);
    expect(manifestKitUpgrade.retiredRefs).toEqual(["detail", "rationale"]);
  });

  it("exports focus-dossier/1 and focus-views/1 contracts with documented derived field and strict validation", () => {
    const doc = v2Fixture();
    const renderer = sampleRenderer("0.3.0");
    const docDigest = documentDigest(doc);

    const viewsDoc = buildFocusViewsDocument({
      documentDigest: docDigest,
      rendererDigest: renderer.digest,
      diagrams: {
        ecosystem: {
          scene: { documentId: "document:ecosystem", schemaVersion: { major: 1, minor: 1 } },
          views: { "entity:h2a": { kind: "card", svg: "<svg/>" } },
        },
      },
    });
    expect(viewsDoc.contract).toBe(FOCUS_VIEWS_CONTRACT);
    expect(Object.keys(viewsDoc).sort()).toEqual(["contract", "diagrams", "documentDigest", "rendererDigest"]);
    expect(validateFocusViewsDocument(viewsDoc, { documentDigest: docDigest, rendererDigest: renderer.digest }).ok).toBe(true);
    expect(validateFocusViewsDocument(viewsDoc, { documentDigest: `sha256:${"0".repeat(64)}` }).ok).toBe(false);
    expect(validateFocusViewsDocument(viewsDoc, { rendererDigest: `sha256:${"0".repeat(64)}` }).ok).toBe(false);
    expect(validateFocusViewsDocument({ ...viewsDoc, createdAt: "2026-11-20T00:00:00Z" }).ok).toBe(false);

    const derivedEntry = buildDerivedFileEntry(FOCUS_VIEWS_PATH, viewsDoc, "application/json");
    expect(derivedEntry.path).toBe("views.json");
    expect(derivedEntry.mimeType).toBe("application/json");
    expect(derivedEntry.bytes).toBe(canonicalJsonBytes(viewsDoc).byteLength);
    expect(derivedEntry.digest).toBe(`sha256:${createHash("sha256").update(canonicalJsonBytes(viewsDoc)).digest("hex")}`);

    const manifest: FocusArtifactManifest = buildFocusArtifactManifest({
      document: doc,
      renderer,
      validator: sampleValidator,
      generator: sampleGenerator,
      derived: [derivedEntry],
      createdAt: "2026-11-20T00:00:00Z",
    });
    expect(manifest.artifactType).toBe(FOCUS_ARTIFACT_TYPE);
    expect(manifest.contract).toBe(FOCUS_DOSSIER_CONTRACT);
    expect(manifest.templateId).toBe(FOCUS_TEMPLATE_ID);
    expect(manifest.document.path).toBe(FOCUS_DOCUMENT_PATH);
    expect(manifest.document.digest).toBe(docDigest);
    expect(manifest.document.type).toBe("decision");
    expect(manifest.derived).toEqual([derivedEntry]);
    expect(manifest.anchors).toEqual(extractDocumentAnchors(doc));
    expect(manifest.anchors.some((a) => a.family === "section" && a.kind === "diagram")).toBe(true);
    expect(manifest.anchors.some((a) => a.family === "option" && a.kind === "option")).toBe(true);
    expect(manifest.anchors.some((a) => a.family === "source" && a.kind === "source")).toBe(true);
    expect(manifest.anchors.some((a) => a.family === "citation" && a.kind === "citation")).toBe(true);
    expect(manifest.anchors.some((a) => a.family === "evidenceGroup" && a.kind === "evidenceGroup")).toBe(true);
    expect(manifest.anchors.some((a) => a.family === "annex" && a.kind === "annex")).toBe(true);
    expect(validateFocusArtifactManifest(manifest).ok).toBe(true);

    // Manifest without derived has empty derived array.
    const noDerived = buildFocusArtifactManifest({
      document: reportFixture(),
      renderer,
      validator: sampleValidator,
      generator: sampleGenerator,
      createdAt: "2026-11-20T00:00:00Z",
    });
    expect(noDerived.document.type).toBe("report");
    expect(noDerived.derived).toEqual([]);
    expect(FOCUS_MANIFEST_PATH).toBe("focus.manifest.json");
    expect(validateFocusArtifactManifest(noDerived).ok).toBe(true);

    // Manifest refuses absolute or traversal paths.
    const badPathManifest = {
      ...manifest,
      derived: [{ ...derivedEntry, path: "/abs/views.json" }],
    };
    expect(validateFocusArtifactManifest(badPathManifest).ok).toBe(false);
  });

  it("produces identical canonical bytes and sha256: digest across Node, browser bundle, and file bytes without section enrichment", () => {
    const doc = v1Fixture();
    // Source-only diagram has no `scene` in canonical bytes.
    expect(doc.sections.find((s) => s.kind === "diagram")?.scene).toBeUndefined();

    const canonicalText = canonicalJsonString(doc);
    expect(canonicalText).toBe(canonicalJson(doc));
    expect(canonicalText.endsWith("\n")).toBe(false);
    expect(canonicalText.includes('"scene"')).toBe(false);

    const fileBytes = canonicalJsonBytes(doc);
    const nodeFileDigest = `sha256:${createHash("sha256").update(fileBytes).digest("hex")}`;
    const docDigest = documentDigest(doc);
    expect(docDigest).toBe(nodeFileDigest);
    expect(docDigest).toBe(baseDigest(doc));

    // Reordered keys yield identical bytes and digest.
    const reordered = Object.fromEntries(Object.entries(doc).reverse());
    expect(canonicalJsonString(reordered)).toBe(canonicalText);
    expect(documentDigest(reordered as unknown as DecisionDossierDocumentV1)).toBe(docDigest);

    // Browser IIFE bundle produces the exact same canonical bytes and digest.
    const { buildSync } = require("esbuild");
    const bundle = buildSync({
      entryPoints: [new URL("../src/artifact/index.ts", import.meta.url).pathname],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      globalName: "FocusArtifact",
    }).outputFiles[0].text;
    const browserDigest = runInNewContext(
      `${bundle}\nFocusArtifact.documentDigest(JSON.parse(${JSON.stringify(JSON.stringify(doc))}))`,
      { TextEncoder, structuredClone },
    );
    expect(browserDigest).toBe(docDigest);
    expect(browserDigest).toBe(nodeFileDigest);
  });

  it("handles prototype-shadowing node ids safely across check and manifest tracking", () => {
    const doc = v1Fixture();
    const shadowed: DecisionDossierDocumentV1 = {
      ...doc,
      sections: doc.sections.map((s, idx) =>
        idx === 0 ? { ...s, id: "__proto__", targetRef: "__proto__" } : s,
      ),
    };
    const checked = checkFocusArtifact(shadowed);
    expect(checked.ok).toBe(true);
    const manifest = buildFocusArtifactManifest({
      document: shadowed,
      renderer: sampleRenderer("0.3.0"),
      validator: sampleValidator,
      generator: sampleGenerator,
      createdAt: "2026-11-20T00:00:00Z",
    });
    expect(manifest.anchors.some((a) => a.id === "__proto__" && a.family === "section")).toBe(true);
    expect(checkFocusArtifact(shadowed, { previousManifest: manifest }).ok).toBe(true);
  });
});
