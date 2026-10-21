export type SecretKind =
  | 'google-api-key'
  | 'gemini-key'
  | 'supabase-pat'
  | 'nvidia-key'
  | 'jwt'
  | 'private-key'
  | 'postgres-password'
  | 'generic-secret'
  | 'supabase-secret'
  | 'forbidden-file';

export type Finding = { path: string; line: number; kind: SecretKind };

const PATTERNS: ReadonlyArray<{ kind: SecretKind; regex: RegExp }> = [
  { kind: 'google-api-key', regex: /AIza[0-9A-Za-z_-]{35}/ },
  { kind: 'gemini-key', regex: /AQ\.[0-9A-Za-z_-]{40,}/ },
  { kind: 'supabase-pat', regex: /sbp_[0-9a-f]{40}/ },
  { kind: 'supabase-secret', regex: /sb_secret_[0-9A-Za-z_-]{20,}/ },
  { kind: 'nvidia-key', regex: /nvapi-[0-9A-Za-z_-]{40,}/ },
  {
    kind: 'jwt',
    regex: /eyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/,
  },
  { kind: 'private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const POSTGRES_URL = /postgres(?:ql)?:\/\/[^:\s/]+:([^@\s]+)@/g;
const ALLOWED_PASSWORDS = new Set(['postgres', 'bk_app_dev', 'bk_app_test', 'e2e']);

function hasRealPostgresPassword(line: string): boolean {
  for (const match of line.matchAll(POSTGRES_URL)) {
    const password = match[1] ?? '';
    const isPlaceholder = password.startsWith('<') && password.endsWith('>');
    if (!isPlaceholder && !ALLOWED_PASSWORDS.has(password)) return true;
  }
  return false;
}

const GENERIC_SECRET = /^\s*(?:export\s+)?[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|_KEY)\s*[=:]\s*(\S+)/;

function hasGenericSecret(line: string): boolean {
  const match = GENERIC_SECRET.exec(line);
  if (!match) return false;
  // Strip one pair of quotes and a trailing comma/semicolon before judging the value.
  const value = (match[1] ?? '').replace(/[,;]$/, '').replace(/^(['"`])(.*)\1$/, '$2');
  if (value === '') return false;
  if (/^<.*>$/.test(value)) return false;
  if (/^z\./.test(value)) return false; // zod schema code, not a value
  if (value.startsWith('${') || value.includes('process.env')) return false;
  return !ALLOWED_PASSWORDS.has(value);
}

function isTestFixture(path: string): boolean {
  return /(^|[/\\])tests[/\\]/.test(path);
}

export function isForbiddenPath(path: string): boolean {
  const name = (path.split(/[/\\]/).pop() ?? '').toLowerCase();
  if (name === 'api_key_configuration.md') return true;
  if (name === '.env') return true;
  return name.startsWith('.env.') && name !== '.env.example';
}

export function scanText(path: string, content: string): Finding[] {
  if (content.includes('\u0000')) return [];
  const findings: Finding[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    for (const { kind, regex } of PATTERNS) {
      if (regex.test(text)) findings.push({ path, line, kind });
    }
    if (hasRealPostgresPassword(text)) findings.push({ path, line, kind: 'postgres-password' });
    // Test fixtures carry fake credentials by design; the specific patterns above still apply.
    if (!isTestFixture(path) && hasGenericSecret(text))
      findings.push({ path, line, kind: 'generic-secret' });
  });
  return findings;
}
