import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  if (await getCurrentUser()) redirect("/items");
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">List once. Sell everywhere.</h1>
      <p className="text-lg text-zinc-600">
        Keep one inventory, choose which marketplaces each item appears on, and when it sells in one
        place it comes down everywhere else.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className="btn">Create an account</Link>
        <Link href="/login" className="btn-secondary">Log in</Link>
      </div>
    </main>
  );
}
