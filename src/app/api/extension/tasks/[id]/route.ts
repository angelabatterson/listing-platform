import { z } from "zod";
import { extensionCaller } from "@/lib/extension/keys";
import { reportTask } from "@/lib/extension/tasks";

const reportSchema = z.discriminatedUnion("result", [
  z.object({
    result: z.literal("done"),
    remoteListingId: z.string().trim().min(1).max(200).optional(),
    url: z.url({ protocol: /^https$/ }).max(500).optional(),
  }),
  z.object({ result: z.literal("failed"), error: z.string().trim().min(1).max(500) }),
  z.object({ result: z.literal("skipped") }),
]);

// The extension reports how a task went: posted (with the new listing's link), failed, or skipped.
export async function POST(request: Request, ctx: RouteContext<"/api/extension/tasks/[id]">) {
  const caller = await extensionCaller(request);
  if (!caller) return Response.json({ error: "Connect the extension to Relistic again." }, { status: 401 });
  const { id } = await ctx.params;
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "That task wasn't found." }, { status: 404 });
  const task = await reportTask(caller.organizationId, id, parsed.data);
  if (!task) return Response.json({ error: "That task wasn't found or is already finished." }, { status: 404 });
  return Response.json({ ok: true });
}
