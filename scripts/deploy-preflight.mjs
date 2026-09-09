const secret = process.env.BETTER_AUTH_SECRET?.trim();

if (!secret || secret.length < 32) {
  console.error(
    "BETTER_AUTH_SECRET must be set to a generated value of at least 32 characters before deployment.",
  );
  process.exit(1);
}

if (/^(change[-_ ]?me|secret|password|test|dev)$/i.test(secret)) {
  console.error(
    "BETTER_AUTH_SECRET still uses a known placeholder. Generate a unique production secret before deployment.",
  );
  process.exit(1);
}

const unique = new Set(secret).size;
if (unique < 12) {
  console.error("BETTER_AUTH_SECRET has too little character diversity; generate a random secret.");
  process.exit(1);
}

console.log("Deployment preflight passed: Better Auth secret is configured.");
