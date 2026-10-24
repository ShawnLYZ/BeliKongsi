import { isIPv4, isIPv6 } from 'node:net';
import type { AppDeps } from '@/server/platform/deps';
import { unprocessable } from '@/server/platform/errors';

export const DEMO_RECEIVER_PATH = '/api/demo/webhook-receiver';

// [first address as a 32-bit number, prefix length]
const FORBIDDEN_V4: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8 "this network"
  [0x0a000000, 8], // 10/8
  [0x7f000000, 8], // 127/8 loopback
  [0xa9fe0000, 16], // 169.254/16 link-local (cloud metadata)
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
];

function v4ToNumber(ip: string): number {
  return ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
}

function isForbiddenV4(n: number): boolean {
  return FORBIDDEN_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(n / size) === Math.floor(base / size);
  });
}

/** The eight 16-bit groups of an IPv6 address (an embedded dotted IPv4 tail becomes two groups). */
function v6Groups(ip: string): number[] {
  let text = ip;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const n = v4ToNumber(tail[1]!);
    text = `${text.slice(0, -tail[1]!.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = text.split('::') as [string, string | undefined];
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((g) => parseInt(g, 16)));
  const left = parse(head);
  if (rest === undefined) return left;
  const right = parse(rest);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/**
 * True for addresses a webhook must never reach: "this network", private, loopback, link-local and
 * carrier-grade NAT ranges, IPv6 loopback, unspecified, unique-local and link-local, and IPv4
 * addresses embedded in IPv6 (mapped or compatible) that fall in those ranges. Anything that is
 * not an IP address is refused too.
 */
export function isForbiddenAddress(ip: string): boolean {
  if (isIPv4(ip)) return isForbiddenV4(v4ToNumber(ip));
  const bare = ip.split('%')[0]!; // drop a zone id such as fe80::1%eth0
  if (!isIPv6(bare)) return true;
  const g = v6Groups(bare.toLowerCase());
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  const zeros = (count: number) => g.slice(0, count).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, which also covers :: and ::1).
  if (zeros(5) && (g[5] === 0xffff || g[5] === 0)) {
    return isForbiddenV4(g[6]! * 0x10000 + g[7]!);
  }
  return false;
}

const unsafe = (message: string) => unprocessable('UNSAFE_WEBHOOK_URL', message);

/** True only for exactly `${ownOrigin}/api/demo/webhook-receiver`. */
export function isDemoReceiverUrl(url: string, ownOrigin: string): boolean {
  return url === `${ownOrigin}${DEMO_RECEIVER_PATH}`;
}

/**
 * An HTTPS URL without credentials whose host, and every address it resolves to now, is public.
 * Deliveries call this again before every attempt, so a DNS answer that changes after
 * registration is caught.
 */
export async function assertPublicHttpsUrl(
  deps: Pick<AppDeps, 'http'>,
  url: string,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw unsafe('The webhook URL is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') throw unsafe('The webhook URL must use HTTPS.');
  if (parsed.username || parsed.password) {
    throw unsafe('The webhook URL must not carry a user name or password.');
  }
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  let addresses: string[];
  if (isIPv4(host) || isIPv6(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await deps.http.lookup(host);
    } catch {
      throw unsafe('The webhook host could not be resolved.');
    }
    if (addresses.length === 0) throw unsafe('The webhook host could not be resolved.');
  }
  if (addresses.some(isForbiddenAddress)) {
    throw unsafe('The webhook URL points to a private or loopback address.');
  }
}

/**
 * Registration check. The app's own demo receiver on `ownOrigin` (taken from the request URL,
 * never a header) may be plain http, such as http://localhost in development; every other URL must
 * pass `assertPublicHttpsUrl`.
 */
export async function assertSafeWebhookUrl(
  deps: Pick<AppDeps, 'http'>,
  url: string,
  ownOrigin: string,
): Promise<void> {
  if (isDemoReceiverUrl(url, ownOrigin)) return;
  await assertPublicHttpsUrl(deps, url);
}
