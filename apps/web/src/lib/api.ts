// Thin fetch wrapper: Bearer session header, JSON bodies and readable error messages.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiErrorMessage(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? fallback;
}

export function authHeaders(token: string | null | undefined): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type RequestOptions = { token?: string | null; method?: string; json?: unknown; form?: FormData; fallback?: string };

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders(options.token) };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(options.json); }
  const response = await fetch(path, { method: options.method ?? (body ? "POST" : "GET"), headers, body });
  if (response.status === 204) return null as T;
  const payload = await response.json().catch(() => null) as { data?: T; error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new ApiError(response.status, payload?.error?.code ?? "REQUEST_FAILED", payload?.error?.message ?? options.fallback ?? "请求失败，请稍后重试");
  return payload?.data as T;
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

/**
 * Member-only files cannot be linked directly because the session lives in a header,
 * so they are fetched, turned into a short-lived blob URL and opened or downloaded.
 */
export async function openProtectedFile(id: string, name: string, token: string | null | undefined, download = false) {
  const popup = download ? null : window.open("", "_blank");
  try {
    const response = await fetch(`/api/attachments/${encodeURIComponent(id)}`, { headers: authHeaders(token) });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "附件暂时无法读取"));
    const objectUrl = URL.createObjectURL(await response.blob());
    if (popup) popup.location.href = objectUrl;
    else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = name;
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (cause) {
    popup?.close();
    throw cause;
  }
}
