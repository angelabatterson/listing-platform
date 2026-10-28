import { describe, expect, it } from "vitest";
import { planChannelAction } from "@/lib/sync/plan";

const live = { enabled: true, status: "listed" as const, remoteListingId: "L1" };
const fresh = { enabled: true, status: "not_listed" as const, remoteListingId: null };

describe("planChannelAction", () => {
  it("publishes an active, in-stock item on an enabled store", () => {
    expect(planChannelAction({ status: "active", quantity: 2 }, fresh)).toBe("publish");
    expect(planChannelAction({ status: "active", quantity: 2 }, live)).toBe("publish");
  });

  it("ends a live listing when the item sells out, is archived, or the store is unticked", () => {
    expect(planChannelAction({ status: "active", quantity: 0 }, live)).toBe("end");
    expect(planChannelAction({ status: "archived", quantity: 1 }, live)).toBe("end");
    expect(planChannelAction({ status: "active", quantity: 1 }, { ...live, enabled: false })).toBe("end");
  });

  it("ends a listing that errored after going live", () => {
    expect(planChannelAction({ status: "active", quantity: 0 }, { ...live, status: "error" })).toBe("end");
  });

  it("does nothing for drafts that were never listed or listings already ended", () => {
    expect(planChannelAction({ status: "draft", quantity: 1 }, fresh)).toBe("none");
    expect(planChannelAction({ status: "active", quantity: 0 }, { ...live, status: "ended" })).toBe("none");
  });
});
