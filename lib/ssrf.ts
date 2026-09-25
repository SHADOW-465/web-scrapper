/**
 * Keep the server's browser and fetcher on the public internet.
 *
 * This app loads arbitrary user-supplied URLs from inside our own
 * infrastructure. Without this check, "scan http://169.254.169.254/" or
 * "http://localhost:3000/admin" would make the server attack itself.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedUrlError extends Error {}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (v4ToInt(base) & mask);
    });
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v); // ULA, link-local, multicast
  }
  return true; // not an IP at all: refuse rather than guess
}

const BLOCKED_HOSTS = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

/** Cheap synchronous check for browser subresources: literal IPs and obvious names. */
export function isObviouslyInternal(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.test(host)) return true;
  return isIP(host) ? isPrivateIp(host) : false;
}

const cache = new Map<string, Promise<boolean>>();

/** True when every address the hostname resolves to is public. */
export function resolvesPublic(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isObviouslyInternal(host)) return Promise.resolve(false);
  if (isIP(host)) return Promise.resolve(true);
  let p = cache.get(host);
  if (!p) {
    p = lookup(host, { all: true })
      .then((addrs) => addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address)))
      .catch(() => false);
    cache.set(host, p);
    if (cache.size > 2000) cache.clear();
  }
  return p;
}

/** Normalise user input into a URL we are willing to open, or throw. */
export async function assertPublicUrl(input: string): Promise<URL> {
  let raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("That doesn't look like a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError("Only http and https links can be scanned.");
  }
  if (url.username || url.password) {
    throw new BlockedUrlError("Links with a username or password in them can't be scanned.");
  }
  if (!(await resolvesPublic(url.hostname))) {
    throw new BlockedUrlError("That address points at a private or internal network, so it can't be scanned.");
  }
  return url;
}

export function selfCheck(): string {
  const priv = ["127.0.0.1", "10.2.3.4", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"];
  const pub = ["8.8.8.8", "151.101.1.69", "2606:4700::1111"];
  for (const ip of priv) if (!isPrivateIp(ip)) throw new Error(`should block ${ip}`);
  for (const ip of pub) if (isPrivateIp(ip)) throw new Error(`should allow ${ip}`);
  if (!isObviouslyInternal("localhost") || !isObviouslyInternal("db.internal")) throw new Error("name block failed");
  if (isObviouslyInternal("event.buchmesse.de")) throw new Error("public name blocked");
  return "ssrf ok";
}
