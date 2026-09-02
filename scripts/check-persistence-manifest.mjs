import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_CLASSIFIED_TABLES,
  REBUILDABLE_TABLES,
  RESTORE_TABLES,
} from "./persistence-manifest.mjs";

const schemaPath = resolve("packages/db/src/schema.ts");
const schema = readFileSync(schemaPath, "utf8");
const schemaTables = [
  ...schema.matchAll(/sqliteTable\(\s*["']([^"']+)["']/g),
].map((match) => match[1]);

const duplicateSchemaTables = duplicates(schemaTables);
const duplicateClassifications = duplicates(ALL_CLASSIFIED_TABLES);
const unclassified = schemaTables.filter(
  (table) => !ALL_CLASSIFIED_TABLES.includes(table),
);
const unknownClassifications = ALL_CLASSIFIED_TABLES.filter(
  (table) => !schemaTables.includes(table),
);

if (
  duplicateSchemaTables.length > 0 ||
  duplicateClassifications.length > 0 ||
  unclassified.length > 0 ||
  unknownClassifications.length > 0
) {
  throw new Error(
    [
      "Persistence manifest must classify every physical sqliteTable exactly once.",
      duplicateSchemaTables.length > 0
        ? `Duplicate schema tables: ${duplicateSchemaTables.join(", ")}`
        : null,
      duplicateClassifications.length > 0
        ? `Duplicate manifest tables: ${duplicateClassifications.join(", ")}`
        : null,
      unclassified.length > 0
        ? `Unclassified schema tables: ${unclassified.join(", ")}`
        : null,
      unknownClassifications.length > 0
        ? `Manifest tables absent from schema: ${unknownClassifications.join(", ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

console.log(
  `Persistence manifest verified: ${RESTORE_TABLES.length} restore tables, ${REBUILDABLE_TABLES.length} rebuildable table.`,
);

function duplicates(values) {
  const seen = new Set();
  const duplicateValues = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues];
}
