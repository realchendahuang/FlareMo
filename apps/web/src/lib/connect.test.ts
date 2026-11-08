import { describe, expect, it } from "vitest";
import {
  clientTypeLabel,
  formatPairingCode,
  normalizePairingCode,
  scopeDetail,
  scopeLabel,
} from "./connect";

/** The page passes the real `t`; tests only need key identity. */
const t = (key: string) => key;

describe("normalizePairingCode", () => {
  it("uppercases and drops spaces and dashes", () => {
    expect(normalizePairingCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizePairingCode(" abcd efgh ")).toBe("ABCDEFGH");
    expect(normalizePairingCode("AB CD-EF GH")).toBe("ABCDEFGH");
  });

  it("caps the code at eight characters", () => {
    expect(normalizePairingCode("ABCDEFGHJK")).toBe("ABCDEFGH");
    expect(normalizePairingCode("")).toBe("");
  });
});

describe("formatPairingCode", () => {
  it("shows a complete code as XXXX-XXXX", () => {
    expect(formatPairingCode("abcdefgh")).toBe("ABCD-EFGH");
  });

  it("keeps partial input raw until there is something to split", () => {
    expect(formatPairingCode("")).toBe("");
    expect(formatPairingCode("ABC")).toBe("ABC");
    expect(formatPairingCode("ABCD")).toBe("ABCD");
    expect(formatPairingCode("ABCDE")).toBe("ABCD-E");
  });

  it("round-trips a formatted value", () => {
    expect(formatPairingCode(formatPairingCode("ABCDEFGH"))).toBe("ABCD-EFGH");
  });
});

describe("scope labels", () => {
  it("maps known scopes to translation keys", () => {
    expect(scopeLabel("notes", t)).toBe("connect.scope.notes");
    expect(scopeLabel("admin", t)).toBe("connect.scope.admin");
    expect(scopeDetail("notes", t)).toBe("connect.scope.notesDetail");
    expect(scopeDetail("admin", t)).toBe("connect.scope.adminDetail");
  });

  it("shows future scopes by their wire name instead of hiding them", () => {
    expect(scopeLabel("insights", t)).toBe("insights");
    expect(scopeDetail("insights", t)).toBeNull();
  });
});

describe("client type labels", () => {
  it("labels every client type the DTO can carry", () => {
    expect(clientTypeLabel("device", t)).toBe("connect.clientType.device");
    expect(clientTypeLabel("web", t)).toBe("connect.clientType.web");
    expect(clientTypeLabel("script", t)).toBe("connect.clientType.script");
    expect(clientTypeLabel("manual", t)).toBe("connect.clientType.manual");
  });
});
