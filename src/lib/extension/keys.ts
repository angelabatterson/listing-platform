import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { extensionKeys, users } from "@/db/schema";
import { randomToken, sha256Hex } from "@/lib/crypto";

const PREFIX = "rlx_";

// A new key for one browser's extension. Only its hash is stored, so it's shown once.
export async function createExtensionKey(user: { id: string; organizationId: string }): Promise<string> {
  const key = PREFIX + randomToken();
  await db.insert(extensionKeys).values({ organizationId: user.organizationId, userId: user.id, keyHash: sha256Hex(key) });
  return key;
}

export type ExtensionCaller = { keyId: string; userId: string; organizationId: string; email: string };

// The account behind an "Authorization: Bearer rlx_…" header, or null.
export async function extensionCaller(request: Request): Promise<ExtensionCaller | null> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key.startsWith(PREFIX)) return null;
  const [row] = await db
    .select({ keyId: extensionKeys.id, userId: users.id, organizationId: users.organizationId, email: users.email })
    .from(extensionKeys)
    .innerJoin(users, eq(users.id, extensionKeys.userId))
    // A key only works in the account it was made for.
    .where(and(eq(extensionKeys.keyHash, sha256Hex(key)), eq(extensionKeys.organizationId, users.organizationId)));
  if (!row) return null;
  await db.update(extensionKeys).set({ lastUsedAt: new Date() }).where(eq(extensionKeys.id, row.keyId));
  return row;
}
