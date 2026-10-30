import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { extensionCaller } from "@/lib/extension/keys";
import { EXTENSION_MARKETPLACES, MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";

type Caller = NonNullable<Awaited<ReturnType<typeof extensionCaller>>>;

const unauthorized = () => Response.json({ error: "Connect the extension to Relistic again." }, { status: 401 });

const addedStores = (caller: Caller) =>
  db.query.connections.findMany({
    where: and(
      eq(connections.organizationId, caller.organizationId),
      eq(connections.status, "active"),
      inArray(connections.marketplace, [...EXTENSION_MARKETPLACES]),
    ),
  });

// Who the extension is connected as, and which of its stores the account has added.
export async function GET(request: Request) {
  const caller = await extensionCaller(request);
  if (!caller) return unauthorized();
  return answer(caller, await addedStores(caller));
}

const signInSchema = z.object({ signedIn: z.record(z.string(), z.boolean()) });

// Saved at most every few minutes unless it changes, since the extension checks every minute.
const RESAVE_MS = 10 * 60 * 1000;

// The extension reports which stores you're signed in to in Chrome, then gets the same answer as GET.
export async function POST(request: Request) {
  const caller = await extensionCaller(request);
  if (!caller) return unauthorized();
  const parsed = signInSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  const stores = await addedStores(caller);
  const now = new Date();
  for (const store of stores) {
    const signedIn = parsed.data.signedIn[store.marketplace];
    if (signedIn === undefined) continue;
    const last = store.settings.chromeSignIn;
    if (last?.signedIn === signedIn && now.getTime() - new Date(last.checkedAt).getTime() < RESAVE_MS) continue;
    store.settings = { ...store.settings, chromeSignIn: { signedIn, checkedAt: now.toISOString() } };
    await db.update(connections).set({ settings: store.settings }).where(eq(connections.id, store.id));
  }
  return answer(caller, stores);
}

function answer(caller: Caller, stores: Awaited<ReturnType<typeof addedStores>>) {
  return Response.json({
    email: caller.email,
    stores: stores.map((s) => ({ marketplace: s.marketplace, name: MARKETPLACE_LABELS[s.marketplace] })),
  });
}
