import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";

// Applies any database changes that haven't run yet. Used on hosts where we can't
// run `npm run db:migrate` by hand, such as cPanel (see MIGRATE_ON_START).
export async function migrateDatabase() {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}
