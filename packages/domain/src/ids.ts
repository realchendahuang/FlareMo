export function createResourceId(prefix: "attachments" | "memos" | "shares") {
  return `${prefix}/${crypto.randomUUID()}`;
}

export function parseResourceName(
  name: string,
  prefix: "attachments" | "memos" | "shares",
) {
  if (name.startsWith(`${prefix}/`)) {
    return name;
  }
  return `${prefix}/${name}`;
}

export function createToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
