"use server";

import { requireUser } from "@/lib/auth";
import { createExtensionKey } from "@/lib/extension/keys";

// A key for the extension in this browser. It's handed to the extension on the page
// and never shown, so connecting again simply makes a new one.
export async function newExtensionKey(): Promise<string> {
  const user = await requireUser();
  return createExtensionKey(user);
}
