import assert from "node:assert/strict";
import test from "node:test";
import {
  isAlreadyExists,
  isPlaceholderDatabaseId,
  isPlaceholderPublicUrl,
  listedResourceExists,
  resourcesFromConfig,
  workersDevOrigin,
} from "./provision-cloudflare.mjs";

test("treats missing and template D1 ids as placeholders", () => {
  assert.equal(isPlaceholderDatabaseId(""), true);
  assert.equal(
    isPlaceholderDatabaseId("REPLACE_WITH_YOUR_D1_DATABASE_ID"),
    true,
  );
  assert.equal(
    isPlaceholderDatabaseId("00000000-0000-0000-0000-000000000000"),
    true,
  );
  assert.equal(
    isPlaceholderDatabaseId("11111111-1111-1111-1111-111111111111"),
    false,
  );
});

test("reads FlareMo resource names from wrangler config", () => {
  const resources = resourcesFromConfig({
    d1_databases: [
      {
        database_name: "flaremo",
        database_id: "REPLACE_WITH_YOUR_D1_DATABASE_ID",
      },
    ],
    r2_buckets: [{ bucket_name: "flaremo-attachments" }],
    queues: {
      producers: [
        { queue: "flaremo-member-removal" },
        { queue: "flaremo-data-export" },
      ],
      consumers: [{ queue: "flaremo-member-removal" }],
    },
    vectorize: [
      { index_name: "flaremo-memos" },
      { index_name: "flaremo-memories" },
    ],
    vars: { FLAREMO_EMBEDDING_DIMENSIONS: "1024" },
  });

  assert.equal(resources.databaseName, "flaremo");
  assert.equal(resources.bucketName, "flaremo-attachments");
  assert.deepEqual(resources.queues, [
    "flaremo-member-removal",
    "flaremo-data-export",
  ]);
  assert.deepEqual(resources.indexes, ["flaremo-memos", "flaremo-memories"]);
  assert.equal(resources.dimensions, 1024);
  assert.equal(resources.metric, "cosine");
});

test("treats empty and documentation origins as placeholder public URLs", () => {
  assert.equal(isPlaceholderPublicUrl(""), true);
  assert.equal(
    isPlaceholderPublicUrl("https://flaremo.example.workers.dev"),
    true,
  );
  assert.equal(isPlaceholderPublicUrl("https://notes.example.com"), true);
  assert.equal(
    isPlaceholderPublicUrl("https://flaremo.myaccount.workers.dev"),
    false,
  );
  assert.equal(isPlaceholderPublicUrl("https://notes.example.com/path"), true);
});

test("builds the workers.dev origin from worker name and account subdomain", () => {
  assert.equal(
    workersDevOrigin("flaremo", "myaccount"),
    "https://flaremo.myaccount.workers.dev",
  );
});

test("treats Cloudflare queue name conflicts as already existing", () => {
  const output =
    "Queue name 'flaremo-member-removal' is already taken. Please use a different name and try again. [code: 11009]";
  assert.equal(isAlreadyExists(output), true);
});

test("treats R2 and D1 name conflicts as already existing", () => {
  assert.equal(
    isAlreadyExists(
      "A request to the Cloudflare API failed.\nBucket name already exists. [code: 10073]",
    ),
    true,
  );
  assert.equal(
    isAlreadyExists("Database with name flaremo already exists [code: 7502]"),
    true,
  );
  assert.equal(isAlreadyExists("An index with this name already exists"), true);
});

test("matches listed Cloudflare resource names without substring collisions", () => {
  const list = "name: flaremo-attachments\nname: flaremo-memos";
  assert.equal(listedResourceExists(list, "flaremo-attachments"), true);
  assert.equal(listedResourceExists(list, "flaremo"), false);
});
