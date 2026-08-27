import { describe, expect, it } from "vitest";
import { SELF_HOST_UNLIMITED } from "./limits";

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
