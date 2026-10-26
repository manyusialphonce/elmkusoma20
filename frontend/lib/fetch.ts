function getStoredUser(): { institutionId?: string } | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem("elmkusoma_current_user")
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * The thrown Error carries the HTTP status so callers can distinguish cases that share a
 * message shape - most importantly a 404 ("this article does not exist", a real state to render)
 * from a 500 ("something broke", an error to report). Before this was added the status was lost
 * whenever the body had an `error` field, because `body.error` replaced it entirely.
 */
export interface ApiError extends Error {
  status: number
}

export function isApiError(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === status
  )
}

export async function appFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("elmkusoma_access_token") : null
  const user = getStoredUser()
  const institutionId = user?.institutionId
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      // Institution context is OPTIONAL: an independent teacher/learner has no school and
      // must never be sent a fabricated one (the old hardcoded HQ fallback made their
      // requests look school-affiliated). Without the header the server resolves context
      // from the account's own membership instead.
      ...(institutionId ? { "X-Institution-Id": institutionId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (!res.ok) {
    // Read as text first: a 404/502 from the edge (Vercel rewrite target or Render) is usually
    // an HTML page, not the application's JSON error envelope. Telling those apart matters.
    const text = await res.text().catch(() => "")
    let body: { error?: unknown; message?: unknown } | null = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    const serverMessage =
      body && (typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : null)
    const message =
      serverMessage ||
      (body === null
        ? `The server returned HTTP ${res.status} without a JSON error body. The API route may be unreachable or misconfigured.`
        : `Request failed: ${res.status}`)
    throw Object.assign(new Error(message), {
      status: res.status,
      nonJsonResponse: body === null,
    })
  }
  const json = await res.json()
  return json.data ?? json
}
