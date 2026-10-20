/**
 * Lot L6 RED — golden human restore output per shipped locale (D14).
 *
 * One fixed plan fixture rendered in English, French, and an unknown
 * locale (fallback to the default catalog): no line may mix languages in a
 * single run, and the unknown locale renders exactly the default language.
 */
import { describe, expect, it } from "vitest";

import {
  renderRestorePlan,
  type RestorePlanView,
} from "./restore.js";

function fixture(): RestorePlanView {
  return {
    windows: [
      {
        title: "dev",
        tabs: [
          { label: "a", tool: "claude", cwd: "/r/a", origin: "registry" },
          { label: "b", tool: "codex", cwd: "/r/b", origin: "scan" },
        ],
      },
    ],
    total: 2,
    dropped: 0,
    excludedSecondary: ["s1"],
    excludedUnclassified: ["u1"],
    facetUpdates: [],
    dryRun: true,
    observed: { planned: 2, opened: 0, skippedLive: 0, blocked: 1 },
    facetUpdates: [["x", "primary"]],
  };
}

describe("lot L6 RED: golden human restore output (D14)", () => {
  it("should emit no mixed-language lines in one run", () => {
    const en = renderRestorePlan(fixture(), "en");
    const fr = renderRestorePlan(fixture(), "fr");
    expect(en.length).toBeGreaterThan(0);
    expect(fr.length).toBeGreaterThan(0);
    expect(en).toEqual([
      "  dev (2):",
      "    - a  claude (local) [registry]  /r/a",
      "    - b  codex (local) [guess]  /r/b",
      "  (! 1 secondary session(s) excluded by delegation provenance — restore with --include-secondary: s1)",
      "  (! 1 unclassified session(s) listed separately, never auto-restored: u1)",
      "  (! dry-run: 1 row(s) that would be classified once and persisted: x=primary)",
      "restore: 0 opened, 1 blocked, 0 skipped (2 planned) (dry-run)",
    ]);
    expect(fr).toEqual([
      "  dev (2):",
      "    - a  claude (local) [registry]  /r/a",
      "    - b  codex (local) [guess]  /r/b",
      "  (! 1 session(s) secondaire(s) exclue(s) — délégation — restaurer avec --include-secondary : s1)",
      "  (! 1 session(s) non classée(s) listée(s) séparément, jamais restaurée(s) automatiquement : u1)",
      "  (! dry-run : 1 ligne(s) qui seraient classées une fois puis persistées : x=primary)",
      "restauration : 0 ouverte(s), 1 bloquée(s), 0 ignorée(s) (2 prévue(s)) (dry-run)",
    ]);
  });

  it("should render the default catalog for an unknown locale", () => {
    const en = renderRestorePlan(fixture(), "en");
    const xx = renderRestorePlan(fixture(), "xx");
    expect(xx).toEqual(en);
  });
});
