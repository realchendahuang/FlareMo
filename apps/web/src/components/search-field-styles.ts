/*
 * The header search field, shared by the timeline's palette trigger and the
 * in-page filters (memory). One shape for "search here": h-8 card field with
 * the input border, the same hover deepening and focus ring as every input.
 */
export const HEADER_SEARCH_FIELD_CLASS =
  "group relative flex h-8 items-center rounded-lg border border-input/80 bg-card text-xs shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-[color-mix(in_oklch,var(--input),var(--foreground)_12%)] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20 dark:bg-input/20";
