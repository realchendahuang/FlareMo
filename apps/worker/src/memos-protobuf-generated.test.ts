import {
  type DescMessage,
  fromJson,
  type JsonValue,
  toBinary,
} from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { SignInRequestSchema } from "./memos-generated/api/v1/auth_service_pb";
import {
  CreateMemoRequestSchema,
  ListMemosRequestSchema,
} from "./memos-generated/api/v1/memo_service_pb";
import {
  decodeBinaryRequest,
  decodeBinaryResponse,
  encodeBinaryResponse,
} from "./memos-protobuf";

const MEMO_SERVICE = "memos.api.v1.MemoService";
const AUTH_SERVICE = "memos.api.v1.AuthService";
const ATTACHMENT_SERVICE = "memos.api.v1.AttachmentService";
const INSTANCE_SERVICE = "memos.api.v1.InstanceService";
const USER_SERVICE = "memos.api.v1.UserService";

function binaryFixture(schema: DescMessage, value: Record<string, unknown>) {
  return toBinary(schema, fromJson(schema, value as JsonValue));
}

describe("Memos generated protobuf runtime regressions", () => {
  it("decodes a CreateMemo binary request with nested memo fields", () => {
    const request = binaryFixture(CreateMemoRequestSchema, {
      memo: {
        name: "memos/fixture",
        state: "NORMAL",
        content: "# fixture memo",
        visibility: "PRIVATE",
        tags: ["fixture", "generated"],
        pinned: true,
        property: {
          hasLink: true,
          hasTaskList: true,
          hasIncompleteTasks: true,
          title: "Fixture memo",
        },
        location: {
          placeholder: "fixture location",
          latitude: 31.2304,
          longitude: 121.4737,
        },
        attachments: [
          {
            name: "attachments/fixture",
            filename: "fixture.jpg",
            externalLink: "https://example.invalid/fixture.jpg",
            type: "image/jpeg",
            memo: "memos/fixture",
            motionMedia: {
              family: "APPLE_LIVE_PHOTO",
              role: "STILL",
              groupId: "fixture-group",
              presentationTimestampUs: "123456",
              hasEmbeddedVideo: true,
            },
          },
        ],
        relations: [
          {
            memo: {
              name: "memos/fixture",
              snippet: "fixture memo",
            },
            relatedMemo: {
              name: "memos/related",
              snippet: "related memo",
            },
            type: "REFERENCE",
          },
        ],
      },
      memoId: "fixture-id",
    });

    expect(
      decodeBinaryRequest(MEMO_SERVICE, "CreateMemo", request, "connect-proto"),
    ).toMatchObject({
      memo: {
        name: "memos/fixture",
        state: "NORMAL",
        content: "# fixture memo",
        visibility: "PRIVATE",
        tags: ["fixture", "generated"],
        pinned: true,
        property: {
          hasLink: true,
          hasTaskList: true,
          hasIncompleteTasks: true,
          title: "Fixture memo",
        },
        location: {
          placeholder: "fixture location",
          latitude: 31.2304,
          longitude: 121.4737,
        },
        attachments: [
          {
            name: "attachments/fixture",
            filename: "fixture.jpg",
            externalLink: "https://example.invalid/fixture.jpg",
            type: "image/jpeg",
            memo: "memos/fixture",
            motionMedia: {
              family: "APPLE_LIVE_PHOTO",
              role: "STILL",
              groupId: "fixture-group",
              presentationTimestampUs: "123456",
              hasEmbeddedVideo: true,
            },
          },
        ],
        relations: [
          {
            memo: { name: "memos/fixture", snippet: "fixture memo" },
            relatedMemo: { name: "memos/related", snippet: "related memo" },
            type: "REFERENCE",
          },
        ],
      },
      memoId: "fixture-id",
    });
  });

  it("preserves ListMemos pagination fields in binary requests and responses", () => {
    const request = binaryFixture(ListMemosRequestSchema, {
      pageSize: 25,
      pageToken: "fixture-page-token",
      state: "ARCHIVED",
      orderBy: "update_time asc",
      filter: "content.contains('fixture')",
      showDeleted: true,
    });

    expect(
      decodeBinaryRequest(MEMO_SERVICE, "ListMemos", request, "connect-proto"),
    ).toEqual({
      pageSize: 25,
      pageToken: "fixture-page-token",
      state: "ARCHIVED",
      orderBy: "update_time asc",
      filter: "content.contains('fixture')",
      showDeleted: true,
    });

    const response = encodeBinaryResponse(
      MEMO_SERVICE,
      "ListMemos",
      {
        memos: [
          {
            name: "memos/fixture",
            state: "NORMAL",
            content: "fixture page",
            visibility: "PRIVATE",
          },
        ],
        nextPageToken: "fixture-next-page",
      },
      "connect-proto",
    );

    expect(
      decodeBinaryResponse(
        MEMO_SERVICE,
        "ListMemos",
        response as Uint8Array,
        "connect-proto",
      ),
    ).toEqual({
      memos: [
        {
          name: "memos/fixture",
          state: "NORMAL",
          content: "fixture page",
          visibility: "PRIVATE",
        },
      ],
      nextPageToken: "fixture-next-page",
    });
  });

  it("decodes SignIn password credentials as the generated oneof", () => {
    const request = binaryFixture(SignInRequestSchema, {
      passwordCredentials: {
        username: "fixture-user",
        password: "fixture-only-value",
      },
    });

    expect(
      decodeBinaryRequest(AUTH_SERVICE, "SignIn", request, "connect-proto"),
    ).toEqual({
      passwordCredentials: {
        username: "fixture-user",
        password: "fixture-only-value",
      },
    });
  });

  it("round-trips a RefreshToken response timestamp", () => {
    const response = encodeBinaryResponse(
      AUTH_SERVICE,
      "RefreshToken",
      {
        accessToken: "fixture-access-token",
        expiresAt: "2026-08-05T00:00:00Z",
      },
      "connect-proto",
    );

    expect(
      decodeBinaryResponse(
        AUTH_SERVICE,
        "RefreshToken",
        response as Uint8Array,
        "connect-proto",
      ),
    ).toEqual({
      accessToken: "fixture-access-token",
      expiresAt: "2026-08-05T00:00:00Z",
    });
  });

  it("round-trips InstanceSetting and UserSetting oneof values", () => {
    const instanceResponse = encodeBinaryResponse(
      INSTANCE_SERVICE,
      "GetInstanceSetting",
      {
        name: "instance/settings/GENERAL",
        generalSetting: {
          disallowUserRegistration: true,
          disallowPasswordAuth: false,
          additionalScript: "fixture-script",
          customProfile: {
            title: "Fixture instance",
            description: "Fixture description",
            logoUrl: "https://example.invalid/logo.svg",
          },
        },
      },
      "connect-proto",
    );

    expect(
      decodeBinaryResponse(
        INSTANCE_SERVICE,
        "GetInstanceSetting",
        instanceResponse as Uint8Array,
        "connect-proto",
      ),
    ).toEqual({
      name: "instance/settings/GENERAL",
      generalSetting: {
        disallowUserRegistration: true,
        additionalScript: "fixture-script",
        customProfile: {
          title: "Fixture instance",
          description: "Fixture description",
          logoUrl: "https://example.invalid/logo.svg",
        },
      },
    });

    const userResponse = encodeBinaryResponse(
      USER_SERVICE,
      "UpdateUserSetting",
      {
        name: "users/fixture/settings/GENERAL",
        generalSetting: {
          locale: "zh-CN",
          memoVisibility: "PRIVATE",
          theme: "system",
        },
      },
      "connect-proto",
    );

    expect(
      decodeBinaryResponse(
        USER_SERVICE,
        "UpdateUserSetting",
        userResponse as Uint8Array,
        "connect-proto",
      ),
    ).toEqual({
      name: "users/fixture/settings/GENERAL",
      generalSetting: {
        locale: "zh-CN",
        memoVisibility: "PRIVATE",
        theme: "system",
      },
    });
  });

  it("round-trips attachment externalLink and motionMedia fields", () => {
    const response = encodeBinaryResponse(
      ATTACHMENT_SERVICE,
      "GetAttachment",
      {
        name: "attachments/fixture",
        filename: "fixture.mp4",
        externalLink: "https://example.invalid/fixture.mp4",
        type: "video/mp4",
        memo: "memos/fixture",
        motionMedia: {
          family: "ANDROID_MOTION_PHOTO",
          role: "VIDEO",
          groupId: "fixture-motion-group",
          presentationTimestampUs: "987654321",
          hasEmbeddedVideo: true,
        },
      },
      "connect-proto",
    );

    expect(
      decodeBinaryResponse(
        ATTACHMENT_SERVICE,
        "GetAttachment",
        response as Uint8Array,
        "connect-proto",
      ),
    ).toEqual({
      name: "attachments/fixture",
      filename: "fixture.mp4",
      externalLink: "https://example.invalid/fixture.mp4",
      type: "video/mp4",
      memo: "memos/fixture",
      motionMedia: {
        family: "ANDROID_MOTION_PHOTO",
        role: "VIDEO",
        groupId: "fixture-motion-group",
        presentationTimestampUs: "987654321",
        hasEmbeddedVideo: true,
      },
    });
  });

  it("round-trips UserNotification nested payload fields", () => {
    const response = encodeBinaryResponse(
      USER_SERVICE,
      "UpdateUserNotification",
      {
        name: "users/fixture/notifications/fixture",
        sender: "users/sender",
        senderUser: {
          name: "users/sender",
          role: "USER",
          username: "fixture-sender",
          state: "NORMAL",
        },
        status: "UNREAD",
        createTime: "2026-08-05T00:00:00Z",
        type: "MEMO_COMMENT",
        memoComment: {
          memo: "memos/comment",
          relatedMemo: "memos/fixture",
          memoSnippet: "fixture comment",
          relatedMemoSnippet: "fixture memo",
        },
      },
      "connect-proto",
    );

    expect(
      decodeBinaryResponse(
        USER_SERVICE,
        "UpdateUserNotification",
        response as Uint8Array,
        "connect-proto",
      ),
    ).toEqual({
      name: "users/fixture/notifications/fixture",
      sender: "users/sender",
      senderUser: {
        name: "users/sender",
        role: "USER",
        username: "fixture-sender",
        state: "NORMAL",
      },
      status: "UNREAD",
      createTime: "2026-08-05T00:00:00Z",
      type: "MEMO_COMMENT",
      memoComment: {
        memo: "memos/comment",
        relatedMemo: "memos/fixture",
        memoSnippet: "fixture comment",
        relatedMemoSnippet: "fixture memo",
      },
    });
  });

  it("encodes and decodes an Empty response without adding fields", () => {
    const response = encodeBinaryResponse(
      MEMO_SERVICE,
      "DeleteMemo",
      {},
      "connect-proto",
    );

    expect(response).toEqual(new Uint8Array());
    expect(
      decodeBinaryResponse(
        MEMO_SERVICE,
        "DeleteMemo",
        response as Uint8Array,
        "connect-proto",
      ),
    ).toEqual({});
  });
});
