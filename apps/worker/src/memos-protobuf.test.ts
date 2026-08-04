import { describe, expect, it } from "vitest";
import {
  decodeBinaryRequest,
  decodeBinaryResponse,
  detectBinaryTransport,
  encodeBinaryError,
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
    expect(detectBinaryTransport("application/grpc")).toBe("grpc-proto");
    expect(detectBinaryTransport("application/grpc+proto")).toBe("grpc-proto");
    expect(detectBinaryTransport("application/grpc-web")).toBe(
      "grpc-web-proto",
    );
    expect(detectBinaryTransport("application/grpc-web+proto")).toBe(
      "grpc-web-proto",
    );
    expect(detectBinaryTransport("application/grpc-web-text")).toBe(
      "grpc-web-text-proto",
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
    const dataLength = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(1);
    expect(dataLength).toBeLessThan(bytes.length - 5);
    expect(bytes[5 + dataLength]).toBe(0x80);
    expect(new TextDecoder().decode(bytes)).toContain("memos/one");
  });

  it("uses upstream service field numbers for attachment and user requests", () => {
    const content = Uint8Array.from([1, 2, 3]);
    const attachment = Uint8Array.from([
      0x1a,
      5,
      ...new TextEncoder().encode("a.txt"),
      0x22,
      content.length,
      ...content,
      0x32,
      10,
      ...new TextEncoder().encode("text/plain"),
    ]);
    const request = Uint8Array.from([0x0a, attachment.length, ...attachment]);
    expect(
      decodeBinaryRequest(
        "memos.api.v1.AttachmentService",
        "CreateAttachment",
        request,
        "connect-proto",
      ),
    ).toEqual({
      attachment: {
        filename: "a.txt",
        content: "AQID",
        type: "text/plain",
      },
    });

    const userName = new TextEncoder().encode("users/owner");
    expect(
      decodeBinaryRequest(
        "memos.api.v1.UserService",
        "GetUser",
        Uint8Array.from([0x0a, userName.length, ...userName]),
        "connect-proto",
      ),
    ).toEqual({ name: "users/owner" });
  });

  it("keeps protobuf error status code aligned with the transport status", () => {
    expect(
      Array.from(encodeBinaryError("unauthenticated", "connect-proto", 16)),
    ).toEqual([
      0x08,
      0x10,
      0x12,
      15,
      ...new TextEncoder().encode("unauthenticated"),
    ]);
  });

  it("decodes unary responses for the expanded service subset", () => {
    const attachmentResponse = encodeBinaryResponse(
      "memos.api.v1.AttachmentService",
      "ListAttachments",
      {
        attachments: [
          {
            name: "attachments/one",
            filename: "one.txt",
            type: "text/plain",
            size: "3",
            memo: "memos/one",
          },
        ],
        totalSize: 1,
      },
      "grpc-web-proto",
    );
    expect(
      decodeBinaryResponse(
        "memos.api.v1.AttachmentService",
        "ListAttachments",
        attachmentResponse as Uint8Array,
        "grpc-web-proto",
      ),
    ).toMatchObject({
      attachments: [
        {
          name: "attachments/one",
          filename: "one.txt",
          type: "text/plain",
          size: "3",
          memo: "memos/one",
        },
      ],
      totalSize: 1,
    });

    const settingsResponse = encodeBinaryResponse(
      "memos.api.v1.InstanceService",
      "BatchGetInstanceSettings",
      {
        settings: [
          {
            name: "instance/settings/GENERAL",
            generalSetting: { disallowUserRegistration: true },
          },
        ],
      },
      "grpc-web-text-proto",
    );
    expect(
      decodeBinaryResponse(
        "memos.api.v1.InstanceService",
        "BatchGetInstanceSettings",
        new TextEncoder().encode(settingsResponse as string),
        "grpc-web-text-proto",
      ),
    ).toEqual({
      settings: [
        {
          name: "instance/settings/GENERAL",
          generalSetting: { disallowUserRegistration: true },
        },
      ],
    });

    const usersResponse = encodeBinaryResponse(
      "memos.api.v1.UserService",
      "ListUsers",
      { users: [{ name: "users/owner", username: "owner" }], totalSize: 1 },
      "connect-proto",
    );
    expect(
      decodeBinaryResponse(
        "memos.api.v1.UserService",
        "ListUsers",
        usersResponse as Uint8Array,
        "connect-proto",
      ),
    ).toMatchObject({
      users: [{ name: "users/owner", username: "owner" }],
      totalSize: 1,
    });
  });

  it("adds and consumes standard gRPC-Web unary trailer frames", () => {
    const response = encodeBinaryResponse(
      "memos.api.v1.MemoService",
      "GetMemo",
      { name: "memos/one", content: "hello" },
      "grpc-web-proto",
    ) as Uint8Array;
    expect(response[0]).toBe(0);
    const trailerOffset = 5 + new DataView(response.buffer).getUint32(1);
    expect(response[trailerOffset]).toBe(0x80);
    expect(
      new TextDecoder().decode(response.subarray(trailerOffset + 5)),
    ).toContain("grpc-status: 0");
    expect(
      decodeBinaryResponse(
        "memos.api.v1.MemoService",
        "GetMemo",
        response,
        "grpc-web-proto",
      ),
    ).toMatchObject({ name: "memos/one", content: "hello" });

    const error = encodeBinaryError(
      "bad input",
      "grpc-web-proto",
      3,
    ) as Uint8Array;
    expect(error[0]).toBe(0x80);
    expect(new TextDecoder().decode(error.subarray(5))).toContain(
      "grpc-status: 3",
    );
    expect(new TextDecoder().decode(error.subarray(5))).toContain(
      "grpc-message: bad%20input",
    );
  });
});
