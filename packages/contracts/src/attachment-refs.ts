/**
 * Inline body images reference attachments through the Memos-compatible
 * `/file/attachments/{id}/{filename}` bridge. The path is context-portable by
 * design: same-origin cookie auth renders it inside the app, and the public
 * share page appends `?share_token=` for anonymous visitors. These helpers
 * were copied into the web app, the share renderer, and the article renderer;
 * they live here so all three parse the same way.
 */

/** Resolves to the bare attachment id referenced by a `/file/attachments/` URL. */
const ATTACHMENT_REF = /\/file\/attachments\/([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export function extractReferencedAttachmentIds(content: string): Set<string> {
  const ids = new Set<string>();
  for (const match of content.matchAll(ATTACHMENT_REF)) {
    ids.add(match[1] ?? "");
  }
  return ids;
}

/**
 * Appends the share token to `/file/attachments/` targets so the public share
 * page can fetch body images anonymously. Only markdown link/image destinations
 * are touched, fenced code is skipped, and URLs that already carry a query get
 * `&` instead of `?`.
 */
export function injectShareTokenIntoFileUrls(
  content: string,
  token: string,
): string {
  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/(\]\(\/file\/attachments\/[^\s)]*)/g, (target) =>
        target.includes("?")
          ? `${target}&share_token=${token}`
          : `${target}?share_token=${token}`,
      );
    })
    .join("\n");
}
