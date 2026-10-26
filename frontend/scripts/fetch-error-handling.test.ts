// Regression tests for lib/fetch.ts appFetch: JSON vs non-JSON error responses and the
// teacher live-classes GET/POST request shape.
// Run: node --test --experimental-strip-types scripts/fetch-error-handling.test.ts
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { appFetch, isApiError } from "../lib/fetch.ts"

type Captured = { url: string; init?: RequestInit }
const realFetch = globalThis.fetch
let calls: Captured[] = []

function stubFetch(response: Response) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return response.clone()
  }) as typeof fetch
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

test("GET list sends a relative /v1 path (so the Next rewrite applies) and returns data", async () => {
  stubFetch(
    new Response(JSON.stringify({ success: true, data: [{ id: "a" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  )
  const data = await appFetch<{ id: string }[]>("/v1/teachers/me/live-classes")
  assert.equal(calls[0].url, "/v1/teachers/me/live-classes")
  assert.equal(calls[0].init?.method, undefined) // GET is the default
  assert.deepEqual(data, [{ id: "a" }])
})

test("POST schedule sends method and JSON body to the same list path", async () => {
  stubFetch(
    new Response(JSON.stringify({ success: true, data: { id: "new-id" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  )
  const payload = { title: "Maths", accessLevel: "PUBLIC", durationMinutes: 60 }
  const result = await appFetch<{ id: string }>("/v1/teachers/me/live-classes", {
    method: "POST",
    body: JSON.stringify(payload),
  })
  assert.equal(calls[0].url, "/v1/teachers/me/live-classes")
  assert.equal(calls[0].init?.method, "POST")
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), payload)
  assert.equal(result.id, "new-id")
})

test("JSON 404 from the application keeps the server's own message and status", async () => {
  stubFetch(
    new Response(JSON.stringify({ success: false, error: "Teacher profile not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  )
  await assert.rejects(appFetch("/v1/teachers/me/live-classes"), (err: unknown) => {
    assert.ok(err instanceof Error)
    assert.equal(err.message, "Teacher profile not found")
    assert.equal(isApiError(err, 404), true)
    assert.equal((err as { nonJsonResponse?: boolean }).nonJsonResponse, false)
    return true
  })
})

test("non-JSON 404 (HTML edge page) is reported as a routing problem, not a generic failure", async () => {
  stubFetch(
    new Response("<html><body><h1>404 Not Found</h1></body></html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    }),
  )
  await assert.rejects(appFetch("/v1/teachers/me/live-classes", { method: "POST", body: "{}" }), (err: unknown) => {
    assert.ok(err instanceof Error)
    assert.equal(isApiError(err, 404), true)
    assert.equal((err as { nonJsonResponse?: boolean }).nonJsonResponse, true)
    assert.match(err.message, /HTTP 404 without a JSON error body/)
    assert.doesNotMatch(err.message, /<html|Not Found<\/h1>/)
    return true
  })
})

test("empty error body is treated as non-JSON, not as a successful empty list", async () => {
  stubFetch(new Response("", { status: 404 }))
  await assert.rejects(appFetch("/v1/teachers/me/live-classes"), (err: unknown) => {
    assert.equal(isApiError(err, 404), true)
    return true
  })
})

test("JSON error with neither error nor message falls back to the status-based message", async () => {
  stubFetch(
    new Response(JSON.stringify({ success: false }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  )
  await assert.rejects(appFetch("/v1/teachers/me/live-classes"), (err: unknown) => {
    assert.ok(err instanceof Error)
    assert.equal(err.message, "Request failed: 400")
    assert.equal((err as { nonJsonResponse?: boolean }).nonJsonResponse, false)
    return true
  })
})
