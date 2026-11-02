import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { teamInvites } from "@/db/schema";
import { sha256Hex } from "./crypto";

// An invite that hasn't expired, found by the token in its link.
export function findInvite(token: string) {
  return db.query.teamInvites.findFirst({
    where: and(eq(teamInvites.tokenHash, sha256Hex(token)), gt(teamInvites.expiresAt, new Date())),
  });
}
