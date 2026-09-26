import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { isUntrustedOriginError } from "./use-memo-mutations";

describe("isUntrustedOriginError", () => {
  it("recognizes the Worker's exact-Origin rejections", () => {
    expect(
      isUntrustedOriginError(
        new ApiError("This browser request must use FlareMo's origin.", 403),
      ),
    ).toBe(true);
    expect(
      isUntrustedOriginError(
        new ApiError("This bearer request uses an untrusted origin.", 403),
      ),
    ).toBe(true);
  });

  it("does not treat other permission failures as origin problems", () => {
    expect(isUntrustedOriginError(new ApiError("Permission denied", 403))).toBe(
      false,
    );
    expect(
      isUntrustedOriginError(new ApiError("Authentication required", 401)),
    ).toBe(false);
  });
});
