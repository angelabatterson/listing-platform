// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.MIGRATE_ON_START === "true") {
    const { migrateDatabase } = await import("./db/migrate");
    await migrateDatabase();
  }
}
