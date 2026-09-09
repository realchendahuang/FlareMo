export function downloadJsonFile(value: unknown, filename: string) {
  downloadBlobFile(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    filename,
  );
}

export function downloadBlobFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Safari can start reading the object URL after click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
