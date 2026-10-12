export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_INPUT_PATTERN = /^[+\d\s()-]+$/;
export const PHONE_NORMALIZED_PATTERN = /^(?:1[3-9]\d{9}|\+[1-9]\d{6,14})$/;

export const normalizeEmail = (email: string) => email.trim().toLocaleLowerCase();

/** Keep formatted input comparable with identifiers already stored by the API. */
export function normalizePhone(phone: string) {
  const value = phone.trim().replace(/[\s()-]/g, "");
  if (value.startsWith("+86")) return value.slice(3);
  return value;
}

export function isValidEmail(email: string) {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && normalized.length <= 254 && EMAIL_PATTERN.test(normalized);
}

export function isValidPhone(phone: string) {
  const trimmed = phone.trim();
  return trimmed.length > 0
    && trimmed.length <= 30
    && PHONE_INPUT_PATTERN.test(trimmed)
    && PHONE_NORMALIZED_PATTERN.test(normalizePhone(trimmed));
}

export type AccountIdentifier = { kind: "email" | "phone"; normalized: string };

export function parseAccountIdentifier(identifier: string): AccountIdentifier | null {
  const trimmed = identifier.trim();
  if (isValidEmail(trimmed)) return { kind: "email", normalized: normalizeEmail(trimmed) };
  if (isValidPhone(trimmed)) return { kind: "phone", normalized: normalizePhone(trimmed) };
  return null;
}
