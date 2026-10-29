import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/logo";

export const metadata: Metadata = { title: "Privacy policy · Relistic" };

const UPDATED = "October 29, 2026";
const CONTACT = "angela.b@apeirosmarketing.com";

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}

// Public page: linked from the home page and given to marketplaces during app reviews.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 px-6 py-16 text-zinc-700 [&_li]:ml-5 [&_li]:list-disc">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-zinc-900">
        <LogoMark className="h-7 w-7" />
        Relistic
      </Link>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Privacy policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated {UPDATED}</p>
      </div>

      <p>
        Relistic is a service run by Apeiros Marketing, LLC (&ldquo;we&rdquo;) that helps sellers list items on several
        online marketplaces and keep them in sync. This policy explains what personal information we collect, how we
        use it, and the choices you have.
      </p>

      <Section title="What we collect">
        <ul className="space-y-1">
          <li>
            <strong>Your account:</strong> your name, email address, business name and password (stored only as a
            one-way hash).
          </li>
          <li>
            <strong>Your stores:</strong> when you connect a marketplace (such as eBay, Etsy, Shopify or TikTok Shop),
            the access it grants Relistic, stored encrypted, and your shop&apos;s name and ID.
          </li>
          <li>
            <strong>Your inventory:</strong> the items, photos, prices and notes you add or import.
          </li>
          <li>
            <strong>Your sales:</strong> order details from your connected stores, which can include a buyer&apos;s
            name or username and what they bought, so you can track sales and keep stock in sync.
          </li>
          <li>
            <strong>Billing:</strong> your subscription status. Card payments are handled by Stripe; we never see or
            store your card number.
          </li>
        </ul>
      </Section>

      <Section title="How we use it">
        <p>
          Only to provide Relistic: to list, update and remove your items on the stores you choose, record your sales,
          create shipping labels if you ask us to, run your subscription, and help you when you contact us. We do not
          sell or rent personal information, and we do not use it for advertising.
        </p>
      </Section>

      <Section title="Who we share it with">
        <p>Only with the services that run Relistic, and only what each needs:</p>
        <ul className="space-y-1">
          <li>the marketplaces you connect, to post and manage your listings;</li>
          <li>Neon (our database host) and our server host, to store and run the service;</li>
          <li>Stripe, for subscription payments;</li>
          <li>Anthropic, which processes the photos and details you send to the AI listing assistant to draft listings;</li>
          <li>Shippo, if you connect it to buy shipping labels.</li>
        </ul>
        <p>We may also disclose information if the law requires it.</p>
      </Section>

      <Section title="Where it is stored and how it is protected">
        <p>
          Your information is stored and processed in the United States. All connections use encryption (HTTPS/TLS),
          stored data is encrypted by our database provider, and marketplace access keys are additionally encrypted by
          Relistic. Each account can see only its own data.
        </p>
      </Section>

      <Section title="How long we keep it, and your choices">
        <ul className="space-y-1">
          <li>We keep your information while your account is open.</li>
          <li>
            Disconnecting a store on the Stores page deletes the access Relistic held for it.
          </li>
          <li>
            Closing your account (Account settings, Close account) permanently deletes your account and everything in
            it, including items, sales, buyer notes and store connections.
          </li>
          <li>
            You can ask us for a copy of your information, or to correct or delete it, by emailing us. We respond
            within 30 days. Buyers can make the same requests through the seller they bought from, or by contacting us.
          </li>
        </ul>
      </Section>

      <Section title="Cookies">
        <p>
          Relistic uses a cookie to keep you signed in, and short-lived cookies while you connect a store. We do not use advertising or tracking cookies.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We will update this page when our practices change and show the date above. Questions or requests:{" "}
          <a href={`mailto:${CONTACT}`} className="underline">
            {CONTACT}
          </a>
          , Apeiros Marketing, LLC.
        </p>
      </Section>
    </main>
  );
}
