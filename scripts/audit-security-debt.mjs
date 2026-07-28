#!/usr/bin/env node
/**
 * Fail-closed npm audit gate with narrowly-scoped, expiring debt exceptions.
 * The register is deliberately matched by package, path, installed version,
 * and advisory/via graph so a new vulnerability never inherits an old waiver.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const THRESHOLD = "moderate";
const MAX_REVIEW_DAYS = 31;
const WARNING_REVIEW_DAYS = 7;

function asDate(value, field, errors) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${field} must be an ISO date (YYYY-MM-DD)`);
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    errors.push(`${field} is not a calendar date: ${value}`);
    return null;
  }
  return date;
}

function sameList(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function viaDetails(via) {
  const advisoryIds = [];
  const viaPackages = [];
  for (const item of Array.isArray(via) ? via : []) {
    if (typeof item === "string") {
      viaPackages.push(item);
      continue;
    }
    const url = item && typeof item.url === "string" ? item.url : "";
    const advisoryId = url.split("/").filter(Boolean).at(-1);
    if (advisoryId) advisoryIds.push(advisoryId);
  }
  return { advisoryIds, viaPackages };
}

function uniqueStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.length > 0) && new Set(value).size === value.length;
}

function matchException(exception, vulnerability, lockfile) {
  if (exception.component !== vulnerability.name || exception.severity !== vulnerability.severity) return false;
  if (!sameList(exception.paths, vulnerability.nodes ?? [])) return false;

  const installedVersions = exception.paths.map((path) => lockfile.packages?.[path]?.version);
  if (installedVersions.some((version) => typeof version !== "string")) return false;
  if (!sameList(exception.installed_versions, [...new Set(installedVersions)])) return false;

  const { advisoryIds, viaPackages } = viaDetails(vulnerability.via);
  if (exception.advisory_ids && (!sameList(exception.advisory_ids, advisoryIds) || viaPackages.length !== 0)) return false;
  if (exception.via_packages && (!sameList(exception.via_packages, viaPackages) || advisoryIds.length !== 0)) return false;
  return true;
}

export function evaluateSecurityDebt({ audit, register, lockfile, today = new Date() }) {
  const errors = [];
  const warnings = [];
  if (!audit || typeof audit !== "object" || !audit.vulnerabilities || typeof audit.vulnerabilities !== "object") {
    return { errors: ["npm audit did not return a vulnerabilities object"], warnings: [], findings: [] };
  }
  if (!register || register.version !== 1 || !Array.isArray(register.exceptions)) {
    return { errors: ["vulnerability register must be version 1 with an exceptions array"], warnings: [], findings: [] };
  }
  if (!lockfile || typeof lockfile !== "object" || !lockfile.packages || typeof lockfile.packages !== "object") {
    return { errors: ["package-lock.json must contain a packages object"], warnings: [], findings: [] };
  }

  const todayDate = asDate(today.toISOString().slice(0, 10), "today", errors);
  const ids = new Set();
  for (const exception of register.exceptions) {
    const prefix = `register row ${exception?.id ?? "<missing id>"}`;
    if (!exception || typeof exception !== "object") {
      errors.push("register contains a non-object exception");
      continue;
    }
    if (typeof exception.id !== "string" || !exception.id || ids.has(exception.id)) errors.push(`${prefix}: id must be unique`);
    ids.add(exception.id);
    if (typeof exception.component !== "string" || !exception.component) errors.push(`${prefix}: component is required`);
    if (!(exception.severity in SEVERITY_RANK)) errors.push(`${prefix}: unsupported severity`);
    if (exception.severity === "high" || exception.severity === "critical") errors.push(`${prefix}: high/critical findings cannot be registered`);
    if (!uniqueStrings(exception.paths)) errors.push(`${prefix}: paths must be a unique non-empty string list`);
    if (!uniqueStrings(exception.installed_versions)) errors.push(`${prefix}: installed_versions must be a unique non-empty string list`);
    const hasAdvisories = uniqueStrings(exception.advisory_ids);
    const hasViaPackages = uniqueStrings(exception.via_packages);
    if (hasAdvisories === hasViaPackages) errors.push(`${prefix}: provide exactly one of advisory_ids or via_packages`);
    if (exception.advisory_ids && !hasAdvisories) errors.push(`${prefix}: advisory_ids must be a unique string list`);
    if (exception.via_packages && !hasViaPackages) errors.push(`${prefix}: via_packages must be a unique string list`);
    for (const field of ["owner", "rationale", "exit"]) if (typeof exception[field] !== "string" || !exception[field]) errors.push(`${prefix}: ${field} is required`);
    const discovered = asDate(exception.discovered, `${prefix}: discovered`, errors);
    const reviewDue = asDate(exception.review_due, `${prefix}: review_due`, errors);
    if (discovered && reviewDue) {
      const reviewWindow = Math.round((reviewDue - discovered) / 86_400_000);
      if (reviewWindow < 1 || reviewWindow > MAX_REVIEW_DAYS) errors.push(`${prefix}: review_due must be 1-${MAX_REVIEW_DAYS} days after discovered`);
      const daysLeft = Math.ceil((reviewDue - todayDate) / 86_400_000);
      if (daysLeft <= 0) errors.push(`${prefix}: expired on ${exception.review_due}`);
      else if (daysLeft <= WARNING_REVIEW_DAYS) warnings.push(`${prefix}: review due in ${daysLeft} day(s), on ${exception.review_due}`);
    }
  }

  const findings = Object.values(audit.vulnerabilities);
  for (const exception of register.exceptions) {
    if (!exception || typeof exception !== "object") continue;
    const vulnerability = audit.vulnerabilities[exception.component];
    const prefix = `register row ${exception.id ?? "<missing id>"}`;
    if (!vulnerability) {
      errors.push(`${prefix}: no longer observed; remove the resolved exception`);
      continue;
    }
    if (!matchException(exception, vulnerability, lockfile)) errors.push(`${prefix}: no longer exactly matches npm audit and package-lock.json`);
  }

  for (const vulnerability of findings) {
    if (!vulnerability || typeof vulnerability !== "object" || !(vulnerability.severity in SEVERITY_RANK)) {
      errors.push("npm audit returned a malformed vulnerability");
      continue;
    }
    if (SEVERITY_RANK[vulnerability.severity] < SEVERITY_RANK[THRESHOLD]) continue;
    const matches = register.exceptions.filter((exception) => exception && matchException(exception, vulnerability, lockfile));
    if (matches.length === 0) errors.push(`${vulnerability.name}@${vulnerability.severity}: unregistered security debt`);
    if (matches.length > 1) errors.push(`${vulnerability.name}@${vulnerability.severity}: matches multiple register rows`);
  }

  return { errors, warnings, findings };
}

function readYaml(path) {
  const document = parseDocument(readFileSync(path, "utf8"));
  if (document.errors.length > 0) throw new Error(document.errors.map((error) => error.message).join("; "));
  return document.toJS({ maxAliasCount: 0 });
}

function runAudit() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["audit", "--json"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`npm audit exited ${result.status}: ${result.stderr.trim()}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`npm audit returned invalid JSON: ${error.message}`);
  }
}

function main() {
  try {
    const result = evaluateSecurityDebt({
      audit: runAudit(),
      register: readYaml(resolve(REPO_ROOT, ".security/vulnerability-register.yaml")),
      lockfile: JSON.parse(readFileSync(resolve(REPO_ROOT, "package-lock.json"), "utf8"))
    });
    for (const warning of result.warnings) process.stdout.write(`::warning::${warning}\n`);
    if (result.errors.length > 0) {
      for (const error of result.errors) process.stderr.write(`::error::${error}\n`);
      process.exitCode = 1;
      return;
    }
    const gated = result.findings.filter((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[THRESHOLD]);
    process.stdout.write(`security debt gate passed: ${gated.length} ${THRESHOLD}+ finding(s) exactly matched by the register.\n`);
  } catch (error) {
    process.stderr.write(`::error::security debt gate failed closed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
