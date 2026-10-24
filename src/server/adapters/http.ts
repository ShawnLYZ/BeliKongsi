import { lookup } from 'node:dns/promises';

/** Outbound HTTP for webhook deliveries. Tests swap in a stub that never touches the network. */
export interface HttpAdapter {
  fetch: typeof fetch;
  /** Every address the host resolves to (IPv4 and IPv6). */
  lookup: (host: string) => Promise<string[]>;
}

export const realHttp: HttpAdapter = {
  fetch: (input, init) => fetch(input, init),
  lookup: async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address),
};
