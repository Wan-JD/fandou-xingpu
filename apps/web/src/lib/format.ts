// Date and text helpers for profile pages.
const parseDate = (value: string) => new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}Z` : value);

export function relativeTime(value: string, now = Date.now()) {
  const date = parseDate(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86_400 * 7) return `${Math.floor(seconds / 86_400)} 天前`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("zh-CN", sameYear ? { month: "long", day: "numeric" } : { year: "numeric", month: "long", day: "numeric" });
}

export function fullTime(value: string) {
  const date = parseDate(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

/** Renders `2024`, `2024-05` or `2024-05-20` the way the member entered it. */
export function occurredLabel(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (day) return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
  if (month) return `${year} 年 ${Number(month)} 月`;
  return `${year} 年`;
}

export function fileSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type TextToken = { text: string; href?: string };

/** Splits plain text into text and http(s) link tokens so templates never need v-html. */
export function linkify(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  const pattern = /https?:\/\/[^\s<>"'，。！？、）)\]]+/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ text: text.slice(cursor, index) });
    tokens.push({ text: match[0], href: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor) });
  return tokens;
}

/** Small deterministic PRNG so every member gets a stable personal constellation. */
export function seededRandom(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  };
}
