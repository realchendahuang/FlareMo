import { describe, expect, it } from "vitest";
import {
  decodeBinaryRequest,
  detectBinaryTransport,
  encodeBinaryResponse,
} from "./memos-protobuf";

describe("Memos protobuf transport", () => {
  it("decodes a CreateMemo protobuf request using upstream field numbers", () => {
    const memo = Uint8Array.from([
      0x3a,
      5,
      ...new TextEncoder().encode("hello"),
      0x48,
      1,
    ]);
    const request = Uint8Array.from([0x0a, memo.length, ...memo]);

    expect(
      decodeBinaryRequest(
        "memos.api.v1.MemoService",
        "CreateMemo",
        request,
        "connect-proto",
      ),
    ).toEqual({ memo: { content: "hello", visibility: "PRIVATE" } });
  });

  it("supports Connect, gRPC, gRPC-Web, and text gRPC-Web media types", () => {
    expect(detectBinaryTransport("application/proto")).toBe("connect-proto");
    expect(detectBinaryTransport("application/grpc+proto")).toBe("grpc-proto");
    expect(detectBinaryTransport("application/grpc-web+proto")).toBe(
      "grpc-web-proto",
    );
    expect(detectBinaryTransport("application/grpc-web-text+proto")).toBe(
      "grpc-web-text-proto",
    );
  });

  it("frames a unary gRPC response and serializes current Memos fields", () => {
    const response = encodeBinaryResponse(
      "memos.api.v1.MemoService",
      "GetMemo",
      {
        name: "memos/one",
        state: "NORMAL",
        creator: "users/owner",
        content: "hello",
        visibility: "PRIVATE",
        tags: ["work"],
        pinned: true,
      },
      "grpc-web-proto",
    );
    expect(response).toBeInstanceOf(Uint8Array);
    const bytes = response as Uint8Array;
    expect(bytes[0]).toBe(0);
    expect(new DataView(bytes.buffer).getUint32(1)).toBe(bytes.length - 5);
    expect(new TextDecoder().decode(bytes)).toContain("memos/one");
  });
});
