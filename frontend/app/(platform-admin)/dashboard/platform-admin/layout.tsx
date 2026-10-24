"use client"

import type { ReactNode } from "react"
import { PlatformAdminSidebar } from "@/components/dashboard/platform-admin-sidebar"
import { DashboardTopbar } from "@/components/dashboard/dashboard-topbar"
import { AuthGuard } from "@/components/auth/auth-guard"
import { LowBandwidthProvider } from "@/components/primary/low-bandwidth-provider"
import { useAuth } from "@/lib/auth"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

// Platform Admin workspace shell. Lives in the (platform-admin) route group so
// the learner shell (app/dashboard/layout.tsx) can never wrap these pages.
// URL remains /dashboard/platform-admin — proxy.ts gating is unchanged, and
// the backend @PreAuthorize("hasRole('ADMIN')") remains the authoritative check.
export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (user && user.role !== "Admin") {
      router.replace("/dashboard")
    }
  }, [user, router])

  if (user && user.role !== "Admin") return null

  return (
    <AuthGuard>
      <LowBandwidthProvider>
        <div className="flex min-h-dvh bg-muted/40">
          <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-border bg-card lg:block">

            <PlatformAdminSidebar />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
            <DashboardTopbar
              renderSidebar={(onNavigate) => <PlatformAdminSidebar onNavigate={onNavigate} />}
            />
            <main className="flex-1 p-4 sm:p-6">{children}</main>
          </div>
        </div>
      </LowBandwidthProvider>
    </AuthGuard>
  )
}
