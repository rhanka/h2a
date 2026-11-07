import { Hono, type MiddlewareHandler } from "hono";
import { mount } from "hono/mount";
import { SignJWT } from "jose";

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { createControlPlane } from "./index.js";

/**
 * GHSA-h7mg-cq63-vhpq — hono ≤ 4.13.15: RegExpRouter derived wildcard coverage
 * from `.*`, and a request path carrying an encoded line terminator (%0A,
 * %0D, %E2%80%A8, %E2%80%A9) that matched no route fell to the not-found
 * handler without any wildcard middleware — the auth check registered on a
 * wildcard never ran. The control-plane gates /sessions, /workspaces and
 * /lineage-leases behind wildcard requireAuth middleware.
 *
 * On 4.13.13 the app's `/sessions/:id/*` middleware made RegExpRouter throw
 * UnsupportedPathError, so SmartRouter bound TrieRouter (which applies the
 * middleware in every case) — this surface was therefore not exploitable via
 * that path, and the corpus below stays green there. Probed post-bump
 * (4.13.17): RegExpRouter still refuses that middleware shape, so the app
 * stays TrieRouter-bound through the bump; the corpus pins the refusal
 * invariant across any future router flip to a `.*`-derived wildcard.
 *
 * GHSA-4m76-xfj5-7975 — mount()/app.mount() removed the mount prefix from
 * the DECODED request path, so `/app/public%5C..%5Cadmin/secret` was
 * forwarded as `/admin/secret` and a mounted sub-app served a route the
 * outer app guards with path-scoped middleware (200 "mounted secret",
 * observed RED on 4.13.13). The control-plane composes its sub-apps with
 * `app.route()`, which is not affected, but the same composition shape
 * (outer path-scoped auth + a mounted sub-app) is pinned here so the mount
 * path can never weaken the guard if a mount is ever introduced.
 */

const AUTH_SECRET = "router-wildcard-ghsa-secret";

const LINE_TERMINATOR_TARGETS = [
  "/workspaces/ws%0A1/never-resources",
  "/workspaces/ws%0D1/never-resources",
  "/workspaces/ws%E2%80%A81/never-resources",
  "/sessions/s%0A1/never-segment",
  "/sessions/s%E2%80%A91/never-segment",
  "/lineage-leases/ll%0A1/never-item",
  "/lineage-leases/ll%0D1/never-item",
];

let savedAuth: string | undefined;
let savedSecret: string | undefined;

beforeEach(() => {
  savedAuth = process.env.REMOTE_AUTH;
  savedSecret = process.env.REMOTE_AUTH_SECRET;
  process.env.REMOTE_AUTH = "bearer";
  process.env.REMOTE_AUTH_SECRET = AUTH_SECRET;
});

afterEach(() => {
  if (savedAuth === undefined) delete process.env.REMOTE_AUTH;
  else process.env.REMOTE_AUTH = savedAuth;
  if (savedSecret === undefined) delete process.env.REMOTE_AUTH_SECRET;
  else process.env.REMOTE_AUTH_SECRET = savedSecret;
});

async function userToken(sub: string): Promise<string> {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(new TextEncoder().encode(AUTH_SECRET));
}

describe("control-plane wildcard middleware — encoded line terminators (GHSA-h7mg-cq63-vhpq)", () => {
  it("refuses the protected namespaces without credentials (baseline)", async () => {
    const app = createControlPlane();
    for (const target of ["/sessions", "/workspaces", "/lineage-leases"]) {
      const response = await app.request(target);
      expect(response.status, target).toBe(401);
      const body = (await response.json()) as { code?: string };
      expect(body.code, target).toBe("auth.unauthorized");
    }
  });

  it("serves the protected namespaces with a valid user token (control path)", async () => {
    const app = createControlPlane();
    const token = await userToken("alice");
    const response = await app.request("/sessions", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
  });

  it("still refuses every line-terminator corpus path without credentials", async () => {
    const app = createControlPlane();
    for (const target of LINE_TERMINATOR_TARGETS) {
      const response = await app.request(target);
      // TrieRouter (4.13.13) and the fixed RegExpRouter (4.13.16+) both
      // apply the wildcard requireAuth to these paths. The pin guards the
      // router switch the bump performs on this app: a re-introduced
      // `.*`-derived wildcard would answer a bare 404 instead of 401.
      expect(response.status, target).toBe(401);
      const body = await response.text();
      expect(body, target).not.toContain("workspace");
      expect(body, target).not.toContain("sessionId");
    }
  });

  it("routes the corpus through requireAuth, not around it (credentials presented → still routed, then not found)", async () => {
    const app = createControlPlane();
    const token = await userToken("alice");
    for (const target of LINE_TERMINATOR_TARGETS) {
      const response = await app.request(target, {
        headers: { authorization: `Bearer ${token}` },
      });
      // Authenticated: the middleware passes, and the (nonexistent) deep
      // path then resolves to the ordinary 404. This discriminates "refused
      // by auth" from "blanket 404".
      expect(response.status, target).toBe(404);
    }
  });
});

/** Outer path-scoped auth + a mounted sub-app — the GHSA-4m76 composition shape. */
function buildMountedSubApp(): Hono {
  const requireToken: MiddlewareHandler = async (c, next) => {
    if (c.req.header("authorization") !== "Bearer h2a-mount-guard") {
      return c.text("unauthorized", 401);
    }
    await next();
  };
  const sub = new Hono();
  sub.get("/stuff", (c) => c.text("mounted stuff"));
  sub.get("/admin/secret", (c) => c.text("mounted secret"));
  const outer = new Hono();
  outer.use("/app/admin/*", requireToken);
  outer.all("/app/*", mount(sub.fetch));
  outer.use("/api/:tenant/admin/*", requireToken);
  outer.all("/api/:tenant/*", mount(sub.fetch));
  return outer;
}

describe("mounted sub-app behind outer path-scoped middleware (GHSA-4m76-xfj5-7975)", () => {
  it("serves unprivileged mounted routes and guards the protected one", async () => {
    const outer = buildMountedSubApp();
    const stuff = await outer.request("/app/stuff");
    expect(stuff.status).toBe(200);
    const refused = await outer.request("/app/admin/secret");
    expect(refused.status).toBe(401);
    const allowed = await outer.request("/app/admin/secret", {
      headers: { authorization: "Bearer h2a-mount-guard" },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("mounted secret");
  });

  it("does not re-normalize a crafted path into a protected mounted route", async () => {
    const outer = buildMountedSubApp();
    const response = await outer.request("/app/public%5C..%5Cadmin/secret");
    // On 4.13.13 the mount prefix was stripped from the DECODED path, so the
    // sub-app received /admin/secret and served the protected route (200
    // "mounted secret", RED). 4.13.16+ strips the raw pathname segment by
    // segment; the sub-app sees public%5C..%5Cadmin/secret → not found.
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("secret");
  });

  it("does not cut a dynamic mount prefix into a protected mounted route", async () => {
    const outer = buildMountedSubApp();
    const response = await outer.request("/api/a/xxxxx/admin/secret");
    // On 4.13.13 the prefix was stripped by the LENGTH of the route pattern
    // (the 12 characters of "/api/:tenant"), not by the matched segments,
    // so /api/a/xxxxx/admin/secret was forwarded as /admin/secret and the
    // protected route was served (200 "mounted secret", RED). The padding
    // length is load-bearing: only 4 or 5 characters still leak on that
    // version (10 or more stay behind the cut and see a 404 there).
    // 4.13.16+ removes the matched prefix segments; the sub-app sees
    // /xxxxx/admin/secret → not found.
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("secret");
  });
});
