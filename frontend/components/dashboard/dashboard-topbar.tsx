"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Menu, X, Bell, Search, Globe, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar"
import { useAuth, translateRole } from "@/lib/auth"
import { useLocaleContext } from "@/components/locale-provider"
import { adminApi, ApiRequestError, notificationsApi } from "@/lib/api"

type PaletteMode = "platform" | "organization" | "authority"

interface PaletteResult {
  type: string
  id: string
  title: string
  subtitle: string
}

function GlobalSearchDropdown({
  mode,
  onClose,
}: {
  mode: PaletteMode
  onClose: () => void
}) {
  const t = useTranslations("common")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PaletteResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const isPlatform = mode === "platform"
  const isAuthority = mode === "authority"

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); setError(null); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        if (isAuthority) {
          // Nationaladmin.md §28 — delegates to the shared oversight search,
          // which filters every row to the caller's jurisdiction server-side.
          const token = localStorage.getItem("elmkusoma_access_token")
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/v1/oversight/search?q=${encodeURIComponent(query)}`, {
            headers: { Authorization: `Bearer ${token || ""}` },
          })
          if (res.ok) {
            const json = await res.json()
            const all: PaletteResult[] = json.data || json || []
            // Keep only result types with a real oversight destination —
            // a search hit must never become a dead link.
            setResults(all.filter((r) => r.type === "INSTITUTION" || r.type === "LIVE_CLASS"))
          } else {
            setError(res.status === 403 ? t("searchForbidden") : t("searchFailed"))
          }
        } else if (isPlatform) {
          const token = document.cookie.match(/elmkusoma_access_token=([^;]+)/)?.[1]
          const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/v1/platform-admin/search?q=${encodeURIComponent(query)}&limit=10`, {
            headers: { Authorization: `Bearer ${decodeURIComponent(token || "")}` },
          })
          if (res.ok) {
            const json = await res.json()
            setResults(json.data || [])
          } else {
            setError(res.status === 403 ? t("searchForbidden") : t("searchFailed"))
          }
        } else {
          // Org-scoped: OrganizationContextResolver restricts every row to the
          // caller's own institution, so nothing foreign can come back.
          setResults(await adminApi.orgSearch(query, "all", 10))
        }
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 403) setError(t("searchForbidden"))
        else setError(t("searchFailed"))
        setResults([])
      } finally { setLoading(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, isPlatform, isAuthority, t])

  function navigateTo(type: string, id: string) {
    if (isAuthority) {
      // Only jurisdiction-scoped result types with a real destination.
      if (type === "INSTITUTION") router.push(`/oversight/schools/${id}`)
      else router.push("/oversight/live-classes")
      onClose()
      return
    }
    if (!isPlatform) {
      if (type === "COURSE") router.push("/dashboard/admin/courses")
      else if (type === "LIVE_CLASS") router.push("/dashboard/admin/live-operations")
      else if (type === "INSTITUTION") router.push("/dashboard/admin/profile")
      else router.push(`/dashboard/admin/people?search=${encodeURIComponent(id)}`)
      onClose()
      return
    }
    if (type === "USER") router.push(`/dashboard/platform-admin/users/${id}`)
    else if (type === "INSTITUTION") router.push(`/dashboard/platform-admin/institutions/${id}`)
    else if (type === "LIVE_CLASS") router.push(`/dashboard/platform-admin/live-classes`)
    else if (type === "PAYMENT") router.push(`/dashboard/platform-admin/payments`)
    else if (type === "CERTIFICATE") router.push(`/dashboard/platform-admin/certificates`)
    else if (type === "SERVICE") router.push(`/dashboard/platform-admin/services`)
    else router.push(`/dashboard/platform-admin/users?search=${encodeURIComponent(id)}`)
    onClose()
  }

  const typeColors: Record<string, string> = {
    USER: "bg-blue-100 text-blue-700", INSTITUTION: "bg-emerald-100 text-emerald-700",
    COURSE: "bg-indigo-100 text-indigo-700",
    LIVE_CLASS: "bg-purple-100 text-purple-700", PAYMENT: "bg-amber-100 text-amber-700",
    CERTIFICATE: "bg-cyan-100 text-cyan-700", SERVICE: "bg-teal-100 text-teal-700",
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder={isAuthority ? t("searchOversight") : isPlatform ? t("searchPlatform") : t("searchOrganizationPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground" />
          <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {loading && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("searching")}</p>}
          {error && !loading && (
            <p className="flex items-center justify-center gap-2 px-3 py-6 text-center text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </p>
          )}
          {!loading && !error && query.length >= 2 && results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("noResults")}</p>
          )}
          {results.map((r) => (
            <button key={`${r.type}-${r.id}`} onClick={() => navigateTo(r.type, r.id)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted transition-colors">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${typeColors[r.type] || "bg-gray-100 text-gray-700"}`}>{r.type}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground truncate">{r.subtitle}</p>
              </div>
            </button>
          ))}
          {query.length < 2 && (
            <div className="px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">{t("typeToSearch")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function DashboardTopbar({ renderSidebar }: { renderSidebar?: (onNavigate: () => void) => React.ReactNode }) {
  const t = useTranslations("common")
  const tn = useTranslations("nav")
  const tr = useTranslations("roles")
  const { locale, setLocale } = useLocaleContext()
  const [open, setOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const { user, logout } = useAuth()
  const router = useRouter()
  const isAdmin = user?.role === "Admin"
  const isOrgAdmin = user?.role === "Institution Admin"
  const isAuthority =
    user?.role === "National Admin" ||
    user?.role === "Regional Admin" ||
    user?.role === "District Admin"
  // §020/§065 — the palette must only open for roles whose search endpoint the
  // caller is actually authorized to hit: platform search is ADMIN-only, org
  // admins get the institution-scoped search, authority roles get the
  // jurisdiction-filtered oversight search (Nationaladmin.md §28).
  const paletteMode: PaletteMode | null = isAdmin
    ? "platform"
    : isOrgAdmin
      ? "organization"
      : isAuthority
        ? "authority"
        : null
  const canUsePalette = paletteMode !== null

  useEffect(() => {
    if (!canUsePalette) return
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true) }
      if (e.key === "Escape") setSearchOpen(false)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [canUsePalette])

  useEffect(() => {
    if (!user) return
    // One role-safe endpoint for every role (see NotificationController).
    const load = () => {
      notificationsApi.getUnreadCount().then((data) => {
        setUnreadCount(data.count)
      }).catch(() => {})
    }
    load()
    // Poll every 30 seconds
    const interval = setInterval(load, 30000)
    const onRealtime = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string }>).detail
      if (detail?.type === "NOTIFICATION") load()
    }
    window.addEventListener("elmkusoma:realtime", onRealtime)
    return () => {
      clearInterval(interval)
      window.removeEventListener("elmkusoma:realtime", onRealtime)
    }
  }, [user])

  /** Role → that role's notifications page (mirrors the sidebar entries). */
  function notificationsPath(): string | null {
    const role = user?.role
    if (role === "National Admin" || role === "Regional Admin" || role === "District Admin") {
      return "/oversight/notifications"
    }
    if (role === "Other Learner") return "/dashboard/learner/notifications-center"
    if (role === "Teacher" || role === "Instructor") return "/dashboard/teacher/notifications"
    if (role === "Parent") return "/dashboard/parent/notifications"
    if (role === "Admin") return "/dashboard/platform-admin/communications"
    if (role === "Student") {
      const level = (user?.learningLevel || "").toUpperCase()
      if (level === "NURSERY") return "/dashboard/nursery/notifications"
      if (level === "PRIMARY") return "/dashboard/notifications"
      return "/dashboard/secondary/notifications"
    }
    // Institution Admin has no dedicated notifications page yet — bell only
    // reports the count (routing it to a learner page would 403).
    return null
  }

  function handleLogout() {
    logout()
    router.push("/login")
  }

  function toggleLocale() {
    setLocale(locale === "en" ? "sw" : "en")
  }

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U"

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur sm:px-6" role="banner" aria-label={t("mainNavigation")}>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 lg:hidden"
          aria-label={t("openMenu")}
          onClick={() => setOpen(true)}
        >
          <Menu className="size-5" />
        </Button>

        {canUsePalette ? (
          <button onClick={() => setSearchOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted sm:flex">
            <Search className="size-4" />
            <span>{isAdmin ? t("searchPlatform") : isAuthority ? t("searchOversight") : t("searchOrganization")}</span>
            <kbd className="ml-4 rounded-md border border-border px-1.5 py-0.5 text-[10px]">Ctrl+K</kbd>
          </button>
        ) : (
          <label className="relative hidden items-center sm:flex">
            <Search className="absolute left-3 size-4 text-muted-foreground" />
            <input
              type="search"
              placeholder={t("searchCourses")}
              className="h-10 w-64 rounded-lg border border-border bg-muted/60 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:bg-background"
            />
          </label>
        )}

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={toggleLocale}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("changeLanguage")}
            title={t("changeLanguage")}
          >
            <Globe className="size-3.5" />
            {locale === "en" ? "EN" : "SW"}
          </button>
          <button
            type="button"
            className="relative flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={tn("notifications")}
            onClick={() => {
              const path = notificationsPath()
              if (path) router.push(path)
            }}
          >
            <Bell className="size-5" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-orange text-[9px] font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg p-1 hover:bg-muted"
              onClick={() => setProfileOpen((v) => !v)}
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-accent text-primary text-sm font-semibold">
                {initials}
              </span>
              <div className="hidden text-left sm:block">
                <p className="text-sm font-semibold leading-tight text-foreground">
                  {user?.name || tr("student")}
                </p>
                <p className="text-xs text-muted-foreground capitalize">{translateRole(user?.role, tr)}</p>
              </div>
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-card py-1 shadow-lg z-50">
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {t("logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {searchOpen && paletteMode && (
        <GlobalSearchDropdown mode={paletteMode} onClose={() => setSearchOpen(false)} />
      )}

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
         
<div className="absolute inset-y-0 left-0 z-10 w-72 max-w-[calc(100vw-2rem)] overflow-hidden border-r border-border bg-card shadow-xl">

            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-3 z-10 h-9 w-9"
              aria-label={t("closeMenu")}
              onClick={() => setOpen(false)}
            >
              <X className="size-5" />
            </Button>
            {renderSidebar ? renderSidebar(() => setOpen(false)) : <DashboardSidebar onNavigate={() => setOpen(false)} />}
          </div>
        </div>
      )}
    </>
  )
}
