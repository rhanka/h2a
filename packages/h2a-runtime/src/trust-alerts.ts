/**
 * Pure read-only trust-onboarding alert reader (strictly Node built-ins).
 * Lazily imported by `@sentropic/h2a` for `h2a status` without loading heavy deps.
 */

import {
  collectTrustAlertsReadOnly,
  type TrustOwnerAlert,
} from "./onboarding-core.js";

export type { TrustOwnerAlert };

export function readTrustOwnerAlerts(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly TrustOwnerAlert[] {
  return collectTrustAlertsReadOnly(env).alerts;
}

export function formatTrustOwnerAlertLine(alert: TrustOwnerAlert): string {
  const tag = alert.severity === "error" ? "TRUST ERROR" : "TRUST ALERT";
  return `[${tag} ${alert.id}] ${alert.message}`;
}

export function formatTrustOwnerAlertLines(
  alerts: readonly TrustOwnerAlert[],
): readonly string[] {
  return alerts.map(formatTrustOwnerAlertLine);
}
