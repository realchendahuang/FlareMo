export const AUTHENTICATION_REQUIRED_EVENT = "flaremo:authentication-required";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { authRequired?: boolean } = {},
) {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  // The web app still consumes FlareMo's original snake_case DTOs for its
  // /api/v1 attachment, share, relation, import, and export helpers. Keep
  // that internal client explicit while external /api/v1 callers default to
  // the current Memos-compatible wire.
  if (path.startsWith("/api/v1/") && !headers.has("x-flaremo-wire")) {
    headers.set("x-flaremo-wire", "legacy");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    let message = response.statusText;
    if (isJson) {
      const body = (await response.json()) as { error?: { message?: string } };
      message = body.error?.message ?? message;
    }
    if (
      response.status === 401 &&
      options.authRequired !== false &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event(AUTHENTICATION_REQUIRED_EVENT));
    }
    throw new ApiError(message, response.status);
  }

  // 204 No Content is a successful write that carries no body to parse (the
  // connected-app revoke endpoint answers 204). Callers await it for the
  // outcome only.
  if (response.status === 204) {
    return undefined as T;
  }

  if (!isJson) {
    throw new ApiError("The server returned an unexpected response.", 502);
  }

  return (await response.json()) as T;
}
