/**
 * Velocity contract consumer (L0-C).
 *
 * Imports the closed time-reference contract exclusively from the published
 * package `@sentropic/engram@0.21.0` — never from a local engram checkout,
 * never from a hand-recreated local schema. All quantile, digest, milestone
 * and validation semantics are the published ones.
 */
import * as timeReference from "@sentropic/engram/time-reference";
export const ENGRAM_VERSION = "0.21.0";
export const ENGRAM_INTEGRITY = "sha512-CrHVxemSzxfrnotl1ZNrSzIePIbTapII6HIJj5GRqwViHyhbWItTduw/ybQvM8AQsV99xmqHHoEwhLESFitzAw==";
export const ENGRAM_GIT_HEAD = "fa3e8645366a71703a04b9eab7ca757e805edf1a";
export const ENGRAM_EXPORT = "@sentropic/engram/time-reference";
export function getContract() {
    return timeReference;
}
//# sourceMappingURL=contract.js.map