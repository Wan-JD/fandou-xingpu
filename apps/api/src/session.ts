export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  personId: string;
  role: "member" | "admin";
}

export type Session = {
  token: string;
  expiresAt: string;
  user: SessionUser;
};

export type LoginResult =
  | { status: "success"; session: Session }
  | { status: "invalid" }
  | { status: "rate_limited"; retryAfterSeconds: number };

const PASSWORD_ITERATIONS = 120_000;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
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
