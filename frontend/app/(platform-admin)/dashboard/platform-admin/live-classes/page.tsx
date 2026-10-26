"use client"

import { useTranslations } from "next-intl";

import { useEffect, useState, useCallback } from "react"
import { Video, Loader2, Clock, Users } from "lucide-react"
import { platformAdminApi, type LiveClassSummary, type PageResponse } from "@/lib/platform-admin-api"
import { formatDateTime as fmtDateTime } from "@/lib/format-date"
import { useLocale } from "@/hooks/use-locale"
import { LiveClassReviewQueue } from "@/components/platform-admin/live-class-review-queue"

const STATUS_OPTIONS = ["", "SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"]
const PAGE_SIZE = 20

export default function LiveClassesMonitorPage() {
  const t = useTranslations("platformAdmin");
  const tc = useTranslations("common");
  const ts = useTranslations("status");
  const locale = useLocale()
  const [data, setData] = useState<PageResponse<LiveClassSummary> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState("")

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await platformAdminApi.listLiveClasses(page, PAGE_SIZE, status || undefined)
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("liveClasses.failedToLoadLive"))
    } finally {
      setLoading(false)
    }
  }, [page, status])

  useEffect(() => {
    loadData()
  }, [loadData])

  const getStatusBadge = (s: string) => {
    switch (s) {
      case "LIVE":
        return <span className="inline-block rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600">LIVE</span>
      case "SCHEDULED":
        return <span className="inline-block rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600">SCHEDULED</span>
      case "COMPLETED":
        return <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">COMPLETED</span>
      case "CANCELLED":
        return <span className="inline-block rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-600">CANCELLED</span>
      default:
        return <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{s}</span>
    }
  }

  const formatDate = (d: string) => fmtDateTime(d, locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("liveClasses.liveClassesMonitor")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("liveClasses.monitorAllLiveClasses")}</p>
      </div>

      <LiveClassReviewQueue />

      <div className="flex items-center gap-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0) }}
          className="rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s || t("liveClasses.allStatuses")}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-6 py-4 text-sm text-destructive">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.content.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 py-20 text-center">
          <Video className="size-10 text-muted-foreground/50" />
          <p className="mt-4 text-sm font-medium text-foreground">{t("liveClasses.noLiveClassesFound")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {status ? t("liveClasses.noClassesMatchThe") : t("liveClasses.noLiveClassesAvailable")}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">{t("liveClasses.title")}</th>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">{t("liveClasses.status")}</th>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">{ts("scheduled")}</th>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">{t("liveClasses.duration")}</th>
                  <th className="px-5 py-3 text-left font-medium text-muted-foreground">{t("liveClasses.participants")}</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((cls) => (
                  <tr key={cls.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-foreground">{cls.title}</td>
                    <td className="px-5 py-3.5">{getStatusBadge(cls.status)}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Clock className="size-3.5" />
                        {formatDate(cls.scheduledAt)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{t("liveClasses.min", { p0: cls.durationMinutes })}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Users className="size-3.5" />
                        {cls.currentParticipants}/{cls.maxParticipants}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && data.totalElements > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {t("liveClasses.prev")}</button>
          <span className="text-sm text-muted-foreground">
            {t("liveClasses.pageOf", { p0: page + 1, p1: data.totalPages })}</span>
          <button
            onClick={() => setPage((p) => Math.min(data.totalPages - 1, p + 1))}
            disabled={page >= data.totalPages - 1}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {tc("next")}</button>
        </div>
      )}
    </div>
  )
}
