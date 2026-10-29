import { eq } from "drizzle-orm";
import { ItemForm } from "@/components/item-form";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { storeOptions } from "@/lib/stores";
import { saveItem } from "../actions";

export default async function NewItemPage() {
  const user = await requireUser();
  const conns = await db.query.connections.findMany({
    where: eq(connections.organizationId, user.organizationId),
  });
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Add item</h1>
      <ItemForm
        action={saveItem.bind(null, null)}
        submitLabel="Save item"
        stores={storeOptions(conns).map((s) => ({ ...s, enabled: s.ready }))}
        values={{
          title: "",
          sku: "",
          description: "",
          price: "",
          cost: "",
          quantity: 1,
          condition: "USED_GOOD",
          brand: "",
          status: "active",
          imageUrls: "",
          specifics: "",
          skuLocked: false,
        }}
      />
    </div>
  );
}
