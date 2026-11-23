import { describe, expect, it } from "vitest";
import type { VectorUsageReport } from "@/api";
import { isSemanticSearchAvailable } from "./use-workspace-queries";

type VectorUsage = Pick<VectorUsageReport, "provider" | "plan">;

function usage(
  semanticLimit: number | null,
  overrides: Partial<VectorUsage> = {},
  userLimit?: number | null,
): VectorUsage {
  return {
    provider: "workers-ai",
    plan: {
      limits: {
        attachmentStorageBytes: null,
        aiEmbeddingTokensPerMonth: null,
        semanticSearchQueriesPerMonth: semanticLimit,
        maxMembersPerDeployment: null,
      },
      usage: {
        attachmentStorageBytes: 0,
        aiEmbeddingTokensPerMonth: 0,
        semanticSearchQueriesPerMonth: 0,
        maxMembersPerDeployment: 1,
      },
      ...(userLimit === undefined
        ? {}
        : {
            user: {
              limits: {
                attachmentStorageBytes: null,
                aiEmbeddingTokensPerMonth: null,
                semanticSearchQueriesPerMonth: userLimit,
                maxMemosPerUser: null,
              },
              usage: {
                attachmentStorageBytes: 0,
                aiEmbeddingTokensPerMonth: 0,
                semanticSearchQueriesPerMonth: 0,
                maxMemosPerUser: 0,
              },
            },
          }),
    },
    ...overrides,
  };
}

describe("isSemanticSearchAvailable", () => {
  it("keeps semantic search visible on self-hosted unlimited quotas", () => {
    // SELF_HOST_UNLIMITED reports every limit as null; null means unlimited,
    // not "no budget" — the toggle must stay available.
    expect(isSemanticSearchAvailable(usage(null))).toBe(true);
  });

  it("hides semantic search when the plan budget is zero", () => {
    expect(isSemanticSearchAvailable(usage(0))).toBe(false);
  });

  it("keeps semantic search visible for a positive budget", () => {
    expect(isSemanticSearchAvailable(usage(100))).toBe(true);
  });

  it("hides semantic search when the provider is disabled server-side", () => {
    expect(isSemanticSearchAvailable(usage(null, { provider: "none" }))).toBe(
      false,
    );
  });

  it("hides semantic search until the usage report arrives", () => {
    expect(isSemanticSearchAvailable(undefined)).toBe(false);
    expect(isSemanticSearchAvailable(null)).toBe(false);
  });

  it("lets a per-user zero budget override an unlimited deployment", () => {
    expect(isSemanticSearchAvailable(usage(null, {}, 0))).toBe(false);
  });

  it("falls through a null per-user budget to the deployment budget", () => {
    expect(isSemanticSearchAvailable(usage(null, {}, null))).toBe(true);
  });
});
