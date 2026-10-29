import { extensionCaller } from "@/lib/extension/keys";
import { openTasksFor } from "@/lib/extension/tasks";

// The listings waiting for the extension to post, update or take down.
export async function GET(request: Request) {
  const caller = await extensionCaller(request);
  if (!caller) return Response.json({ error: "Connect the extension to Relistic again." }, { status: 401 });
  return Response.json({ tasks: await openTasksFor(caller.organizationId) });
}
