import { describe, expect, it } from "vitest";

import {
  DEFAULT_HUMAN_OUTPUT_LOCALE,
  HUMAN_OUTPUT_LOCALES,
  getHumanOutputCatalog,
  humanOutputText,
  resolveHumanOutputLocale,
} from "./human-output.js";

describe("lot L6a RED: locale catalog foundation", () => {
  it("should resolve locale by H2A_LANG, then LC_ALL/LC_MESSAGES/LANG, then the default", () => {
    expect(resolveHumanOutputLocale({})).toBe(DEFAULT_HUMAN_OUTPUT_LOCALE);
    expect(resolveHumanOutputLocale({ LANG: "fr_FR.UTF-8" })).toBe("fr");
    expect(resolveHumanOutputLocale({ LANG: "en_US.UTF-8", LC_MESSAGES: "fr_FR.UTF-8" })).toBe("fr");
    expect(resolveHumanOutputLocale({ LANG: "en_US.UTF-8", LC_ALL: "fr_FR.UTF-8" })).toBe("fr");
    expect(resolveHumanOutputLocale({ LC_ALL: "en_US.UTF-8", H2A_LANG: "fr" })).toBe("fr");
    expect(resolveHumanOutputLocale({ H2A_LANG: "fr-FR" })).toBe("fr");
    expect(resolveHumanOutputLocale({ H2A_LANG: "en-GB" })).toBe("en");
    expect(resolveHumanOutputLocale({ H2A_LANG: "" })).toBe(DEFAULT_HUMAN_OUTPUT_LOCALE);
  });

  it("should fall back to the default catalog for an unknown locale", () => {
    expect(resolveHumanOutputLocale({ H2A_LANG: "de" })).toBe(DEFAULT_HUMAN_OUTPUT_LOCALE);
    expect(resolveHumanOutputLocale({ LANG: "C" })).toBe(DEFAULT_HUMAN_OUTPUT_LOCALE);
    expect(resolveHumanOutputLocale({ LANG: "POSIX" })).toBe(DEFAULT_HUMAN_OUTPUT_LOCALE);
  });

  it("should have complete identical key sets in every shipped catalog", () => {
    expect(HUMAN_OUTPUT_LOCALES.length).toBeGreaterThanOrEqual(2);
    const reference = Object.keys(getHumanOutputCatalog("en").strings).sort();
    expect(reference.length).toBeGreaterThan(0);
    for (const locale of HUMAN_OUTPUT_LOCALES) {
      expect(Object.keys(getHumanOutputCatalog(locale).strings).sort()).toEqual(reference);
    }
  });

  it("should look up a seeded key in each locale without localising machine values", () => {
    expect(humanOutputText("restore.ledger.alreadyActive", "en")).toBe(
      getHumanOutputCatalog("en").strings["restore.ledger.alreadyActive"],
    );
    expect(humanOutputText("restore.ledger.alreadyActive", "fr")).toBe(
      getHumanOutputCatalog("fr").strings["restore.ledger.alreadyActive"],
    );
    expect(humanOutputText("restore.ledger.alreadyActive", "fr")).not.toBe(
      humanOutputText("restore.ledger.alreadyActive", "en"),
    );
  });
});
