import { env } from "../env";

function getBaseUrl(): string {
  return env.VITE_API_URL === "http://localhost:4000" ? "" : env.VITE_API_URL;
}

function extractError(data: any, status: number): string {
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.error === "object") return JSON.stringify(data.error);
  if (typeof data?.message === "string") return data.message;
  return `HTTP ${status}`;
}

function getHeaders(
  extra?: Record<string, string>,
  skipAuth?: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  if (!skipAuth) {
    headers["X-API-Key"] = env.VITE_API_KEY;
  }
  return headers;
}

export async function getJson<T = unknown>(endpoint: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    headers: getHeaders(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return data as T;
}

export async function getBlob(endpoint: string): Promise<Blob> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    headers: { "X-API-Key": env.VITE_API_KEY },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return res.blob();
}

export async function postJson<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  options?: { headers?: Record<string, string>; skipAuth?: boolean },
): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: getHeaders(options?.headers, options?.skipAuth),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return data as T;
}

export async function putJson<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return data as T;
}

export async function patchJson<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return data as T;
}

export async function deleteJson<T = unknown>(endpoint: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return data as T;
}

export async function postFormData<T = unknown>(
  endpoint: string,
  formData: FormData,
): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: { "X-API-Key": env.VITE_API_KEY },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return data as T;
}

export async function postJsonRaw(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }));
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return res;
}

export async function postFormDataRaw(
  endpoint: string,
  formData: FormData,
): Promise<Response> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: { "X-API-Key": env.VITE_API_KEY },
    body: formData,
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }));
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return res;
}

export async function postSse(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const res = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }));
    throw Object.assign(new Error(extractError(data, res.status)), {
      status: res.status,
      data,
    });
  }
  return res;
}
