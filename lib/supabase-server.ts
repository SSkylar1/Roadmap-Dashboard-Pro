export type PostgrestErrorLike = { code?: string | null; message?: string | null } | null;

type SupabaseResponse<T> = { data: T | null; error: PostgrestErrorLike };

type RequestOptions = RequestInit & { query?: Record<string, string> };

let cachedBaseUrl: string | null = null;
let cachedKey: string | null = null;

function getBaseUrl(): string {
  if (cachedBaseUrl) {
    return cachedBaseUrl;
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("Missing SUPABASE_URL env var");
  }
  cachedBaseUrl = url.replace(/\/$/, "");
  return cachedBaseUrl;
}

function getServiceRoleKey(): string {
  if (cachedKey) {
    return cachedKey;
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  }
  cachedKey = key;
  return key;
}

function buildHeaders(init?: HeadersInit): HeadersInit {
  return {
    apikey: getServiceRoleKey(),
    Authorization: `Bearer ${getServiceRoleKey()}`,
    "Content-Type": "application/json",
    ...init,
  };
}

async function request<T>(path: string, init: RequestOptions): Promise<SupabaseResponse<T>> {
  const baseUrl = getBaseUrl();
  const query = init.query ? new URLSearchParams(init.query) : null;
  const url = `${baseUrl.replace(/\/$/, "")}/rest/v1${path}${query ? `?${query.toString()}` : ""}`;
  const { query: _ignored, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: buildHeaders(init.headers as HeadersInit),
  });

  if (response.status === 204) {
    return { data: null, error: null };
  }

  const text = await response.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = text;
    }
  }

  if (!response.ok) {
    const parsedCode = (parsed as { code?: string })?.code;
    const error: PostgrestErrorLike = {
      code: parsedCode ?? response.status.toString(),
      message: (parsed as { message?: string })?.message ?? response.statusText,
    };
    return { data: null, error };
  }

  return { data: parsed as T, error: null };
}

export async function supabaseSelect<T>(
  table: string,
  columns: string,
  filters?: Record<string, string>,
): Promise<SupabaseResponse<T[]>> {
  return request<T[]>(`/${table}`, {
    method: "GET",
    query: { ...(filters ?? {}), select: columns },
  });
}

export async function supabaseUpsert<T>(
  table: string,
  rows: unknown[],
  { returnRepresentation = false }: { returnRepresentation?: boolean } = {},
): Promise<SupabaseResponse<T[]>> {
  return request<T[]>(`/${table}`, {
    method: "POST",
    body: JSON.stringify(rows),
    headers: {
      Prefer: `${returnRepresentation ? "return=representation" : "return=minimal"},resolution=merge-duplicates`,
    },
  });
}

export async function supabaseDelete(
  table: string,
  filter: Record<string, string>,
): Promise<SupabaseResponse<null>> {
  return request<null>(`/${table}`, {
    method: "DELETE",
    query: filter,
    headers: {
      Prefer: "return=minimal",
    },
  });
}
