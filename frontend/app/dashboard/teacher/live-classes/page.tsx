"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAuth } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Video, Plus, Clock, Users, XCircle, Loader2, AlertCircle, Calendar, Edit, Trash2, Play, Square, ExternalLink, BookOpen, GraduationCap, CheckCircle2, Circle, ListOrdered } from "lucide-react"
import { appFetch } from "@/lib/fetch"

interface LiveClass {
  id: string
  title: string
  description: string
  scheduledAt: string
  /** Actual start (server clock); null until the teacher starts. Not client-settable. */
  startedAt?: string | null
  durationMinutes: number
  maxParticipants: number
  status: string
  subjectName: string | null
  teacherName: string | null
  classGroupId: string | null
  subjectId: string | null
  /** Declared audience: PUBLIC = open learning session (published), otherwise school-scoped. */
  accessLevel?: string
  /** Editorial state (DRAFT/PENDING_APPROVAL/APPROVED/PUBLISHED/...). */
  publicationStatus?: string
  /** Platform Admin note; shown to the teacher when a class is rejected. */
  reviewNote?: string | null
  createdAt: string
  recordingEnabled: boolean | null
  recordingUrl: string | null
  currentParticipants: number | null
  sessionType: string | null
  lessonId: string | null
  lessonTitle: string | null
}

const PUBLICATION_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "PUBLISHED", "REJECTED"]

interface ClassOption {
  classGroupId: string
  className: string
  subjectName: string
  subjectId?: string
}

interface SubjectOption {
  id: string
  name: string
  code: string
}

const initialForm = {
  title: "",
  description: "",
  scheduledAt: "",
  durationMinutes: 60,
  maxParticipants: 50,
  /**
   * Explicit audience choice (requirement C). "school" is the behaviour-preserving
   * default (institution-scoped, no class); "class" makes the class select required;
   * "open" is the PUBLIC + no-class combination the server treats as an open learning
   * session. Never derived silently from the class select — the choice is always shown.
   */
  audience: "school",
  classGroupId: "",
  subjectId: "",
  enableRecording: false,
  sessionType: "LECTURE",
  broadcastSource: "BROWSER",
  timezone: "Africa/Dar_es_Salaam",
  isRecurring: false,
  recurrencePattern: "",
  recurrenceEndDate: "",
  lobbyEnabled: false,
  lessonId: "",
}

