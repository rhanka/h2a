import { existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";

// Keep the detector's vocabulary separate from the code it scans.
const providers = ["llm-gateway", "llm-mesh"].map((name) => `@sentropic/${name}`);
const historical = [
  ["llm-gateway-runtime", "/"].join(""),
  ["llm-mesh", ".ts"].join(""),
  ["llm-routing-config", ".ts"].join(""),
  ["vitest", ".llm-mesh-pin.mjs"].join(""),
];
const allowlistPath = "scripts/gateway-eradication-allowlist.json";
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".vue", ".html", ".json", ".yml", ".yaml"]);
const excludedDirectories = new Set(["node_modules", "dist", ".git", ".track", "docs"]);

export function forbiddenReferences(text) {
  const found = new Set();
  for (const provider of providers) {
    const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of text.matchAll(new RegExp(`${escaped}(?:/[a-zA-Z0-9_./-]+)?(?![a-zA-Z0-9_-])`, "g"))) {
      found.add(match[0]);
    }
  }
  const normalized = text.replace(/\\/g, "/");
  for (const path of historical) {
    const variants = path.endsWith(".ts") ? [path, path.replace(/\.ts$/, ".js")] : [path];
    if (variants.some((variant) => {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`${escaped}${variant.endsWith("/") ? "" : "(?![a-zA-Z0-9_])"}`).test(normalized);
    })) found.add(path);
  }
  return [...found].sort();
}

function constantString(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return constantString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantString(node.left);
    const right = constantString(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  if (ts.isTemplateExpression(node)) {
    let result = node.head.text;
    for (const span of node.templateSpans) {
      const value = constantString(span.expression);
      if (value === undefined) return undefined;
      result += value + span.literal.text;
    }
    return result;
  }
  return undefined;
}

export function scanSource(file, text) {
  // Text search also covers comments, shell commands, resolution strings and
  // subprocess entrypoints. Syntax inspection catches escaped/concatenated literals.
  const found = new Set(forbiddenReferences(text));
  // Retained owner adapters are explicit ratchet entries, never provider imports.
  for (const adapter of ["gateway-host/sessions.ts", "gateway-host/ledger.ts"]) {
    if (file.endsWith(`/${adapter}`)) found.add(adapter);
  }
  if (file.endsWith("dev-test-local.sh") && /\bln\s+[^\n]*-[^\s]*s\b/.test(text)) {
    found.add(["dev-test-local.sh", " symlink"].join(""));
  }
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      const value = constantString(node);
      if (value !== undefined) for (const reference of forbiddenReferences(value)) found.add(reference);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return [...found].sort().map((specifier) => ({ file, specifier }));
}

export function scanRepository(root) {
  const violations = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const file = join(dir, entry.name).split("\\").join("/");
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) walk(file);
      } else if (entry.isSymbolicLink()) {
        violations.push(...scanSource(file, readlinkSync(join(root, file))));
      } else if (entry.isFile() && extensions.has(extname(file))) {
        if (entry.name === "package.json" || entry.name.endsWith("lock.json") || file === allowlistPath) continue;
        // Historical artifacts themselves count even if their contents contain no import.
        violations.push(...scanSource(file, `${file}\n${readFileSync(join(root, file), "utf8")}`));
      }
    }
  };
  for (const dir of ["packages", "apps", "scripts"]) if (existsSync(join(root, dir))) walk(dir);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name)) {
      violations.push(...scanSource(relative(root, join(root, entry.name)), readFileSync(join(root, entry.name), "utf8")));
    }
  }
  return [...new Map(violations.map((entry) => [JSON.stringify(entry), entry])).values()]
    .sort((a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier));
}

export function compareAllowlist(violations, allowlist) {
  const key = ({ file, specifier }) => JSON.stringify([file, specifier]);
  const active = new Set(violations.map(key));
  const allowed = new Set(allowlist.map(key));
  return {
    unexpected: violations.filter((entry) => !allowed.has(key(entry))),
    stale: allowlist.filter((entry) => !active.has(key(entry))),
  };
}
