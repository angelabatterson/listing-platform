import { isIP } from "node:net";

function isPrivateIPv4(host: string): boolean {
  const [a, b] = host.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(host: string): boolean {
  return host === "::" || host === "::1" || /^f[cd]/.test(host) || host.startsWith("fe80") || host.startsWith("::ffff:");
}

// Photo links are user-supplied and get downloaded by the server (Etsy needs the
// file itself), so refuse anything that could point at internal addresses.
export function isSafePublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const ipVersion = isIP(host);
  if (ipVersion === 4) return !isPrivateIPv4(host);
  if (ipVersion === 6) return !isPrivateIPv6(host);
  // A bare name like "intranet" or a local suffix isn't a public site.
  return host.includes(".") && !host.endsWith(".localhost") && !host.endsWith(".internal") && !host.endsWith(".local");
}
