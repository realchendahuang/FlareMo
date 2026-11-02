export * from "./articles";
export * from "./attachment-refs";
export * from "./branding";
export * from "./calendar";
export * from "./capture";
export * from "./constants";
export * from "./embedding";
export * from "./memos";
export * from "./memos-current";
export * from "./projects";
export * from "./search-query";
export * from "./tags";

// The OpenAPI documents are deliberately NOT re-exported here. Together they
// are two thousand lines of literal path objects, and every consumer of this
// barrel — the browser entry chunk and the Worker startup graph included —
// used to pay for them just to reach a single constant. Import them from
// `@flaremo/contracts/openapi` and `@flaremo/contracts/openapi-current`.
