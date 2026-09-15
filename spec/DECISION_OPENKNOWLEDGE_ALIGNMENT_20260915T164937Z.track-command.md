# Track registration payload — for h-cond (live single-writer) ONLY

**Do NOT run this from the isolated clone.** `.track/events.jsonl` is append-only and single-writer.
ASTRA (this study) did **not** write to any `.track`. This registration must be applied by **h-cond**,
from the **live** `~/src/h2a` repository root, against the live `.track`.

- **Decision:** Alignement mémoire h2a sur Open Knowledge Format (OKF v0.2)
- **decisionKind:** `orientation`
- **workspace:** `ws:89c45cc3e040949f1a1a034529722ee877150fd2a0e3da16a7f6e9d8e27f495d`
  (dominant h2a workspace, resolved from the live `.track` at study time — h-cond re-confirms)
- **Recommendation:** `B` (port d'export injecté, séquencé comme `D`)
- **Structured payload (single source of truth):**
  `spec/DECISION_OPENKNOWLEDGE_ALIGNMENT_20260915T164937Z.track-payload.json`
- **Dossier artifact:** `spec/DECISION_OPENKNOWLEDGE_ALIGNMENT_20260915T164937Z.md`

## Exact command sequence

```bash
# from the LIVE h2a repo root (~/src/h2a), NOT the isolated clone
cd ~/src/h2a

# 1) mint the decision (orientation) in the h2a workspace
track decision new \
  --kind orientation \
  --title "Alignement mémoire h2a sur Open Knowledge Format (OKF v0.2)" \
  --workspace ws:89c45cc3e040949f1a1a034529722ee877150fd2a0e3da16a7f6e9d8e27f495d \
  --context "$(python3 -c 'import json;print(json.load(open("spec/DECISION_OPENKNOWLEDGE_ALIGNMENT_20260915T164937Z.track-payload.json"))["dossier"]["context"])')"
# -> note the returned <decisionId>

# 2) attach the structured dossier (options + recommendation + rationale)
#    Preferred flags (sentropic-canonical track surface):
track decision dossier <decisionId> \
  --options-json "$(python3 -c 'import json;print(json.dumps(json.load(open("spec/DECISION_OPENKNOWLEDGE_ALIGNMENT_20260915T164937Z.track-payload.json"))["dossier"]["options"]))')" \
  --recommendation B \
  --rationale "$(python3 -c 'import json;print(json.load(open("spec/DECISION_OPENKNOWLEDGE_ALIGNMENT_20260915T164937Z.track-payload.json"))["dossier"]["recommendation"]["rationale"])')"

# 3) point the decision at the committed dossier file (record-only artifact evidence)
track decision add-artifact <decisionId> \
  --kind rendered-view \
  --view-ref spec/DECISION_OPENKNOWLEDGE_ALIGNMENT_20260915T164937Z.md

# 4) verify
track snapshot --format text
track validate
```

## Live-only unknown to resolve (flagged)

- **`source-gap` — exact "options" flag on the h2a-vendored `track`.** `packages/track/README.md` documents
  `track decision dossier <decisionId> --context <c>` but truncates the options surface. The
  sentropic-canonical surface (track-operation skill) is `--options-json` / `--recommendation` /
  `--rationale`, used above. **h-cond must confirm these flags against the live binary**; if the vendored
  CLI differs, feed the same `.track-payload.json` `dossier.options` / `recommendation` via the supported
  input. The **payload JSON is the authoritative content** regardless of flag spelling.

## Guardrails

- Single-writer: only h-cond appends to the live `.track`. No concurrent write was performed by ASTRA.
- `decisionKind` must be `orientation` (matches existing h2a decision events).
- Do **not** hand-edit `.track/events.jsonl`; use the CLI.
- The owner has **not** selected an option. Do **not** run `track decision select` until the owner rules.
  This registration records the dossier + recommendation only; it does not force a decision.
