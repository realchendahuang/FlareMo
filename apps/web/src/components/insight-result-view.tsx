import type { ReactNode } from "react";

/**
 * Defensive renderer for an insight `result`.
 *
 * The contract stores arbitrary JSON (§9: the executor decides the shape), so
 * nothing here may assume a schema. Strings keep their line breaks, arrays
 * become lists, objects become key/value blocks, and anything too deep or too
 * wide falls back to pretty JSON instead of overflowing the note.
 */

/** Beyond this nesting level the raw JSON is more honest than a subtitle. */
const MAX_DEPTH = 3;
/** Lists and objects are clipped so one runaway result cannot flood the page. */
const MAX_ITEMS = 30;

export function InsightResultView({ result }: { result: unknown }) {
  if (result === null || result === undefined) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      {renderInsightValue(result, 0)}
    </div>
  );
}

export function renderInsightValue(value: unknown, depth = 0): ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === "string") {
    return <span className="break-words whitespace-pre-wrap">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return <JsonFallback value={value} />;
    return (
      <ul className="flex list-disc flex-col gap-1 ps-5">
        {value.slice(0, MAX_ITEMS).map((item, index) => (
          // Parallel JSON arrays have no stable identity; position is the only
          // key the executor's output offers.
          // biome-ignore lint/suspicious/noArrayIndexKey: rendered JSON has no ids
          <li key={index}>{renderInsightValue(item, depth + 1)}</li>
        ))}
        {value.length > MAX_ITEMS && (
          <li aria-hidden="true" className="text-muted-foreground">
            …
          </li>
        )}
      </ul>
    );
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return <JsonFallback value={value} />;
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="flex flex-col gap-1.5">
        <dl className="flex flex-col gap-1.5">
          {entries.slice(0, MAX_ITEMS).map(([key, item]) => (
            <div className="flex flex-col gap-0.5" key={key}>
              <dt className="text-xs font-medium text-muted-foreground">
                {key.replace(/[_-]+/g, " ")}
              </dt>
              <dd>{renderInsightValue(item, depth + 1)}</dd>
            </div>
          ))}
        </dl>
        {entries.length > MAX_ITEMS && (
          <span aria-hidden="true" className="text-xs text-muted-foreground">
            …
          </span>
        )}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

function JsonFallback({ value }: { value: unknown }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-2 text-xs break-words whitespace-pre-wrap">
      {text}
    </pre>
  );
}
