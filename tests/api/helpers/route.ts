/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { globSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

interface RouteEntry {
  file: string;
  regex: RegExp;
  score: number[];
}

type Handler = (request: Request, ctx: { params: Promise<Record<string, unknown>> }) => unknown;

const cache = new Map<string, RouteEntry[]>();

function buildRoutes(searchKey: string, baseKey: string): RouteEntry[] {
  const cacheKey = `${searchKey}|${baseKey}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const cwd = process.cwd();
  const searchDir = resolve(cwd, searchKey);
  const baseDir = resolve(cwd, baseKey);
  const entries = globSync('**/route.ts', { cwd: searchDir }).map((rel) => {
    const file = resolve(searchDir, rel);
    const folders = relative(baseDir, file).split(sep).slice(0, -1);
    // Route groups like (marketing) do not appear in the URL.
    const segments = folders.filter((s) => !/^\(.*\)$/.test(s));
    let pattern = '^';
    const score: number[] = [];
    for (const seg of segments) {
      const catchAll = /^\[\.\.\.(\w+)\]$/.exec(seg);
      const dynamic = /^\[(\w+)\]$/.exec(seg);
      if (catchAll) {
        pattern += `/(?<${catchAll[1]}>.+)`;
        score.push(0);
      } else if (dynamic) {
        pattern += `/(?<${dynamic[1]}>[^/]+)`;
        score.push(1);
      } else {
        pattern += `/${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
        score.push(2);
      }
    }
    pattern += '/?$';
    return { file, regex: new RegExp(pattern), score };
  });
  // More specific routes (static over dynamic over catch-all) are tried first.
  entries.sort((a, b) => {
    for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
      const diff = (b.score[i] ?? -1) - (a.score[i] ?? -1);
      if (diff !== 0) return diff;
    }
    return 0;
  });
  cache.set(cacheKey, entries);
  return entries;
}

export async function callRoute(
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string>; routesDir?: string } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  // Without routesDir, URLs are relative to src/app so src/app/api/health serves /api/health.
  const routes = buildRoutes(init.routesDir ?? 'src/app/api', init.routesDir ?? 'src/app');

  const url = new URL('http://localhost' + path);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : '';
  let matched: RouteEntry | undefined;
  let params: Record<string, string> = {};
  for (const entry of routes) {
    const m = entry.regex.exec(pathname);
    if (m) {
      matched = entry;
      params = Object.fromEntries(
        Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]),
      );
      break;
    }
  }
  if (!matched) {
    return { status: 404, body: null, headers: new Headers() };
  }

  const mod = (await import(/* @vite-ignore */ pathToFileURL(matched.file).href)) as Record<
    string,
    unknown
  >;
  const handler = mod[method.toUpperCase()];
  if (typeof handler !== 'function') {
    return { status: 405, body: null, headers: new Headers() };
  }

  const headers = new Headers(init.headers);
  let body: string | undefined;
  if (init.body !== undefined) {
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
    if (typeof init.body !== 'string' && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  const request = new Request(url, { method: method.toUpperCase(), headers, body });
  const response = (await (handler as Handler)(request, {
    params: Promise.resolve(params),
  })) as Response;

  const text = await response.text();
  let parsed: any = text;
  if (text === '') {
    parsed = null;
  } else if ((response.headers.get('content-type') ?? '').includes('json')) {
    parsed = JSON.parse(text);
  }
  return { status: response.status, body: parsed, headers: response.headers };
}
