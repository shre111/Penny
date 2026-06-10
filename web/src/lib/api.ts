export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { json, ...rest } = options
  const res = await fetch(path, {
    credentials: 'include',
    headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    ...rest,
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status)
  }
  return data as T
}
