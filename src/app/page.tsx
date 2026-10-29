import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home(props: PageProps<"/">) {
  if (await getCurrentUser()) redirect("/items");
  const { closed } = await props.searchParams;
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      {closed === "1" && (
        <p className="rounded-md border border-zinc-200 bg-white p-4 text-sm">
          Your account has been closed and its data deleted. Thanks for using Relistic.
        </p>
      )}
      <p className="flex items-center gap-2 text-lg font-semibold">
        <LogoMark className="h-7 w-7" />
        Relistic
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">List once. Sell everywhere.</h1>
      <p className="text-lg text-zinc-600">
        Keep one inventory, choose which marketplaces each item appears on, and when it sells in one
        place it comes down everywhere else.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className="btn">Create an account</Link>
        <Link href="/login" className="btn-secondary">Log in</Link>
      </div>
      <p className="text-sm text-zinc-500">
        <Link href="/privacy" className="underline">Privacy policy</Link>
      </p>
    </main>
  );
}
