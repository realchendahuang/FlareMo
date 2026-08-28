import { describe, expect, it } from "vitest";
import { parseUserPlanLimits, SELF_HOST_UNLIMITED } from "./limits";

describe("SELF_HOST_UNLIMITED", () => {
  it("carries no limit on any dimension", () => {
    for (const value of Object.values(SELF_HOST_UNLIMITED)) {
      expect(value).toBeNull();
    }
  });

  it("exposes exactly the documented plan-limit dimensions", () => {
    expect(Object.keys(SELF_HOST_UNLIMITED).sort()).toEqual([
      "aiEmbeddingTokensPerMonth",
      "attachmentStorageBytes",
      "maxMembersPerDeployment",
      "semanticSearchQueriesPerMonth",
    ]);
  });
});

describe("parseUserPlanLimits", () => {
  it("parses a valid payload including nulls", () => {
    expect(
      parseUserPlanLimits(
        '{"attachmentStorageBytes":1073741824,"aiEmbeddingTokensPerMonth":200000,"semanticSearchQueriesPerMonth":null}',
      ),
    ).toEqual({
      attachmentStorageBytes: 1073741824,
      aiEmbeddingTokensPerMonth: 200000,
      semanticSearchQueriesPerMonth: null,
    });
  });

  it("returns null for unset, malformed, partial, or negative payloads", () => {
    expect(parseUserPlanLimits(undefined)).toBeNull();
    expect(parseUserPlanLimits("")).toBeNull();
    expect(parseUserPlanLimits("not json")).toBeNull();
    expect(parseUserPlanLimits("42")).toBeNull();
    expect(parseUserPlanLimits("{}")).toBeNull();
    expect(
      parseUserPlanLimits(
        '{"attachmentStorageBytes":1,"aiEmbeddingTokensPerMonth":2}',
      ),
    ).toBeNull();
    expect(
      parseUserPlanLimits(
        '{"attachmentStorageBytes":-5,"aiEmbeddingTokensPerMonth":2,"semanticSearchQueriesPerMonth":3}',
      ),
    ).toBeNull();
  });
});