export default function TeacherLiveClassesPage() {
  const { user } = useAuth()
  const router = useRouter()
  const t = useTranslations("teacher")
  const tn = useTranslations("nav")
  const tc = useTranslations("common")
  const ts = useTranslations("status")
  const [liveClasses, setLiveClasses] = useState<LiveClass[]>([])
  const [classes, setClasses] = useState<ClassOption[]>([])

  /** Grace window for "now" scheduling; mirrors the backend's 1-minute allowance. */
  const SCHEDULE_PAST_GRACE_MS = 60_000
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [lessonOptions, setLessonOptions] = useState<{ id: string; title: string }[]>([])

  const statusConfig: Record<string, { label: string; className: string }> = {
    SCHEDULED: { label: ts("scheduled"), className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    STARTING: { label: t("liveClassDetail.statusStarting"), className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    IN_PROGRESS: { label: t("liveClassDetail.statusLive"), className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    LIVE: { label: t("liveClassDetail.statusLive"), className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    ENDING: { label: t("liveClassDetail.statusEnding"), className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    COMPLETED: { label: ts("completed"), className: "bg-gray-100 text-gray-700 dark:bg-gray-800/30 dark:text-gray-400" },
    ENDED: { label: t("liveClassDetail.statusEnded"), className: "bg-gray-100 text-gray-700 dark:bg-gray-800/30 dark:text-gray-400" },
    CANCELLED: { label: ts("cancelled"), className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    SERVICE_DEGRADED: { label: t("liveClasses.statusDegraded"), className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    SERVICE_UNAVAILABLE: { label: t("liveClasses.statusUnavailable"), className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
    RECOVERING: { label: t("liveClasses.statusRecovering"), className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  }

  const sessionTypeOptions = [
    { value: "LECTURE", label: t("liveClasses.sessionLecture") },
    { value: "TUTORIAL", label: t("liveClasses.sessionTutorial") },
    { value: "WORKSHOP", label: t("liveClasses.sessionWorkshop") },
    { value: "SEMINAR", label: t("liveClasses.sessionSeminar") },
    { value: "LAB_DEMO", label: t("liveClasses.sessionLabDemo") },
    { value: "COMPETENCY_ASSESSMENT", label: t("liveClasses.sessionCompetency") },
    { value: "WEBINAR", label: t("liveClasses.sessionWebinar") },
    { value: "GUEST_SPEAKER", label: t("liveClasses.sessionGuest") },
    { value: "RESEARCH_PRESENTATION", label: t("liveClasses.sessionResearch") },
    { value: "PROJECT_DEFENSE", label: t("liveClasses.sessionDefense") },
    { value: "CONFERENCE", label: t("liveClasses.sessionConference") },
    { value: "PROFESSIONAL_TRAINING", label: t("liveClasses.sessionTraining") },
    { value: "CAREER_EVENT", label: t("liveClasses.sessionCareer") },
    { value: "INSTITUTION_EVENT", label: t("liveClasses.sessionInstitution") },
  ]

  useEffect(() => {
    if (!user) return
    loadData()
    // An account without a school cannot have a school audience: fall back to the only
    // honest choice (open learning) instead of offering an institution that does not exist.
    if (!user.institutionId && form.audience === "school" && !editingId) {
      setForm((f) => ({ ...f, audience: "open" }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Lesson ↔ Live Class: lesson choices for the class picked in the create/edit form
  useEffect(() => {
    if (!showForm || !form.classGroupId) {
      setLessonOptions([])
      return
    }
    let cancelled = false
    appFetch<{ id: string; title: string }[]>(`/v1/learning/lessons/class/${form.classGroupId}`)
      .then((data) => { if (!cancelled) setLessonOptions(Array.isArray(data) ? data : []) })
      .catch(() => { if (!cancelled) setLessonOptions([]) })
    return () => { cancelled = true }
  }, [form.classGroupId, showForm])

  async function loadData() {
    try {
      setLoading(true)
      setError(null)
      const [liveClassesData, classesData] = await Promise.allSettled([
        appFetch<LiveClass[]>("/v1/teachers/me/live-classes"),
        appFetch<ClassOption[]>("/v1/teachers/me/classes"),
      ])
      if (liveClassesData.status === "fulfilled") {
        setLiveClasses(liveClassesData.value)
      } else {
        setError(t("liveClasses.loadError"))
      }
      if (classesData.status === "fulfilled") {
        // /v1/teachers/me/classes can return the same class group more than once
        // (one row per taught subject). The selector keys options by classGroupId,
        // so duplicates produced "Encountered two children with the same key" and
        // could mis-render the option. Keep the first row per class group.
        const uniqueClasses = new Map<string, ClassOption>()
        for (const c of classesData.value) {
          if (c.classGroupId && !uniqueClasses.has(c.classGroupId)) {
            uniqueClasses.set(c.classGroupId, c)
          }
        }
        setClasses([...uniqueClasses.values()])
        const uniqueSubjects = new Map<string, SubjectOption>()
        classesData.value.forEach((c) => {
          if (c.subjectId && c.subjectName) {
            uniqueSubjects.set(c.subjectId, {
              id: c.subjectId,
              name: c.subjectName,
              code: c.subjectName,
            })
          }
        })
        setSubjects(Array.from(uniqueSubjects.values()))
      }
    } catch {
      setError(tc("error.load"))
    } finally {
      setLoading(false)
    }
  }

  function resetForm() {
    setForm(initialForm)
    setEditingId(null)
    setShowForm(false)
    setReviewMode(false)
  }

  function startEdit(lc: any) {
    setForm({
      title: lc.title,
      description: lc.description || "",
      // Keep the stored wall-clock time as-is (server LocalDateTime is local time,
      // UTC+3) — toISOString() used to shift the value 3 hours in the edit field.
      scheduledAt: lc.scheduledAt ? String(lc.scheduledAt).replace(" ", "T").slice(0, 16) : "",
      durationMinutes: lc.durationMinutes,
      maxParticipants: lc.maxParticipants || 50,
      classGroupId: lc.classGroupId || "",
      audience: lc.classGroupId ? "class" : lc.accessLevel === "PUBLIC" ? "open" : "school",
      subjectId: lc.subjectId || "",
      enableRecording: lc.recordingEnabled || false,
      sessionType: lc.sessionType || "LECTURE",
      broadcastSource: lc.broadcastSource || "BROWSER",
      timezone: lc.timezone || "Africa/Dar_es_Salaam",
      isRecurring: lc.isRecurring || false,
      recurrencePattern: lc.recurrencePattern || "",
      recurrenceEndDate: lc.recurrenceEndDate || "",
      lobbyEnabled: lc.lobbyEnabled || false,
      lessonId: lc.lessonId || "",
    })
    setEditingId(lc.id)
    setShowForm(true)
  }

  function handleProceedToReview() {
    if (!form.title.trim() || !form.scheduledAt) {
      setError(t("liveClasses.requiredError"))
      return
    }
    // The class audience must actually name a class: without this check a "class"
    // choice with no class would quietly become a classless (school-wide) session.
    if (form.audience === "class" && !form.classGroupId) {
      setError(t("liveClasses.audienceClassRequired"))
      return
    }
    const scheduledDate = new Date(form.scheduledAt)
    // Matches the backend grace window: browser and server clocks differ by a few
    // seconds, so a class picked for "now" is already a second or two in the past
    // by the time the request is sent. One minute is allowed (SCHEDULE_PAST_GRACE_MINUTES).
    if (scheduledDate.getTime() < Date.now() - SCHEDULE_PAST_GRACE_MS) {
      setError(t("liveClasses.futureError"))
      return
    }
    setError(null)
    setReviewMode(true)
  }

  async function handleSubmit() {
    try {
      setSubmitting(true)
      setError(null)
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
        // Send the wall-clock time exactly as picked. The backend parses it as a
        // plain LocalDateTime compared against server-local now() (UTC+3).
        // toISOString() converted to UTC, shifting the value 3 hours into the past,
        // so scheduling "today, in 5 minutes" failed with
        // "Scheduled time must be in the future".
        scheduledAt: form.scheduledAt.length === 16 ? `${form.scheduledAt}:00` : form.scheduledAt.slice(0, 19),
        durationMinutes: Number(form.durationMinutes) || 60,
        maxParticipants: Number(form.maxParticipants) || 50,
        recordingEnabled: form.enableRecording,
        broadcastSource: form.broadcastSource,
        timezone: form.timezone,
        isRecurring: form.isRecurring,
        lobbyEnabled: form.lobbyEnabled,
      }
      // Audience is explicit and is the only thing that decides scope: PUBLIC + no class
      // is the open learning session; INSTITUTION (with or without a class) stays inside
      // the school. On edit, dropping the class must be stated (clearClassGroupId) — the
      // server treats an absent classGroupId as "leave unchanged".
      if (form.audience === "open") {
        payload.accessLevel = "PUBLIC"
        if (editingId) payload.clearClassGroupId = true
      } else if (form.audience === "school") {
        payload.accessLevel = "INSTITUTION"
        if (editingId) payload.clearClassGroupId = true
      } else {
        payload.accessLevel = "INSTITUTION"
        payload.classGroupId = form.classGroupId
      }
        if (form.subjectId) payload.subjectId = form.subjectId
        if (form.lessonId) payload.lessonId = form.lessonId
        if (form.sessionType) payload.sessionType = form.sessionType
        if (form.isRecurring && form.recurrencePattern) payload.recurrencePattern = form.recurrencePattern
        if (form.isRecurring && form.recurrenceEndDate) payload.recurrenceEndDate = form.recurrenceEndDate

      if (editingId) {
        await appFetch(`/v1/teachers/me/live-classes/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
        setSuccess(t("liveClasses.updatedSuccess"))
        resetForm()
        loadData()
        setTimeout(() => setSuccess(null), 3000)
      } else {
        const result = await appFetch<{ id: string }>("/v1/teachers/me/live-classes", {
          method: "POST",
          body: JSON.stringify(payload),
        })
        resetForm()
        loadData()
        router.push(`/dashboard/teacher/live-classes/${result.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("liveClasses.saveError"))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(id: string) {
    if (!confirm(t("liveClasses.cancelConfirm"))) return
    try {
      setError(null)
      await appFetch(`/v1/teachers/me/live-classes/${id}`, { method: "DELETE" })
      setSuccess(t("liveClassDetail.cancelledSuccess"))
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("liveClasses.cancelError"))
    }
  }

  async function handleSubmitForReview(id: string) {
    try {
      setError(null)
      await appFetch(`/v1/teachers/me/live-classes/${id}/submit-for-approval`, { method: "POST" })
      setSuccess(t("liveClasses.submittedForReview"))
      setTimeout(() => setSuccess(null), 3000)
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("liveClasses.submitError"))
    }
  }

  async function handleStartLive(id: string) {
    try {
      setError(null)
      await appFetch(`/v1/teachers/me/live-classes/${id}/start`, { method: "POST" })
      setSuccess(t("liveClassDetail.startedSuccess"))
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("liveClassDetail.startError"))
    }
  }

  async function handleEndLive(id: string) {
    if (!confirm(t("liveClassDetail.endConfirm"))) return
    try {
      setError(null)
      await appFetch(`/v1/teachers/me/live-classes/${id}/end`, { method: "POST" })
      setSuccess(t("liveClassDetail.endedSuccess"))
      loadData()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("liveClassDetail.endError"))
    }
  }

  function formatDate(iso: string) {
    if (!iso) return "—"
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  function getClassName(classGroupId: string | null) {
    if (!classGroupId) return null
    const found = classes.find((c) => c.classGroupId === classGroupId)
    return found?.className || null
  }

  const sortedClasses = [...liveClasses].sort((a, b) => {
    const dateA = new Date(a.scheduledAt).getTime()
    const dateB = new Date(b.scheduledAt).getTime()
    return dateB - dateA
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{tn("liveClasses")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("liveClasses.subtitle")}</p>
        </div>
        <Button
          className="gap-2"
          onClick={() => {
            resetForm()
            setShowForm(!showForm)
          }}
        >
          {showForm ? <XCircle className="size-4" /> : <Plus className="size-4" />}
          {showForm ? tc("cancel") : t("liveClasses.scheduleClass")}
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </div>
        </div>
      )}

      {success && (
        <div className="rounded-2xl border border-green-500/20 bg-green-500/5 p-4">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <Video className="size-4 shrink-0" />
            {success}
          </div>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
          <h2 className="text-base font-semibold text-foreground">
            {editingId ? t("liveClasses.editTitle") : t("liveClasses.scheduleTitle")}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("liveClasses.sessionTypeLabel")}</label>
              <select
                value={form.sessionType}
                onChange={(e) => setForm({ ...form, sessionType: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              >
                {sessionTypeOptions.map((st) => (
                  <option key={st.value} value={st.value}>{st.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("liveClasses.broadcastSourceLabel")}</label>
              <select
                value={form.broadcastSource}
                onChange={(e) => setForm({ ...form, broadcastSource: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              >
                {(
                  [
                    "BROWSER",
                    "MOBILE",
                    "USB_CAMERA",
                    "PROFESSIONAL_CAMERA",
                    "OBS",
                    "ENCODER",
                    "STUDIO",
                    "OTHER",
                  ] as const
                ).map((src) => (
                  <option key={src} value={src}>{t(`livePrepare.source.${src}`)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{t("liveClasses.broadcastSourceHint")}</p>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("announcements.titleLabel")}</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={t("liveClasses.titlePlaceholder")}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                <Users className="mr-1 inline size-3" />
                {t("liveClasses.audienceLabel")}
              </label>
              <select
                value={form.audience}
                onChange={(e) =>
                  setForm({
                    ...form,
                    audience: e.target.value,
                    // Leaving the class audience drops its dependent class + lesson picks
                    // so the payload can never carry a stale class scope.
                    ...(e.target.value !== "class" ? { classGroupId: "", lessonId: "" } : {}),
                  })
                }
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              >
                <option value="school" disabled={!user?.institutionId}>
                  {t("liveClasses.audienceSchool")}
                </option>
                <option value="class" disabled={classes.length === 0}>
                  {t("liveClasses.audienceClass")}
                </option>
                <option value="open">{t("liveClasses.audienceOpen")}</option>
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {!user?.institutionId
                  ? t("liveClasses.audienceNoSchool")
                  : form.audience === "open"
                    ? t("liveClasses.audienceOpenHint")
                    : t("liveClasses.audienceHint")}
              </p>
            </div>

            {form.audience === "class" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                <GraduationCap className="mr-1 inline size-3" />
                {t("liveClasses.classLabel")}
              </label>
              <select
                value={form.classGroupId}
                onChange={(e) => setForm({ ...form, classGroupId: e.target.value, lessonId: "" })}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              >
                <option value="">{classes.length === 0 ? t("liveClasses.audienceNoClasses") : t("liveClasses.selectClassRequired")}</option>
                {classes.map((c) => (
                  <option key={c.classGroupId} value={c.classGroupId}>
                    {c.className} {c.subjectName ? `— ${c.subjectName}` : ""}
                  </option>
                ))}
              </select>
            </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                <BookOpen className="mr-1 inline size-3" />
                {t("subject")}
              </label>
              <select
                value={form.subjectId}
                onChange={(e) => setForm({ ...form, subjectId: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              >
                <option value="">{t("liveClasses.selectSubjectOptional")}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {form.audience === "class" && (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                <Video className="mr-1 inline size-3" />
                {t("liveClasses.relatedLessonLabel")}
              </label>
              <select
                value={form.lessonId}
                onChange={(e) => setForm({ ...form, lessonId: e.target.value })}
                disabled={!form.classGroupId}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {form.classGroupId ? t("liveClasses.noLessonOption") : t("liveClasses.selectClassFirst")}
                </option>
                {lessonOptions.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
              {form.classGroupId && lessonOptions.length === 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">{t("liveClasses.noLessonsHint")}</p>
              )}
            </div>
            )}

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("lessons.descLabel")}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t("liveClasses.descPlaceholder")}
                rows={3}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-ring resize-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("liveClasses.datetimeLabel")}</label>
              <input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("liveClasses.durationLabel")}</label>
              <input
                type="number"
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                min={1}
                max={480}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("liveClasses.maxParticipantsLabel")}</label>
              <input
                type="number"
                value={form.maxParticipants}
                onChange={(e) => setForm({ ...form, maxParticipants: Number(e.target.value) })}
                min={1}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-lg border border-border bg-background p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enableRecording}
                onChange={(e) => setForm({ ...form, enableRecording: e.target.checked })}
                className="size-4 rounded border-border"
              />
              <span className="text-sm text-foreground">{t("liveClasses.enableRecording")}</span>
            </label>
            <span className="text-xs text-muted-foreground">{t("liveClasses.recordingHint")}</span>
          </div>

          <div className="flex items-center gap-4 rounded-lg border border-border bg-background p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.lobbyEnabled}
                onChange={(e) => setForm({ ...form, lobbyEnabled: e.target.checked })}
                className="size-4 rounded border-border"
              />
              <span className="text-sm text-foreground">{t("liveClasses.enableLobby")}</span>
            </label>
            <span className="text-xs text-muted-foreground">{t("liveClasses.lobbyHint")}</span>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("liveClasses.timezoneLabel")}</label>
            <select
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
            >
              <option value="Africa/Dar_es_Salaam">Africa/Dar es Salaam (UTC+03:00)</option>
              <option value="Africa/Nairobi">Africa/Nairobi (UTC+03:00)</option>
              <option value="Africa/Kampala">Africa/Kampala (UTC+03:00)</option>
              <option value="Africa/Kigali">Africa/Kigali (UTC+02:00)</option>
              <option value="Africa/Lagos">Africa/Lagos (UTC+01:00)</option>
              <option value="Africa/Johannesburg">Africa/Johannesburg (UTC+02:00)</option>
              <option value="Europe/London">Europe/London (UTC+00:00)</option>
              <option value="America/New_York">America/New York (UTC-05:00)</option>
              <option value="Asia/Dubai">Asia/Dubai (UTC+04:00)</option>
              <option value="Asia/Kolkata">Asia/Kolkata (UTC+05:30)</option>
              <option value="Asia/Shanghai">Asia/Shanghai (UTC+08:00)</option>
              <option value="Asia/Tokyo">Asia/Tokyo (UTC+09:00)</option>
            </select>
          </div>

          <div className="flex items-center gap-4 rounded-lg border border-border bg-background p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
                className="size-4 rounded border-border"
              />
              <span className="text-sm text-foreground">{t("liveClasses.recurringLabel")}</span>
            </label>
            <span className="text-xs text-muted-foreground">{t("liveClasses.recurringHint")}</span>
          </div>

          {form.isRecurring && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("liveClasses.repeatLabel")}</label>
                <select
                  value={form.recurrencePattern}
                  onChange={(e) => setForm({ ...form, recurrencePattern: e.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                >
                  <option value="">{t("liveClasses.selectPattern")}</option>
                  <option value="DAILY">{t("liveClasses.patternDaily")}</option>
                  <option value="WEEKLY">{t("liveClasses.patternWeekly")}</option>
                  <option value="BIWEEKLY">{t("liveClasses.patternBiweekly")}</option>
                  <option value="MONTHLY">{t("liveClasses.patternMonthly")}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("liveClasses.recurrenceEndLabel")}</label>
                <input
                  type="date"
                  value={form.recurrenceEndDate}
                  onChange={(e) => setForm({ ...form, recurrenceEndDate: e.target.value })}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-ring"
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetForm}>{tc("cancel")}</Button>
            {editingId ? (
              <Button onClick={handleSubmit} disabled={submitting || !form.title.trim() || !form.scheduledAt}>
                {submitting ? tc("saving") : t("liveClasses.updateClass")}
              </Button>
            ) : (
              <Button onClick={handleProceedToReview} disabled={!form.title.trim() || !form.scheduledAt}>
                {t("liveClasses.reviewSchedule")}
              </Button>
            )}
          </div>
        </div>
      )}

      {reviewMode && !editingId && (
        <div className="rounded-2xl border border-primary/30 bg-card p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">{t("liveClasses.reviewTitle")}</h2>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewRowTitle")}</span>
              <p className="text-foreground">{form.title}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewDatetime")}</span>
              <p className="text-foreground">{form.scheduledAt ? new Date(form.scheduledAt).toLocaleString() : "—"}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewDuration")}</span>
              <p className="text-foreground">{t("liveClassDetail.minutesCount", { count: form.durationMinutes })}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewMax")}</span>
              <p className="text-foreground">{form.maxParticipants}</p>
            </div>
            {form.classGroupId && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewClass")}</span>
                <p className="text-foreground">{getClassName(form.classGroupId) || form.classGroupId}</p>
              </div>
            )}
            {form.subjectId && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewSubject")}</span>
                <p className="text-foreground">{subjects.find((s) => s.id === form.subjectId)?.name || form.subjectId}</p>
              </div>
            )}
            {form.lessonId && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.relatedLessonLabel")}</span>
                <p className="text-foreground">{lessonOptions.find((l) => l.id === form.lessonId)?.title || form.lessonId}</p>
              </div>
            )}
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewRecording")}</span>
              <p className="text-foreground">{form.enableRecording ? t("liveClasses.enabledLabel") : t("liveClasses.disabledLabel")}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.broadcastSourceLabel")}</span>
              <p className="text-foreground">{t(`livePrepare.source.${form.broadcastSource}`)}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewTimezone")}</span>
              <p className="text-foreground">{form.timezone}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewLobby")}</span>
              <p className="text-foreground">{form.lobbyEnabled ? t("liveClasses.enabledLabel") : t("liveClasses.disabledLabel")}</p>
            </div>
            {form.isRecurring && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewRecurring")}</span>
                <p className="text-foreground">{t("liveClasses.recurringValue", { pattern: form.recurrencePattern, end: form.recurrenceEndDate })}</p>
              </div>
            )}
          </div>
          {form.description && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">{t("liveClasses.reviewDesc")}</span>
              <p className="mt-1 text-sm text-foreground whitespace-pre-line">{form.description}</p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReviewMode(false)}>{t("liveClasses.backToEdit")}</Button>
            <Button onClick={handleSubmit} disabled={submitting} className="gap-1 bg-green-600 hover:bg-green-700 text-white">
              {submitting ? t("liveClasses.scheduling") : t("liveClasses.confirmSchedule")}
            </Button>
          </div>
        </div>
      )}

      {sortedClasses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <Video className="mx-auto size-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-semibold text-foreground">{t("liveClasses.emptyTitle")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("liveClasses.emptyDesc")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedClasses.map((lc) => {
            const status = statusConfig[lc.status] || statusConfig.SCHEDULED
            const className = getClassName(lc.classGroupId)
            return (
              <div key={lc.id} className="rounded-2xl border border-border bg-card p-5 shadow-xs transition-all hover:shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
                    <Video className="size-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-foreground">{lc.title}</h3>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                      {lc.sessionType && lc.sessionType !== "LECTURE" && (
                        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {lc.sessionType.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {lc.subjectName && (
                        <span className="flex items-center gap-1">
                          <BookOpen className="size-3" />
                          {lc.subjectName}
                        </span>
                      )}
                      {className && (
                        <span className="flex items-center gap-1">
                          <GraduationCap className="size-3" />
                          {className}
                        </span>
                      )}
                      {lc.lessonId && (
                        <span className="flex items-center gap-1 text-teal-600 dark:text-teal-400" title={t("liveClasses.relatedLessonLabel")}>
                          <BookOpen className="size-3" />
                          {lc.lessonTitle || t("liveClasses.linkedLesson")}
                        </span>
                      )}
                    </div>
                    {lc.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{lc.description}</p>
                    )}
                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        {formatDate(lc.scheduledAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {t("classDetail.minutesCount", { count: lc.durationMinutes })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="size-3" />
                        {t("liveClasses.participantsMax", { current: lc.currentParticipants != null ? `${lc.currentParticipants}/` : "", max: lc.maxParticipants })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {lc.status === "SCHEDULED" && (
                      <>
                        {lc.publicationStatus && (
                          <span className="self-center text-xs text-muted-foreground">
                            {PUBLICATION_STATUSES.includes(lc.publicationStatus)
                              ? t(`liveClasses.pubStatus.${lc.publicationStatus}`)
                              : lc.publicationStatus}
                            {lc.publicationStatus === "REJECTED" && lc.reviewNote
                              ? ` · ${t("liveClasses.rejectedNote", { p0: lc.reviewNote })}`
                              : null}
                          </span>
                        )}
                        {(lc.publicationStatus === "DRAFT" || lc.publicationStatus === "REJECTED") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => handleSubmitForReview(lc.id)}
                          >
                            {t("liveClasses.submitForReview")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => window.open(`/dashboard/teacher/live-classes/${lc.id}/prepare`, "_blank")}
                        >
                          {t("liveClassDetail.prepare")}
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1 bg-green-600 hover:bg-green-700 text-white"
                          onClick={() => handleStartLive(lc.id)}
                        >
                          <Play className="size-3" />
                          {t("liveClassDetail.startLive")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => startEdit(lc)}
                          title={tc("edit")}
                        >
                          <Edit className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleCancel(lc.id)}
                          title={tc("cancel")}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                    {(lc.status === "IN_PROGRESS" || lc.status === "LIVE") && (
                      <>
                        <Button
                          size="sm"
                          className="gap-1"
                          onClick={() => window.open(`/live-classes/${lc.id}`, "_blank")}
                        >
                          <ExternalLink className="size-3" />
                          {t("liveClassDetail.openClassroom")}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          onClick={() => handleEndLive(lc.id)}
                        >
                          <Square className="size-3" />
                          {t("liveClasses.endBtn")}
                        </Button>
                      </>
                    )}
                    {(lc.status === "COMPLETED" || lc.status === "ENDED" || lc.status === "CANCELLED") && (
                      <>
                        {lc.recordingUrl && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => window.open(`/live-classes/${lc.id}`, "_blank")}
                            >
                              <ExternalLink className="size-3" />
                              {t("liveClasses.viewRecording")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => router.push(`/dashboard/teacher/live-classes/${lc.id}/chapters`)}
                            >
                              <ListOrdered className="size-3" />
                              {t("chapters.listSection")}
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleCancel(lc.id)}
                          title={tc("delete")}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
