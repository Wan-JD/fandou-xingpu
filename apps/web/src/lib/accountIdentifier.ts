import { isValidEmail, isValidPhone, parseAccountIdentifier } from "@fandou-xingpu/shared";

export function isValidAccountIdentifier(value: string) {
  return parseAccountIdentifier(value) !== null;
}

export function validateAccountContacts(email: string, phone: string) {
  const trimmedEmail = email.trim();
  const trimmedPhone = phone.trim();
  if (!trimmedEmail && !trimmedPhone) return "请填写邮箱或手机号";
  if (trimmedEmail && !isValidEmail(trimmedEmail)) return "请输入有效的邮箱";
  if (trimmedPhone && !isValidPhone(trimmedPhone)) return "请输入有效的手机号";
  return "";
}
