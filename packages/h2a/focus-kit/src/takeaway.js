/**
 * The readability gate asks authors to open every multi-sentence block with "En bref : " or
 * "In short: " (`missing_en_bref_takeaway`). That marker is an authoring discipline: repeated on
 * every block it only adds noise for the reader, so the renderer drops it from the DISPLAYED text
 * and capitalises the sentence that follows. The embedded document is left untouched, because it
 * is validated again when the page opens.
 *
 * Handled positions: start of the text, start of a line, and right after the "label — " lead that
 * the presentation layer puts in front of a recommended answer.
 */
const TAKEAWAY_MARKER = /(^\s*|[\n\r][ \t]*|— )(?:En bref\s*:\s+|In short:\s+)(\p{Ll})?/gu;

export const withoutTakeawayMarker = (text) =>
  typeof text === 'string'
    ? text.replace(TAKEAWAY_MARKER, (_, lead, first = '') => lead + first.toLocaleUpperCase('fr'))
    : text;
