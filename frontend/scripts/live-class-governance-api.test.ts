// Regression tests for the Platform Admin live-class governance client (lib/platform-admin-api.ts).
// Pins the exact paths and methods the backend LiveClassGovernanceController exposes.
// Run: node --test --experimental-strip-types scripts/live-class-governance-api.test.ts
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { platformAdminApi } from "../lib/platform-admin-api.ts"

type Captured = { url: string; init?: RequestInit }
const realFetch = globalThis.fetch
let calls: Captured[] = []

function stubJson(body: unknown, status = 200) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ success: true, data: body }), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  globalThis.fetch = realFetch
})

test("queue lists the governance endpoint filtered by publicationStatus", async () => {
  stubJson({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0, first: true, last: true })
  await platformAdminApi.listLiveClassReviews(0, 20, "PENDING_APPROVAL")
  assert.match(new URL(calls[0].url).pathname, /^\/v1\/platform-admin\/live-classes\/governance$/)
  const params = new URL(calls[0].url).searchParams
  assert.equal(params.get("publicationStatus"), "PENDING_APPROVAL")
  assert.equal(params.get("page"), "0")
  assert.equal(params.get("size"), "20")
  assert.equal(calls[0].init?.method, undefined) // GET
})

test("queue omits publicationStatus when showing all statuses", async () => {
  stubJson({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0, first: true, last: true })
  await platformAdminApi.listLiveClassReviews(0, 20)
  assert.equal(new URL(calls[0].url).searchParams.has("publicationStatus"), false)
})

test("approve POSTs to /approve with a note body", async () => {
  stubJson({ id: "c1", publicationStatus: "APPROVED" })
  await platformAdminApi.approveLiveClass("c1", "Looks good")
  assert.equal(new URL(calls[0].url).pathname, "/v1/platform-admin/live-classes/governance/c1/approve")
  assert.equal(calls[0].init?.method, "POST")
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { note: "Looks good" })
})

test("approve without a note sends note: null (backend accepts an optional body)", async () => {
  stubJson({ id: "c1", publicationStatus: "APPROVED" })
  await platformAdminApi.approveLiveClass("c1")
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { note: null })
})

test("reject POSTs to /reject and carries the reason the teacher will see", async () => {
  stubJson({ id: "c2", publicationStatus: "REJECTED" })
  await platformAdminApi.rejectLiveClass("c2", "Add the lesson outline")
  assert.equal(new URL(calls[0].url).pathname, "/v1/platform-admin/live-classes/governance/c2/reject")
  assert.equal(calls[0].init?.method, "POST")
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { note: "Add the lesson outline" })
})

test("publish POSTs to /publish with no body", async () => {
  stubJson({ id: "c3", publicationStatus: "PUBLISHED" })
  await platformAdminApi.publishLiveClass("c3")
  assert.equal(new URL(calls[0].url).pathname, "/v1/platform-admin/live-classes/governance/c3/publish")
  assert.equal(calls[0].init?.method, "POST")
  assert.equal(calls[0].init?.body, undefined)
})

test("a refused action surfaces the server's message", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ success: false, error: "A rejection needs a note explaining why" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch
  await assert.rejects(platformAdminApi.rejectLiveClass("c2", ""), (err: unknown) => {
    assert.ok(err instanceof Error)
    assert.equal(err.message, "API 400: A rejection needs a note explaining why")
    return true
  })
})
