/**
 * Issues a new API client (client_id + client_secret) — the ONLY way a
 * client gets credentials, deliberately not a public self-service endpoint
 * (see src/auth/). Run with:
 *
 *   npx tsx src/db/createApiClient.ts "frontend-team"
 *
 * The raw client_secret is shown exactly once, right here in this output —
 * only its bcrypt hash is stored, so if you lose it, the only fix is
 * creating a new client (there's no "recover the secret" path, same as a
 * password).
 */
import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb } from "./mongo";
import { ApiClientDoc, createIndexes } from "./authRepository";

const BCRYPT_ROUNDS = 12;

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('Usage: npx tsx src/db/createApiClient.ts "<client name>"');
    process.exit(1);
  }

  await createIndexes();

  const clientId = randomUUID();
  const clientSecret = randomBytes(32).toString("base64url");
  const clientSecretHash = await bcrypt.hash(clientSecret, BCRYPT_ROUNDS);

  const db = await getDb();
  const doc: ApiClientDoc = {
    client_id: clientId,
    client_secret_hash: clientSecretHash,
    name,
    active: true,
    created_at: new Date().toISOString(),
  };
  await db.collection<ApiClientDoc>("api_clients").insertOne(doc);

  console.log(`Created API client "${name}".`);
  console.log();
  console.log("Give these to the client — the secret is shown ONLY this once:");
  console.log(`  client_id:     ${clientId}`);
  console.log(`  client_secret: ${clientSecret}`);
  console.log();
  console.log("They use them once at POST /api/auth/token to get an access+refresh token pair.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to create API client:", err);
  process.exit(1);
});
