"use client"

import { useTranslations } from "next-intl"
import { useCallback, useEffect, useState } from "react"
import { Loader2, ShieldCheck } from "lucide-react"
import {
  platformAdminApi,
  type LiveClassGovernanceRecord,
  type PageResponse,
} from "@/lib/platform-admin-api"
import { formatDateTime as fmtDateTime } from "@/lib/format-date"
import { useLocale } from "@/hooks/use-locale"

const FILTER_OPTIONS = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "PUBLISHED", "DRAFT", ""]
const PAGE_SIZE = 20

/**
 * Platform Admin review queue for live classes.
 *
 * Every action calls the existing governance endpoints. The backend decides what is allowed
 * (ADMIN role, pending-state checks, reject-needs-note, publish-needs-PUBLIC); this component
 * only offers the actions and shows the server's answer.
 */
export function LiveClassReviewQueue() {
  const t = useTranslations("platformAdmin")
  const tc = useTranslations("common")
  const locale = useLocale()
  const [filter, setFilter] = useState("PENDING_APPROVAL")
  const [page, setPage] = useState(0)
  const [data, setData] = useState<PageResponse<LiveClassGovernanceRecord> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState("")

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setData(await platformAdminApi.listLiveClassReviews(page, PAGE_SIZE, filter || undefined))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("liveClasses.failedToLoadLive"))
    } finally {
      setLoading(false)
    }
  }, [page, filter, t])

  useEffect(() => {
    load()
  }, [load])

  async function run(id: string, action: () => Promise<unknown>, doneText: string) {
    try {
      setBusyId(id)
      setError(null)
      setMessage(null)
      await action()
      setMessage(doneText)
      setRejectingId(null)
      setRejectNote("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("liveClasses.failedToLoadLive"))
    } finally {
      setBusyId(null)
    }
  }

  const formatDate = (d: string | null) =>
    d ? fmtDateTime(d, locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <ShieldCheck className="size-5 text-muted-foreground" />
            {t("liveClasses.reviewQueue.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("liveClasses.reviewQueue.hint")}</p>
        </div>
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0) }}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {FILTER_OPTIONS.map((s) => (
            <option key={s} value={s}>{s || t("liveClasses.allStatuses")}</option>
          ))}
        </select>
      </div>

      {message && (
        <div className="rounded-lg border border-green-600/20 bg-green-600/5 px-4 py-2 text-sm text-green-700">{message}</div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.content.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("liveClasses.reviewQueue.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.content.map((cls) => {
            const busy = busyId === cls.id
            return (
              <li key={cls.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">{cls.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {cls.publicationStatus} · {cls.accessLevel ?? "—"} · {formatDate(cls.submittedForReviewAt ?? cls.scheduledAt)}
                    </p>
                    {cls.reviewNote && (
                      <p className="mt-1 text-xs text-muted-foreground">{t("liveClasses.reviewQueue.lastNote", { p0: cls.reviewNote })}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {cls.publicationStatus === "PENDING_APPROVAL" && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => run(cls.id, () => platformAdminApi.approveLiveClass(cls.id), t("liveClasses.reviewQueue.approved"))}
                          className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {t("liveClasses.reviewQueue.approve")}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => { setRejectingId(cls.id); setRejectNote("") }}
                          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                        >
                          {t("liveClasses.reviewQueue.reject")}
                        </button>
                      </>
                    )}
                    {cls.publicationStatus === "APPROVED" && cls.accessLevel === "PUBLIC" && (
                      <button
                        disabled={busy}
                        onClick={() => run(cls.id, () => platformAdminApi.publishLiveClass(cls.id), t("liveClasses.reviewQueue.published"))}
                        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {t("liveClasses.reviewQueue.publish")}
                      </button>
                    )}
                    {cls.publicationStatus === "APPROVED" && cls.accessLevel !== "PUBLIC" && (
                      <span className="text-xs text-muted-foreground">{t("liveClasses.reviewQueue.notPublicHint")}</span>
                    )}
                    {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  </div>
                </div>

                {rejectingId === cls.id && (
                  <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                    <label className="text-xs font-medium text-muted-foreground" htmlFor={`reject-${cls.id}`}>
                      {t("liveClasses.reviewQueue.rejectNoteLabel")}
                    </label>
                    <textarea
                      id={`reject-${cls.id}`}
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={busy || !rejectNote.trim()}
                        onClick={() => run(cls.id, () => platformAdminApi.rejectLiveClass(cls.id, rejectNote.trim()), t("liveClasses.reviewQueue.rejected"))}
                        className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {t("liveClasses.reviewQueue.confirmReject")}
                      </button>
                      <button
                        onClick={() => setRejectingId(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                      >
                        {tc("cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {data && data.totalElements > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {t("liveClasses.prev")}
          </button>
          <span className="text-sm text-muted-foreground">{t("liveClasses.pageOf", { p0: page + 1, p1: data.totalPages })}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.totalPages - 1, p + 1))}
            disabled={page >= data.totalPages - 1}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {tc("next")}
          </button>
        </div>
      )}
    </section>
  )
}
