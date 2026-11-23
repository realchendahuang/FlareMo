import { createOpenApiDocument } from "@flaremo/contracts/openapi";
import { createCurrentOpenApiDocument } from "@flaremo/contracts/openapi-current";
import { describe, expect, it } from "vitest";
import { createFlareMoApp } from "../index";

/**
 * `/api/v1` is served by two doc families: the current wire document and the
 * legacy one behind `X-FlareMo-Wire: legacy`. A client generated from either
 * must never hit an undocumented endpoint, and a documented endpoint must
 * never be a route that no longer exists.
 *
 * This test reads Hono's own route table instead of a hand-maintained list,
 * so adding a route without documenting it (or deleting a route without
 * dropping its doc entry) fails here rather than in an SDK.
 */

/** Parameter names differ between Hono (`:memo`) and OpenAPI (`{memo}`). */
function normalizePath(path: string) {
  return path.replace(/\{[^}]+\}/g, "{}").replace(/:[A-Za-z0-9_]+/g, "{}");
}

function routedEndpoints() {
  const endpoints = new Set<string>();
  for (const route of createFlareMoApp().routes) {
    // "ALL" is Hono's catch-all marker, not a documented verb.
    if (route.method === "ALL") continue;
    endpoints.add(`${route.method} ${normalizePath(route.path)}`);
  }
  return endpoints;
}

function documentedEndpoints() {
  const endpoints = new Set<string>();
  for (const document of [
    createCurrentOpenApiDocument(),
    createOpenApiDocument(),
  ] as Array<{ paths?: Record<string, Record<string, unknown>> }>) {
    for (const [path, operations] of Object.entries(document.paths ?? {})) {
      for (const method of Object.keys(operations)) {
        endpoints.add(`${method.toUpperCase()} ${normalizePath(path)}`);
      }
    }
  }
  return endpoints;
}

describe("OpenAPI documents", () => {
  it("documents every routed /api/v1 endpoint", () => {
    const documented = documentedEndpoints();
    const undocumented = [...routedEndpoints()]
      .filter((endpoint) => endpoint.includes("/api/v1"))
      .filter((endpoint) => !documented.has(endpoint))
      .sort();

    expect(undocumented).toEqual([]);
  });

  it("routes every documented /api/v1 endpoint", () => {
    const routed = routedEndpoints();
    const stale = [...documentedEndpoints()]
      .filter((endpoint) => endpoint.includes("/api/v1"))
      .filter((endpoint) => !routed.has(endpoint))
      .sort();

    expect(stale).toEqual([]);
  });

  it("keeps operationIds unique across both documents", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const document of [
      createCurrentOpenApiDocument(),
      createOpenApiDocument(),
    ] as Array<{
      paths?: Record<string, Record<string, { operationId?: string }>>;
    }>) {
      for (const [path, operations] of Object.entries(document.paths ?? {})) {
        for (const operation of Object.values(operations)) {
          const id = operation?.operationId;
          if (!id) continue;
          const previous = seen.get(id);
          if (previous && previous !== path)
            duplicates.push(`${id}: ${previous} vs ${path}`);
          else seen.set(id, path);
        }
      }
    }
    expect(duplicates).toEqual([]);
  });
});
