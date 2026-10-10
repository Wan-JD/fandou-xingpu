export interface DemoSessionUser {
  id: string;
  email: string;
  displayName: string;
  personId: string;
  role: "member" | "admin";
}

interface DemoAccount extends DemoSessionUser {
  passwordHash: string;
  passwordSalt: string;
}

interface DemoSessionRecord {
  email: string;
  expiresAt: number;
}

interface LoginAttempt {
  failures: number[];
  blockedUntil: number;
}

export type DemoSession = {
  token: string;
  expiresAt: string;
  user: DemoSessionUser;
};

export type DemoLoginResult =
  | { status: "success"; session: DemoSession }
  | { status: "invalid" }
  | { status: "rate_limited"; retryAfterSeconds: number };

const PASSWORD_ITERATIONS = 120_000;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

const accountsByEmail = new Map<string, DemoAccount>();
const sessionsByToken = new Map<string, DemoSessionRecord>();
const loginAttemptsByEmail = new Map<string, LoginAttempt>();
let nextAccountId = 2;
let seedAccountPromise: Promise<void> | null = null;

export const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase();
const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));

async function derivePasswordHash(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_ITERATIONS },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

async function passwordFields(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { passwordSalt: bytesToHex(salt), passwordHash: await derivePasswordHash(password, salt) };
}

export async function createPasswordFields(password: string) {
  return passwordFields(password);
}

export async function verifyPassword(password: string, passwordSalt: string, expectedHash: string) {
  const actualHash = await derivePasswordHash(password, hexToBytes(passwordSalt));
  return hashesMatch(expectedHash, actualHash);
}

export function bearerToken(authorization: string | undefined) {
  return authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

export function createOpaqueToken(prefix: "session" | "invite") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hashesMatch(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function ensureSeedAccount() {
  if (!seedAccountPromise) {
    seedAccountPromise = (async () => {
      const credentials = await passwordFields("demo1234");
      accountsByEmail.set("demo@fandou.local", {
        id: "demo-account-001",
        email: "demo@fandou.local",
        displayName: "周予安",
        personId: "demo-person-002",
        role: "member",
        ...credentials,
      });
    })();
  }
  await seedAccountPromise;
}

const publicUser = ({ passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...user }: DemoAccount): DemoSessionUser => user;

function createDemoSession(account: DemoAccount, now = Date.now()): DemoSession {
  const token = `demo_${crypto.randomUUID()}`;
  const expiresAt = now + SESSION_TTL_MS;
  sessionsByToken.set(token, { email: account.email, expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString(), user: publicUser(account) };
}

function currentAttempt(email: string, now: number) {
  const existing = loginAttemptsByEmail.get(email);
  if (!existing) return { failures: [], blockedUntil: 0 } satisfies LoginAttempt;
  existing.failures = existing.failures.filter((timestamp) => now - timestamp < LOGIN_WINDOW_MS);
  if (existing.blockedUntil <= now && existing.failures.length < MAX_LOGIN_FAILURES) existing.blockedUntil = 0;
  return existing;
}

export async function loginDemoAccount(email: string, password: string, now = Date.now()): Promise<DemoLoginResult> {
  await ensureSeedAccount();
  const normalizedEmail = normalizeEmail(email);
  const attempt = currentAttempt(normalizedEmail, now);
  if (attempt.blockedUntil > now) {
    return { status: "rate_limited", retryAfterSeconds: Math.ceil((attempt.blockedUntil - now) / 1000) };
  }

  const account = accountsByEmail.get(normalizedEmail);
  const passwordHash = account
    ? await derivePasswordHash(password, hexToBytes(account.passwordSalt))
    : await derivePasswordHash(password, new Uint8Array(16));
  if (!account || !hashesMatch(account.passwordHash, passwordHash)) {
    attempt.failures.push(now);
    if (attempt.failures.length >= MAX_LOGIN_FAILURES) attempt.blockedUntil = now + LOGIN_BLOCK_MS;
    loginAttemptsByEmail.set(normalizedEmail, attempt);
    if (attempt.blockedUntil > now) {
      return { status: "rate_limited", retryAfterSeconds: Math.ceil((attempt.blockedUntil - now) / 1000) };
    }
    return { status: "invalid" };
  }

  loginAttemptsByEmail.delete(normalizedEmail);
  return { status: "success", session: createDemoSession(account, now) };
}

export async function registerDemoAccount(displayName: string, email: string, password: string, personId: string, now = Date.now()) {
  await ensureSeedAccount();
  const normalizedEmail = normalizeEmail(email);
  if (accountsByEmail.has(normalizedEmail)) return null;
  const credentials = await passwordFields(password);
  if (accountsByEmail.has(normalizedEmail)) return null;
  const account: DemoAccount = {
    id: `demo-account-${String(nextAccountId++).padStart(3, "0")}`,
    email: normalizedEmail,
    displayName: displayName.trim(),
    personId,
    role: "member",
    ...credentials,
  };
  accountsByEmail.set(normalizedEmail, account);
  return createDemoSession(account, now);
}

export function getDemoSession(authorization: string | undefined, now = Date.now()) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const record = sessionsByToken.get(token);
  if (!record) return null;
  if (record.expiresAt <= now) {
    sessionsByToken.delete(token);
    return null;
  }
  const account = accountsByEmail.get(record.email);
  return account ? { token, expiresAt: new Date(record.expiresAt).toISOString(), user: publicUser(account) } : null;
}

export function deleteDemoSession(authorization: string | undefined) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return token ? sessionsByToken.delete(token) : false;
}
