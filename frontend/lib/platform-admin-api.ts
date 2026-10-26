const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

function getToken(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/elmkusoma_access_token=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

function getInstitutionId(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/elmkusoma_institution_id=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const institutionId = getInstitutionId()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> || {}),
  }
  if (token) headers["Authorization"] = `Bearer ${token}`
  if (institutionId) headers["X-Institution-Id"] = institutionId

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) throw new Error(await describeError(res))
  const json = await res.json()
  return json.data ?? json
}

/**
 * Builds a human-readable error from a failed response. The API returns the real
 * reason in the body (ApiResponse.error), and `res.statusText` is empty over HTTP/2
 * and for most proxy responses - surfacing that alone produced blank messages such
 * as "API 400: " and hid real validation/authorization failures from the user.
 */
async function describeError(res: Response): Promise<string> {
  let detail = ""
  try {
    const raw = await res.text()
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        detail = parsed?.error || parsed?.message || ""
      } catch {
        detail = raw.slice(0, 200)
      }
    }
  } catch {
    // body already consumed or unreadable - fall back to status text
  }
  if (detail) return `API ${res.status}: ${detail}`
  if (res.statusText) return `API ${res.status}: ${res.statusText}`
  return `API ${res.status}`
}

export interface PlatformDashboard {
  totalUsers: number
  totalStudents: number
  totalTeachers: number
  totalParents: number
  totalInstitutions: number
  totalLiveClasses: number
  activeLiveClasses: number
  totalPayments: number
  totalCertificates: number
  unresolvedSecurityEvents: number
}

export interface AttentionItem {
  severity: string
  title: string
  description: string
  category: string
  actionUrl: string
}

export interface ActivityFeed {
  id: string
  institutionId: string
  userId: string
  actorName: string
  action: string
  description: string
  entityType: string
  entityId: string
  entityName: string
  createdAt: string
}

export interface PlatformHealth {
  databaseStatus: string
  apiStatus: string
  totalUsers: number
  activeUsers: number
  totalInstitutions: number
  activeInstitutions: number
  livekitStatus?: string
  storageStatus?: string
  backgroundJobsStatus?: string
  notificationsStatus?: string
  paymentsStatus?: string
  realtimeStatus?: string
  mediaStatus?: string
  heartbeatAt?: string | null
}

export interface UserSummary {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  institutionId: string | null
  createdAt: string
  isEmailVerified?: boolean
  isPhoneVerified?: boolean
  phone?: string
}

/**
 * Request for an expiring platform-issued invitation. No password by design: the recipient
 * chooses their own when they redeem, after proving control of the address.
 */
export interface PlatformInvitationPayload {
  email: string
  institutionId: string
  role: string
  firstName?: string
  lastName?: string
}

/** Response for a created invitation. `token` is returned exactly once, never re-listed. */
export interface PlatformInvitation {
  id: string
  email: string
  role: string
  status: string
  token?: string
  expiresAt?: string
}

export type ContactMessageStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "AWAITING_RESPONSE"
  | "RESOLVED"
  | "CLOSED"

/** What the server actually recorded about notification. NOT_CONFIGURED means nobody was emailed. */
export type ContactNotificationStatus = "NOT_CONFIGURED" | "PENDING" | "SENT" | "FAILED"

export interface ContactMessageRecord {
  id: string
  reference: string
  name: string
  email: string
  category: string
  subject: string
  message: string
  status: ContactMessageStatus
  priority: string
  assignedTo: string | null
  createdAt: string | null
  resolvedAt: string | null
  notificationStatus: ContactNotificationStatus
  notificationError: string | null
  notificationAttempts: number
  notifiedAt: string | null
  userId: string | null
  ipAddress: string | null
  userAgent: string | null
}

export interface ContactMessageReply {
  id: string
  authorId: string | null
  message: string
  internal: boolean
  delivered: boolean
  createdAt: string | null
}

export type LegalDocType = "TERMS" | "PRIVACY" | "COOKIE" | "SUPPORT_POLICY"

export interface LegalDocumentRecord {
  id: string
  type: LegalDocType
  title: string
  content: string
  effectiveDate: string | null
  /** Working-copy revision. Moves when the draft is edited. */
  draftVersion: number
  /** What the public is actually reading. Null until first publication. */
  publishedVersion: number | null
  lastModifiedBy: string | null
  updatedAt: string | null
}

export interface LegalVersionRecord {
  id: string
  version: number
  title: string
  content: string
  effectiveDate: string | null
  publishedAt: string | null
  publishedBy: string | null
}

export type NewsPriority = "NORMAL" | "IMPORTANT" | "URGENT"

export type NewsStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"

/** The full admin view, including the working-copy fields the public payload omits. */
export interface NewsArticleRecord {
  id: string
  slug: string
  title: string
  summary: string
  body: string
  category: string | null
  coverImageUrl: string | null
  authorName: string | null
  status: NewsStatus
  publishedAt: string | null
  scheduledAt: string | null
  expiresAt: string | null
  featured: boolean
  priority: NewsPriority
  sortOrder: number
  lastModifiedBy: string | null
  publishedBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Save payload. Deliberately has no `status` and no `publishedAt`: lifecycle changes go through
 * their own endpoints, and the server owns the publication timestamp.
 */
export interface NewsArticlePayload {
  title: string
  summary: string
  body: string
  slug?: string
  category?: string
  coverImageUrl?: string
  authorName?: string
  priority?: NewsPriority
  featured?: boolean
  sortOrder?: number
  /** Local datetime-local value; converted to ISO before sending. */
  scheduledAt?: string | null
  expiresAt?: string | null
}

export interface UserCreatePayload {
  firstName: string
  lastName: string
  email: string
  phone?: string
  password?: string
  role: string
  institutionId?: string
  /**
   * Provision an independent (school-less) teacher. The server honours it only for
   * `role: "TEACHER"`; every other organization-scoped role still requires `institutionId`.
   * Omit `institutionId` together with this flag — that combination is what creates an
   * account with no school and no membership; nothing is ever invented for the admin.
   */
  independentTeacher?: boolean
}

export interface UserUpdatePayload {
  firstName?: string
  lastName?: string
  phone?: string
  role?: string
  isActive?: boolean
  isEmailVerified?: boolean
  isPhoneVerified?: boolean
}

export interface InstitutionSummary {
  id: string
  name: string
  code: string
  type: string
  city: string
  region: string
  regionId?: string | null
  districtId?: string | null
  isActive: boolean
  status?: string
  createdAt: string
}

export interface InstitutionDetail extends InstitutionSummary {
  address: string
  country: string
  phone: string
  email: string
  totalUsers: number
  totalStudents: number
  totalTeachers: number
}

export interface InstitutionFormPayload {
  name: string
  type: string
  description?: string
  logoUrl?: string
  website?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  country?: string
  regionId?: string
  districtId?: string
}

export interface OversightRegionOption {
  id: string
  name: string
  code: string
  isActive: boolean
}

export interface OversightDistrictOption {
  id: string
  name: string
  code: string
  regionId: string
  regionName: string
  isActive: boolean
}

export const INSTITUTION_TYPES = [
  "NATIONAL",
  "NURSERY",
  "PRIMARY",
  "SECONDARY",
  "SCHOOL",
  "COLLEGE",
  "VOCATIONAL",
  "UNIVERSITY",
  "TRAINING_PROVIDER",
  "PROFESSIONAL_BODY",
  "COMPANY",
  "NGO",
  "GOVERNMENT",
  "CONTENT_PROVIDER",
  "EVENT_PROVIDER",
  "COMMUNITY_SCHOOL",
  "ADULT_EDUCATION",
] as const

export interface OrgMember {
  userId: string
  fullName: string | null
  email: string | null
  phone: string | null
  userRole: string | null
  membershipRole: string | null
  isActive: boolean | null
  userActive: boolean | null
  joinedAt: string | null
}

export const ORG_MEMBER_ROLES = [
  "OWNER",
  "INSTITUTION_ADMIN",
  "ADMIN",
  "NATIONAL_ADMIN",
  "TEACHER",
  "INSTRUCTOR",
  "STUDENT",
  "PARENT",
  "OTHER_LEARNER",
] as const

export interface LiveClassSummary {
  id: string
  title: string
  status: string
  scheduledAt: string
  durationMinutes: number
  maxParticipants: number
  currentParticipants: number
  createdAt: string
}

export interface PaymentSummary {
  id: string
  parentId: string
  studentId: string
  amount: number
  currency: string
  status: string
  serviceType: string
  createdAt: string
}

export interface CertificateSummary {
  id: string
  studentId: string
  serialNumber: string
  certificateNumber: string | null
  title: string
  studentName: string | null
  certificateType: string | null
  courseOrProgramme: string | null
  institutionId: string | null
  institutionName: string | null
  issueDate: string
  expiryDate: string | null
  status: string
  createdAt: string | null
}

export interface CertificateOverview {
  total: number
  issued: number
  revoked: number
  draft: number
  byType: Record<string, number>
  verificationActivity30Days: number
  generatedAt: string
}

export interface Signatory {
  id: string
  institutionId: string | null
  institutionName: string | null
  fullName: string
  positionTitle: string | null
  organization: string | null
  signatureImage: string | null
  certificateTypes: string[] | null
  status: string
  validFrom: string | null
  validUntil: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface SignatoryInput {
  fullName: string
  positionTitle?: string | null
  organization?: string | null
  signatureImage?: string | null
  certificateTypes?: string[] | null
  status?: string
  validFrom?: string | null
  validUntil?: string | null
  institutionId?: string | null
}

export interface PlatformTemplate {
  id: string
  institutionId: string
  institutionName: string | null
  name: string
  description: string | null
  templateType: string
  htmlContent: string | null
  cssContent: string | null
  logoUrl: string | null
  signatureLine1: string | null
  signatureLine2: string | null
  signatureLine3: string | null
  isActive: boolean
  version: number
  usageCount: number
  createdAt: string | null
  updatedAt: string | null
  signatories: Signatory[]
}

export interface TemplateInput {
  name: string
  description?: string | null
  templateType: string
  htmlContent?: string | null
  cssContent?: string | null
  logoUrl?: string | null
  signatureLine1?: string | null
  signatureLine2?: string | null
  signatureLine3?: string | null
  institutionId?: string
}

export interface TemplateVersion {
  id: string
  templateId: string
  version: number
  name: string
  templateType: string
  description: string | null
  htmlContent: string | null
  cssContent: string | null
  logoUrl: string | null
  archivedAt: string | null
  archivedBy: string | null
}

export interface CertificateDetail {
  certificate: import("./api").CertificateResponse
  institutionName: string | null
  templateId: string | null
  templateName: string | null
  templateVersion: number | null
  templateIsActive: boolean | null
  signatories: Signatory[]
}

export interface SecurityEventItem {
  id: string
  userId: string
  eventType: string
  severity: string
  description: string
  ipAddress: string
  resolved: boolean
  createdAt: string
}

export interface AuditLogEntry {
  id: string
  userId: string
  performedBy: string
  userRole: string
  action: string
  entityType: string
  entityId: string
  entityName: string
  oldValues: Record<string, unknown>
  newValues: Record<string, unknown>
  ipAddress: string
  createdAt: string
}

export interface GlobalSearchResult {
  type: string
  id: string
  title: string
  subtitle: string
}

export interface PageResponse<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
  first: boolean
  last: boolean
}

/**
 * One transaction, as returned by the financial command centre search.
 *
 * <p>Every figure is reproduced from the backend exactly as stored. In particular
 * `commissionAmount` is null when no approved rate existed at confirmation time: the UI must show
 * that as "no approved rate", never as 0, because a zero commission and an undecided one are
 * different facts and a report that merges them misstates revenue.
 */
export interface FinancialTransaction {
  paymentId: string
  receiptNumber: string | null
  providerReference: string | null
  provider: string | null
  serviceType: string
  status: string
  amount: number
  currency: string
  refundedAmount: number
  refundableAmount: number
  commissionAmount: number | null
  commissionStatus: string | null
  commissionPolicyKey: string | null
  commissionPolicyVersion: number | null
  paidAt: string | null
  parentId: string | null
  studentId: string | null
  institutionId: string | null
}

/** Filters the backend accepts. Everything is optional; an empty object lists the newest. */
export interface TransactionSearchFilters {
  query?: string
  status?: string
  serviceType?: string
  provider?: string
  institutionId?: string
  parentId?: string
  from?: string
  to?: string
  page?: number
  size?: number
  sortBy?: string
  sortDir?: "asc" | "desc"
}

export interface EventFormPayload {
  title: string
  description?: string
  eventType: string
  category?: string
  location?: string
  meetingUrl?: string
  startsAt: string
  endsAt?: string
  durationMinutes?: number
  maxParticipants?: number
  status?: string
  thumbnailUrl?: string
  tags?: string
  isFree?: boolean
  requiresApproval?: boolean
  organizerId?: string
  timezone?: string
  accessLevel?: string
  presenterName?: string
  eventFormat?: string
  difficulty?: string
  targetAudience?: string
  prerequisites?: string
  learningOutcomes?: string
  agenda?: string
  relatedCourseId?: string
  relatedModuleId?: string
  relatedLessonId?: string
  providerId?: string
}

export interface ServiceSummary {
  id: string; name: string; code: string; description: string; category: string
  isActive: boolean; requiresVerification: boolean; maxSeats: number | null
  monthlyPrice: number | null; currency: string; createdAt: string
}

export interface IncidentSummary {
  id: string; title: string; description: string; category: string
  severity: string; status: string; affectedService: string | null
  assignedTo: string | null; detectedAt: string; resolvedAt: string | null; createdAt: string
}

export interface PlatformConfigItem {
  id: string; configKey: string; configValue: string; configType: string
  description: string; category: string; isSensitive: boolean; isPublic: boolean
  lastModifiedBy: string | null; updatedAt: string | null
}

export interface NotificationSummary {
  id: string; title: string; message: string; notificationType: string
  priority: string; targetAudience: string | null; targetRole: string | null
  sentBy: string | null; sentAt: string; readCount: number
}

export interface DelegationSummary {
  id: string; delegatorId: string; delegatorName: string | null
  delegateId: string; delegateName: string | null; permissions: string
  scope: string; authority: string | null; status: string
  startsAt: string; expiresAt: string | null; createdAt: string
}

export interface DelegationDetail {
  id: string; delegatorId: string; delegatorName: string | null; delegatorEmail: string | null
  delegateId: string; delegateName: string | null; delegateEmail: string | null
  authority: string | null; permissions: string; scope: string
  resourceIds: string[]; resourceNames: string[]; status: string
  reason: string | null; notes: string | null
  startsAt: string; expiresAt: string | null
  approvedBy: string | null; approvedByName: string | null; approvedAt: string | null
  rejectedAt: string | null; rejectionReason: string | null
  revokedAt: string | null; revokedBy: string | null; revokedByName: string | null
  revocationReason: string | null; createdAt: string; currentlyEffective: boolean | null
}

export interface DelegationCreatePayload {
  delegatorId: string; delegateId: string; permissions: string; scope?: string
  authority?: string; reason?: string; notes?: string; resourceIds?: string[]
  startsAt?: string; expiresAt?: string; requiresApproval?: boolean
}

export interface ProviderRegistryItem {
  id: string; name: string; code: string; type: string | null
  city: string | null; region: string | null; isActive: boolean | null
  status: string | null; verificationStatus: string | null
  adminCount: number | null; createdAt: string | null
}

export interface ProviderVerificationItem {
  id: string; verificationType: string; status: string
  submittedBy: string | null; submittedByName: string | null; submittedAt: string
  reviewedBy: string | null; reviewedByName: string | null; reviewedAt: string | null
  notes: string | null; documents: string | null
}

export interface ProviderGovernanceDetail {
  id: string; name: string; code: string; type: string | null
  description: string | null; address: string | null; city: string | null
  region: string | null; country: string | null; phone: string | null
  email: string | null; website: string | null; logoUrl: string | null
  isActive: boolean | null; status: string | null; enabledServices: string | null
  verificationStatus: string | null; approvedAt: string | null; approvedBy: string | null
  createdAt: string | null; updatedAt: string | null
  admins: OrgMember[]; verificationHistory: ProviderVerificationItem[]
  serviceEntitlements: ProviderQuota[]; complianceFlags: string[]
  recentAudit: AuditLogEntry[]
}

export interface ProviderAttentionItem {
  providerId: string; providerName: string; severity: string; category: string
  title: string; description: string; actionUrl: string
}

export interface DelegatedTask {
  verificationId: string; verificationType: string; entityType: string
  entityId: string; entityName: string | null; status: string
  submittedAt: string; delegationId: string; authority: string; scope: string
}

export interface VerificationSummary {
  id: string; entityType: string; entityId: string; verificationType: string
  status: string; submittedBy: string | null; reviewedBy: string | null
  submittedAt: string; reviewedAt: string | null; createdAt: string
  /** Reviewer notes / decision reason. */
  notes?: string | null
  /** Raw JSON document array as submitted by the applicant. */
  documents?: string | null
  /** Raw JSON context, e.g. {"serviceTypes":[...]} for teacher verifications. */
  metadata?: string | null
}

export interface EntitlementSummary {
  id: string; userId: string; studentId: string; serviceType: string
  serviceId: string; status: string; startsAt: string; expiresAt: string | null; createdAt: string
}

export interface EnhancedDashboard extends PlatformDashboard {
  openIncidents: number; pendingVerifications: number; activeServices: number
  totalNotifications: number; activeDelegations: number
}

export interface ProviderQuota {
  id: string; providerId: string; serviceId: string
  serviceName: string | null; serviceCode: string | null
  status: string; seatsUsed: number | null; maxSeats: number | null
  expiresAt: string | null; createdAt: string
}

export interface SupportTicket {
  id: string; userId: string; title: string; description: string
  category: string; priority: string; status: string
  assignedTo: string | null; resolvedAt: string | null; createdAt: string
}

/** One entry in a support case's conversation. Internal notes are staff-only. */
export interface SupportTicketMessage {
  id: string
  senderId: string
  message: string
  internal: boolean
  createdAt: string | null
}

export interface ContentReport {
  id: string; entityType: string; entityId: string; entityTitle: string | null
  reporterId: string | null; reason: string; description: string | null
  status: string; resolutionNotes: string | null; resolvedBy: string | null
  resolvedAt: string | null; createdAt: string
}

export interface IntegrationStatus {
  key: string; name: string; category: string | null
  connectionStatus: string; lastSuccessAt: string | null; failureCount: number
  webhookStatus: string | null; retryStatus: string | null; configStatus: string
  diagnostics: string | null; probeDetail: string | null
}

export interface WebhookEvent {
  id: string; source: string; eventType: string | null
  verificationStatus: string; processingResult: string
  errorDetails: string | null; retryCount: number
  receivedAt: string; processedAt: string | null
}

export interface BackupStatus {
  status: string | null; lastRunAt: string | null; lastFile: string | null
  lastFileSizeBytes: number | null; integrityOk: boolean | null
  backupCount: number | null; newestBackupAt: string | null; oldestBackupAt: string | null
  backupDirectory: string; statusFilePath: string
  scriptPresent: boolean; restoreScriptPresent: boolean
  restoreProcedure: string; recoveryEvents: string[] | null
}

export interface PolicyFlag {
  key: string; value: string; description: string | null; category: string | null
}

export interface RetentionStatus {
  config: Record<string, string>
  lastSweep: string | null
  archivedAuditCount: number | null
  totalAuditCount: number | null
  purgedSoftDeletedReports: number | null
}

export interface DataQualityCheck {
  name: string; status: string; count: number | null; detail: string
}

export interface AdminAccount {
  userId: string; email: string; fullName: string; role: string
  assignedRoleName: string | null; permissions: string[]; scope: string | null
  isActive: boolean | null; createdAt: string | null; createdBy: string | null
  lastModifiedAt: string | null; expiresAt: string | null; recentActionCount: number | null
  institutionId?: string
}

export interface AdminCreatePayload {
  firstName: string
  lastName: string
  email: string
  phone?: string
  password: string
  role: string
  institutionId?: string
}

export interface AdminUpdatePayload {
  firstName?: string
  lastName?: string
  phone?: string
  role?: string
  isActive?: boolean
  institutionId?: string
  password?: string
}

export interface OffboardingStep {
  step: string; status: string; detail: string
}

export interface OffboardingChecklist {
  institutionId: string; institutionName: string; lifecycleStatus: string
  steps: OffboardingStep[]
}

export interface FeatureStatus {
  key: string; name: string; status: string; description: string | null; updatedAt: string | null
}

export interface CommunicationDelivery {
  platformNotifications: number | null
  learnerNotifications: number | null
  learnerRead: number | null
  learnerUnread: number | null
  learnerReadRate: number | null
  platformReadCountSum: number | null
  deliveryNote: string | null
}

export interface AnalyticsSnapshot {
  id: string; snapshotType: string; generatedAt: string | null; data: Record<string, unknown> | null
}

/**
 * BR-02: how much of a payment may still be refunded.
 *
 * Asked for rather than computed from the transaction row, because the figure the list shows is a
 * snapshot taken when it was built and the eligible balance is what the server will accept right
 * now. An operator must never be offered an amount the server will refuse.
 */
export interface RefundableAmount {
  amount: number | null
}

/**
 * A refund request as created by BR-02.
 *
 * `status` is REQUESTED. Creating a request is not money moving: the refund enters the normal
 * lifecycle and is executed only by the separate approval path, so nothing here may be rendered as
 * a completed refund.
 */
export interface RefundRequestSummary {
  id: string
  paymentId: string | null
  amount: number | null
  currency: string | null
  status: string
  reason: string | null
  createdAt: string
}

/** Publication-governance view of one live class (GET /v1/platform-admin/live-classes/governance). */
export interface LiveClassGovernanceRecord {
  id: string
  title: string
  status: string
  publicationStatus: string
  accessLevel: string | null
  scheduledAt: string | null
  teacherId: string | null
  institutionId: string | null
  submittedForReviewAt: string | null
  publishedAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNote: string | null
  publiclyDiscoverable: boolean
}

export const platformAdminApi = {
  getDashboard: () => platformFetch<PlatformDashboard>("/v1/platform-admin/dashboard"),
  getAttention: () => platformFetch<AttentionItem[]>("/v1/platform-admin/attention"),
  getActivity: (page = 0, size = 20) => platformFetch<ActivityFeed[]>(`/v1/platform-admin/activity?page=${page}&size=${size}`),
  getHealth: () => platformFetch<PlatformHealth>("/v1/platform-admin/health"),

  listUsers: (page = 0, size = 20, role?: string, search?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (role) params.set("role", role)
    if (search) params.set("search", search)
    return platformFetch<PageResponse<UserSummary>>(`/v1/platform-admin/users?${params}`)
  },
  getUser: (userId: string) => platformFetch<UserSummary>(`/v1/platform-admin/users/${userId}`),
  updateUserStatus: (userId: string, active: boolean) =>
    platformFetch<UserSummary>(`/v1/platform-admin/users/${userId}/status?active=${active}`, { method: "PUT" }),
  createUser: (payload: UserCreatePayload) =>
    platformFetch<UserSummary>(`/v1/platform-admin/users`, { method: "POST", body: JSON.stringify(payload) }),
  /**
   * Issues an expiring, single-delivery invitation instead of creating the account outright.
   * The recipient activates it and chooses their own password, so the platform never sets a
   * permanent credential. The token is returned once and is not re-listable.
   */
  createInvitation: (payload: PlatformInvitationPayload) =>
    platformFetch<PlatformInvitation>(`/v1/platform-admin/invitations`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateUser: (id: string, payload: UserUpdatePayload) =>
    platformFetch<UserSummary>(`/v1/platform-admin/users/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteUser: (id: string) =>
    platformFetch<null>(`/v1/platform-admin/users/${id}`, { method: "DELETE" }),
  resetUserPassword: (id: string, newPassword: string) =>
    platformFetch<null>(`/v1/platform-admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
  sendPasswordResetLink: (id: string) =>
    platformFetch<null>(`/v1/platform-admin/users/${id}/send-reset-link`, { method: "POST" }),

  listInstitutions: (page = 0, size = 20, search?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (search) params.set("search", search)
    return platformFetch<PageResponse<InstitutionSummary>>(`/v1/platform-admin/institutions?${params}`)
  },
  getInstitution: (id: string) => platformFetch<InstitutionDetail>(`/v1/platform-admin/institutions/${id}`),
  updateInstitutionStatus: (id: string, active: boolean) =>
    platformFetch<InstitutionSummary>(`/v1/platform-admin/institutions/${id}/status?active=${active}`, { method: "PUT" }),
  updateInstitutionLifecycle: (id: string, status: string) =>
    platformFetch<InstitutionSummary>(`/v1/platform-admin/institutions/${id}/lifecycle`, { method: "PUT", body: JSON.stringify({ status }) }),
  createInstitution: (payload: InstitutionFormPayload) =>
    platformFetch<InstitutionDetail>(`/v1/platform-admin/institutions`, { method: "POST", body: JSON.stringify(payload) }),
  updateInstitution: (id: string, payload: InstitutionFormPayload) =>
    platformFetch<InstitutionDetail>(`/v1/platform-admin/institutions/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  listOversightRegions: () => platformFetch<OversightRegionOption[]>("/v1/oversight/regions"),
  listOversightDistricts: (regionId: string) =>
    platformFetch<OversightDistrictOption[]>(`/v1/oversight/regions/${regionId}/districts`),
  deleteInstitution: (id: string) =>
    platformFetch<null>(`/v1/platform-admin/institutions/${id}`, { method: "DELETE" }),
  listOrgMembers: (institutionId: string) =>
    platformFetch<OrgMember[]>(`/v1/platform-admin/institutions/${institutionId}/members`),
  updateOrgMemberRole: (institutionId: string, userId: string, role: string) =>
    platformFetch<OrgMember>(
      `/v1/platform-admin/institutions/${institutionId}/members/${userId}/role?role=${encodeURIComponent(role)}`,
      { method: "PUT" }
    ),

  getProviderQuotas: (providerId: string) =>
    platformFetch<ProviderQuota[]>(`/v1/platform-admin/providers/${providerId}/quotas`),
  /**
   * Audit B-48: the grant endpoint existed on the backend but had no frontend caller, so a
   * provider could never acquire a service package from the UI. The provider id in the path
   * must match institutionId in the body; the backend rejects a mismatch.
   */
  createProviderEntitlement: (providerId: string, data: {
    serviceId: string; maxSeats?: number | null; startsAt?: string; expiresAt?: string
  }) =>
    platformFetch<ProviderQuota>(`/v1/platform-admin/providers/${providerId}/entitlements`, {
      method: "POST", body: JSON.stringify({ institutionId: providerId, ...data }),
    }),
  updateEntitlement: (entitlementId: string, data: { maxSeats?: number; status?: string }) =>
    platformFetch<ProviderQuota>(`/v1/platform-admin/entitlements/${entitlementId}`, { method: "PUT", body: JSON.stringify(data) }),
  grantSponsorSeats: (data: { providerId: string; serviceId: string; userId: string; studentId: string; seats?: number; expiresAt?: string; note?: string }) =>
    platformFetch<{ seatsGranted: number; seatsUsed: number; maxSeats: number | null; entitlementIds: string[] }>(
      "/v1/platform-admin/commerce/sponsor-seats", { method: "POST", body: JSON.stringify(data) }),
  revokeSponsoredEntitlement: (entitlementId: string) =>
    platformFetch<string>(`/v1/platform-admin/commerce/entitlements/${entitlementId}/revoke`, { method: "PUT" }),

  listLiveClasses: (page = 0, size = 20, status?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (status) params.set("status", status)
    return platformFetch<PageResponse<LiveClassSummary>>(`/v1/platform-admin/live-classes?${params}`)
  },

  /** Publication review queue. Platform Admin only; backend enforces ADMIN on every route. */
  listLiveClassReviews: (page = 0, size = 20, publicationStatus?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (publicationStatus) params.set("publicationStatus", publicationStatus)
    return platformFetch<PageResponse<LiveClassGovernanceRecord>>(`/v1/platform-admin/live-classes/governance?${params}`)
  },

  approveLiveClass: (id: string, note?: string) =>
    platformFetch<LiveClassGovernanceRecord>(`/v1/platform-admin/live-classes/governance/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ note: note ?? null }),
    }),

  rejectLiveClass: (id: string, note: string) =>
    platformFetch<LiveClassGovernanceRecord>(`/v1/platform-admin/live-classes/governance/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  publishLiveClass: (id: string) =>
    platformFetch<LiveClassGovernanceRecord>(`/v1/platform-admin/live-classes/governance/${id}/publish`, {
      method: "POST",
    }),

  listPayments: (page = 0, size = 20, status?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (status) params.set("status", status)
    return platformFetch<PageResponse<PaymentSummary>>(`/v1/platform-admin/payments?${params}`)
  },

  /** The eligible balance, asked of the server at the moment it is needed. */
  getRefundableAmount: (paymentId: string) =>
    platformFetch<RefundableAmount>(
      `/v1/platform-admin/bundles/payments/${paymentId}/refundable`
    ),

  /**
   * Requests a partial bundle refund. This records a REQUEST only.
   *
   * The server bounds the amount and owns the lifecycle; the caller supplies no authority of its
   * own, so a rejected amount here is the server refusing rather than a client-side guess.
   */
  requestPartialRefund: (body: {
    paymentId: string
    amount: number
    reason?: string
  }) =>
    platformFetch<RefundRequestSummary>("/v1/platform-admin/bundles/refunds", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listCertificates: (page = 0, size = 20, filters?: {
    search?: string; status?: string; type?: string; institutionId?: string; from?: string; to?: string
  }) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (filters?.search) params.set("search", filters.search)
    if (filters?.status) params.set("status", filters.status)
    if (filters?.type) params.set("type", filters.type)
    if (filters?.institutionId) params.set("institutionId", filters.institutionId)
    if (filters?.from) params.set("from", filters.from)
    if (filters?.to) params.set("to", filters.to)
    return platformFetch<PageResponse<CertificateSummary>>(`/v1/platform-admin/certificates?${params}`)
  },

  getCertificateOverview: () =>
    platformFetch<CertificateOverview>("/v1/platform-admin/certificates/overview"),

  getCertificateDetail: (certificateId: string) =>
    platformFetch<CertificateDetail>(`/v1/platform-admin/certificates/${certificateId}`),

  listCertificateTemplates: (page = 0, size = 50, filters?: { search?: string; type?: string; institutionId?: string }) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (filters?.search) params.set("search", filters.search)
    if (filters?.type) params.set("type", filters.type)
    if (filters?.institutionId) params.set("institutionId", filters.institutionId)
    return platformFetch<PageResponse<PlatformTemplate>>(`/v1/platform-admin/certificate-templates?${params}`)
  },

  createCertificateTemplate: (body: TemplateInput) =>
    platformFetch<PlatformTemplate>("/v1/platform-admin/certificate-templates", {
      method: "POST", body: JSON.stringify(body) }),

  updateCertificateTemplate: (templateId: string, body: TemplateInput) =>
    platformFetch<PlatformTemplate>(`/v1/platform-admin/certificate-templates/${templateId}`, {
      method: "PUT", body: JSON.stringify(body) }),

  setCertificateTemplateStatus: (templateId: string, isActive: boolean) =>
    platformFetch<PlatformTemplate>(`/v1/platform-admin/certificate-templates/${templateId}/status`, {
      method: "PUT", body: JSON.stringify({ isActive }) }),

  getTemplateSignatories: (templateId: string) =>
    platformFetch<Signatory[]>(`/v1/platform-admin/certificate-templates/${templateId}/signatories`),

  replaceTemplateSignatories: (templateId: string, signatoryIds: string[]) =>
    platformFetch<Signatory[]>(`/v1/platform-admin/certificate-templates/${templateId}/signatories`, {
      method: "PUT", body: JSON.stringify({ signatoryIds }) }),

  getTemplateVersions: (templateId: string) =>
    platformFetch<TemplateVersion[]>(`/v1/platform-admin/certificate-templates/${templateId}/versions`),

  listCertificateSignatories: (page = 0, size = 50, filters?: { search?: string; status?: string; institutionId?: string }) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (filters?.search) params.set("search", filters.search)
    if (filters?.status) params.set("status", filters.status)
    if (filters?.institutionId) params.set("institutionId", filters.institutionId)
    return platformFetch<PageResponse<Signatory>>(`/v1/platform-admin/certificate-signatories?${params}`)
  },

  createCertificateSignatory: (body: SignatoryInput) =>
    platformFetch<Signatory>("/v1/platform-admin/certificate-signatories", {
      method: "POST", body: JSON.stringify(body) }),

  updateCertificateSignatory: (signatoryId: string, body: SignatoryInput) =>
    platformFetch<Signatory>(`/v1/platform-admin/certificate-signatories/${signatoryId}`, {
      method: "PUT", body: JSON.stringify(body) }),

  deleteCertificateSignatory: (signatoryId: string) =>
    platformFetch<{ id: string; deleted: boolean; linksRemoved: number }>(
      `/v1/platform-admin/certificate-signatories/${signatoryId}`, { method: "DELETE" }),

  getSecurityEvents: () => platformFetch<SecurityEventItem[]>("/v1/platform-admin/security/events"),
  resolveSecurityEvent: (eventId: string) =>
    platformFetch<SecurityEventItem>(`/v1/platform-admin/security/events/${eventId}/resolve`, { method: "POST" }),

  /**
   * Audit B-49: returns a real PageResponse so callers know the total page count. The endpoint
   * previously returned a bare array, which forced the audit page to guess whether a Next button
   * should be enabled by checking whether the current page happened to be full.
   */
  getAuditLogs: (page = 0, size = 20, action?: string, entityType?: string, entityId?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (action) params.set("action", action)
    if (entityType) params.set("entityType", entityType)
    if (entityId) params.set("entityId", entityId)
    return platformFetch<PageResponse<AuditLogEntry>>(`/v1/platform-admin/audit/logs?${params}`)
  },

  search: (q: string, type?: string) => {
    const params = new URLSearchParams({ q, limit: "20" })
    if (type) params.set("type", type)
    return platformFetch<GlobalSearchResult[]>(`/v1/platform-admin/search?${params}`)
  },

  getEnhancedDashboard: () => platformFetch<EnhancedDashboard>("/v1/platform-admin/dashboard/enhanced"),

  listServices: (page = 0, size = 50, category?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (category) params.set("category", category)
    return platformFetch<PageResponse<ServiceSummary>>(`/v1/platform-admin/services?${params}`)
  },
  createService: (data: { name: string; code: string; description?: string; category: string }) =>
    platformFetch<ServiceSummary>("/v1/platform-admin/services", { method: "POST", body: JSON.stringify(data) }),
  updateService: (id: string, data: Record<string, unknown>) =>
    platformFetch<ServiceSummary>(`/v1/platform-admin/services/${id}`, { method: "PUT", body: JSON.stringify(data) }),

  listIncidents: (page = 0, size = 20, status?: string, severity?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (status) params.set("status", status)
    if (severity) params.set("severity", severity)
    return platformFetch<PageResponse<IncidentSummary>>(`/v1/platform-admin/incidents?${params}`)
  },
  createIncident: (data: { title: string; description?: string; category: string; severity?: string }) =>
    platformFetch<IncidentSummary>("/v1/platform-admin/incidents", { method: "POST", body: JSON.stringify(data) }),
  updateIncidentStatus: (id: string, status: string, notes?: string) => {
    const params = new URLSearchParams({ status })
    if (notes) params.set("notes", notes)
    return platformFetch<IncidentSummary>(`/v1/platform-admin/incidents/${id}/status?${params}`, { method: "PUT" })
  },

  listConfig: (category?: string) => {
    const params = category ? `?category=${category}` : ""
    return platformFetch<PlatformConfigItem[]>(`/v1/platform-admin/config${params}`)
  },
  updateConfig: (key: string, value: string) =>
    platformFetch<PlatformConfigItem>(`/v1/platform-admin/config/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),

  listContactMessages: (params: { page?: number; size?: number; status?: string; q?: string } = {}) => {
    const search = new URLSearchParams()
    search.set("page", String(params.page ?? 0))
    search.set("size", String(params.size ?? 20))
    if (params.status) search.set("status", params.status)
    if (params.q) search.set("q", params.q)
    return platformFetch<PageResponse<ContactMessageRecord>>(
      `/v1/platform-admin/contact-messages?${search.toString()}`)
  },
  getContactMessage: (id: string) =>
    platformFetch<ContactMessageRecord>(`/v1/platform-admin/contact-messages/${id}`),
  updateContactMessageStatus: (id: string, status: ContactMessageStatus) =>
    platformFetch<ContactMessageRecord>(
      `/v1/platform-admin/contact-messages/${id}/status?status=${status}`,
      { method: "PUT" }),
  assignContactMessage: (id: string, assigneeId: string | null) =>
    platformFetch<ContactMessageRecord>(`/v1/platform-admin/contact-messages/${id}/assign`, {
      method: "PUT",
      body: JSON.stringify({ assigneeId }),
    }),
  contactMessageReplies: (id: string) =>
    platformFetch<ContactMessageReply[]>(`/v1/platform-admin/contact-messages/${id}/replies`),
  /**
   * Replies to the enquirer, or records an internal note when `internal` is true.
   *
   * `idempotencyKey` makes a retried send land exactly once, so a double-tap or a timeout that
   * the client retries cannot mail the same person twice.
   */
  replyToContactMessage: (id: string, message: string, internal: boolean, idempotencyKey?: string) =>
    platformFetch<{ id: string; internal: boolean; delivered: boolean }>(
      `/v1/platform-admin/contact-messages/${id}/replies`,
      {
        method: "POST",
        body: JSON.stringify({ message, internal }),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      }),
  /** Re-attempts notification on the same enquiry. Never creates a second ticket. */
  renotifyContactMessage: (id: string) =>
    platformFetch<ContactMessageRecord>(`/v1/platform-admin/contact-messages/${id}/notify`,
      { method: "POST" }),

  listLegalDocuments: (type?: LegalDocType) =>
    platformFetch<LegalDocumentRecord[]>(
      `/v1/platform-admin/legal-documents${type ? `?type=${type}` : ""}`),
  createLegalDocument: (payload: { type: LegalDocType; title: string; content: string; effectiveDate?: string }) =>
    platformFetch<LegalDocumentRecord>("/v1/platform-admin/legal-documents", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateLegalDocument: (
    id: string,
    payload: { title: string; content: string; effectiveDate?: string }) =>
    platformFetch<LegalDocumentRecord>(`/v1/platform-admin/legal-documents/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  publishLegalDocument: (id: string) =>
    platformFetch<LegalDocumentRecord>(`/v1/platform-admin/legal-documents/${id}/publish`,
      { method: "POST" }),
  legalDocumentVersions: (id: string) =>
    platformFetch<LegalVersionRecord[]>(`/v1/platform-admin/legal-documents/${id}/versions`),
revertLegalDocument: (id: string, version: number) =>
    platformFetch<LegalDocumentRecord>(`/v1/platform-admin/legal-documents/${id}/revert`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),

  // ── public news ────────────────────────────────────────────────────────────────────────
  // Lifecycle transitions are separate calls rather than a status field on save, so an ordinary
  // edit can never publish an article by accident.

  listNews: (params: {
    page?: number
    size?: number
    status?: NewsStatus
    category?: string
    featured?: boolean
    q?: string
  } = {}) => {
    const search = new URLSearchParams()
    search.set("page", String(params.page ?? 0))
    search.set("size", String(params.size ?? 20))
    if (params.status) search.set("status", params.status)
    if (params.category) search.set("category", params.category)
    if (params.featured !== undefined) search.set("featured", String(params.featured))
    if (params.q) search.set("q", params.q)
    return platformFetch<PageResponse<NewsArticleRecord>>(`/v1/platform-admin/news?${search.toString()}`)
  },

  getNewsArticle: (id: string) =>
    platformFetch<NewsArticleRecord>(`/v1/platform-admin/news/${id}`),

  createNewsArticle: (payload: NewsArticlePayload) =>
    platformFetch<NewsArticleRecord>("/v1/platform-admin/news", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateNewsArticle: (id: string, payload: NewsArticlePayload) =>
    platformFetch<NewsArticleRecord>(`/v1/platform-admin/news/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  publishNewsArticle: (id: string) =>
    platformFetch<NewsArticleRecord>(`/v1/platform-admin/news/${id}/publish`, { method: "POST" }),

  unpublishNewsArticle: (id: string) =>
    platformFetch<NewsArticleRecord>(`/v1/platform-admin/news/${id}/unpublish`, { method: "POST" }),

  archiveNewsArticle: (id: string) =>
    platformFetch<NewsArticleRecord>(`/v1/platform-admin/news/${id}/archive`, { method: "POST" }),

  setNewsFeatured: (id: string, featured: boolean) =>
    platformFetch<NewsArticleRecord>(`/v1/platform-admin/news/${id}/featured`, {
      method: "POST",
      body: JSON.stringify({ featured }),
    }),

  deleteNewsArticle: (id: string) =>
    platformFetch<void>(`/v1/platform-admin/news/${id}`, { method: "DELETE" }),

  /**
   * Uploads a cover image and returns its public URL.
   *
   * <p>Not JSON: this is multipart, so it bypasses platformFetch rather than being bent to fit
   * its Content-Type. The error is reshaped to match platformFetch's `API <status>: <detail>` form
   * so callers can treat both transports the same way.</p>
   */
  uploadNewsCover: async (file: File): Promise<string> => {
    const token = getToken()
    const institutionId = getInstitutionId()
    const form = new FormData()
    form.append("file", file)

    const headers: Record<string, string> = {}
    if (token) headers["Authorization"] = `Bearer ${token}`
    if (institutionId) headers["X-Institution-Id"] = institutionId

    const res = await fetch(`${API_BASE}/v1/platform-admin/news/cover`, {
      method: "POST",
      headers,
      body: form,
    })
    if (!res.ok) throw new Error(await describeError(res))
    const json = await res.json()
    const data = json.data ?? json
    if (!data?.url) throw new Error("Upload succeeded but no URL was returned")
    return data.url as string
  },

  listNotifications: (page = 0, size = 20) =>
    platformFetch<PageResponse<NotificationSummary>>(`/v1/platform-admin/notifications?page=${page}&size=${size}`),
  sendNotification: (data: { title: string; message: string; notificationType: string; priority?: string; targetAudience?: string }) =>
    platformFetch<NotificationSummary>("/v1/platform-admin/notifications", { method: "POST", body: JSON.stringify(data) }),

  listDelegations: () => platformFetch<DelegationSummary[]>("/v1/platform-admin/delegations"),
  createDelegation: (data: DelegationCreatePayload) =>
    platformFetch<DelegationSummary>("/v1/platform-admin/delegations", { method: "POST", body: JSON.stringify(data) }),
  getDelegation: (id: string) => platformFetch<DelegationDetail>(`/v1/platform-admin/delegations/${id}`),
  approveDelegation: (id: string, reason?: string) =>
    platformFetch<DelegationSummary>(`/v1/platform-admin/delegations/${id}/approve`, { method: "POST", body: JSON.stringify({ reason: reason ?? null }) }),
  rejectDelegation: (id: string, reason: string) =>
    platformFetch<DelegationSummary>(`/v1/platform-admin/delegations/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  extendDelegation: (id: string, expiresAt: string, reason?: string) =>
    platformFetch<DelegationSummary>(`/v1/platform-admin/delegations/${id}/extend`, { method: "PUT", body: JSON.stringify({ expiresAt, reason: reason ?? null }) }),
  delegationVocabulary: () => platformFetch<{ authorities: string[]; permissions: string[] }>("/v1/platform-admin/delegations/authorities"),
  revokeDelegation: (id: string, reason?: string) => {
    const params = reason ? `?reason=${encodeURIComponent(reason)}` : ""
    return platformFetch<string>(`/v1/platform-admin/delegations/${id}/revoke${params}`, { method: "PUT" })
  },

  listProviderRegistry: (params: { search?: string; type?: string; status?: string; verification?: string; page?: number; size?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.search) q.set("search", params.search)
    if (params.type) q.set("type", params.type)
    if (params.status) q.set("status", params.status)
    if (params.verification) q.set("verification", params.verification)
    q.set("page", String(params.page ?? 0)); q.set("size", String(params.size ?? 20))
    return platformFetch<PageResponse<ProviderRegistryItem>>(`/v1/platform-admin/providers/registry?${q}`)
  },
  getProviderGovernance: (id: string) => platformFetch<ProviderGovernanceDetail>(`/v1/platform-admin/providers/${id}/governance`),
  getProviderAttention: () => platformFetch<ProviderAttentionItem[]>("/v1/platform-admin/providers/attention"),
  reviewProviderVerification: (id: string, status: string, notes?: string) => {
    const params = new URLSearchParams({ status })
    if (notes) params.set("notes", notes)
    // Delegation-aware endpoint outside /v1/platform-admin (which is ADMIN-only at URL level)
    return platformFetch<VerificationSummary>(`/v1/verifications/${id}/provider-review?${params}`, { method: "PUT" })
  },
  delegatedTasks: () => platformFetch<DelegatedTask[]>("/v1/verifications/delegated-tasks"),

  listPendingVerifications: () => platformFetch<VerificationSummary[]>("/v1/platform-admin/verifications/pending"),
  submitVerification: (data: { entityType: string; entityId: string; verificationType: string; documents?: string; notes?: string }) =>
    platformFetch<VerificationSummary>("/v1/platform-admin/verifications", { method: "POST", body: JSON.stringify(data) }),
  reviewVerification: (id: string, status: string, notes?: string) => {
    const params = new URLSearchParams({ status })
    if (notes) params.set("notes", notes)
    return platformFetch<VerificationSummary>(`/v1/platform-admin/verifications/${id}/review?${params}`, { method: "PUT" })
  },
  /** Verification-level suspension: the teacher keeps login/profile; publish/delivery is blocked backend-side. */
  suspendTeacherVerification: (userId: string, reason?: string) =>
    platformFetch<VerificationSummary>(`/v1/platform-admin/teachers/${userId}/suspend`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "" }),
    }),
  reactivateTeacherVerification: (userId: string, reason?: string) =>
    platformFetch<VerificationSummary>(`/v1/platform-admin/teachers/${userId}/reactivate`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "" }),
    }),

  listEntitlements: (page = 0, size = 20, status?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (status) params.set("status", status)
    return platformFetch<PageResponse<EntitlementSummary>>(`/v1/platform-admin/entitlements?${params}`)
  },

  listPlatformCourses: (page = 0, size = 20, search?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (search) params.set("search", search)
    return platformFetch<PageResponse<any>>(`/v1/platform-admin/courses?${params}`)
  },
  listPlatformEvents: (page = 0, size = 20, search?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (search) params.set("search", search)
    return platformFetch<PageResponse<any>>(`/v1/platform-admin/events?${params}`)
  },
  createEvent: (payload: EventFormPayload) =>
    platformFetch<any>(`/v1/platform-admin/events`, { method: "POST", body: JSON.stringify(payload) }),
  updateEvent: (id: string, payload: EventFormPayload) =>
    platformFetch<any>(`/v1/platform-admin/events/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteEvent: (id: string) =>
    platformFetch<null>(`/v1/platform-admin/events/${id}`, { method: "DELETE" }),
  publishEvent: (id: string) =>
    platformFetch<any>(`/v1/platform-admin/events/${id}/publish`, { method: "POST" }),
  cancelEvent: (id: string, reason?: string) =>
    platformFetch<any>(`/v1/platform-admin/events/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason || "" }) }),

  listPlatformMedia: (page = 0, size = 20) => platformFetch<PageResponse<any>>(`/v1/platform-admin/media?page=${page}&size=${size}`),
  listPlatformResources: (page = 0, size = 20) => platformFetch<PageResponse<any>>(`/v1/platform-admin/resources?page=${page}&size=${size}`),

  listSupportTickets: (page = 0, size = 20, status?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (status) params.set("status", status)
    return platformFetch<PageResponse<SupportTicket>>(`/v1/platform-admin/support/tickets?${params}`)
  },
  updateSupportTicketStatus: (id: string, status: string) =>
    platformFetch<SupportTicket>(`/v1/platform-admin/support/tickets/${id}/status?status=${status}`, { method: "PUT" }),

  /**
   * Reads one case's conversation — internal notes included.
   *
   * The requester's own read path filters those out, so this is the only surface where staff
   * notes are visible at all.
   */
  listSupportTicketMessages: (ticketId: string) =>
    platformFetch<SupportTicketMessage[]>(`/v1/platform-admin/support/tickets/${ticketId}/messages`),

  /**
   * Posts a reply, or an internal note when `internal` is true.
   *
   * `idempotencyKey` makes a retried send land exactly once. The key is scoped to the admin and
   * to this operation, and reusing it for different content is refused rather than silently
   * returning an earlier, different reply.
   */
  addSupportTicketMessage: (
    ticketId: string,
    message: string,
    internal: boolean,
    idempotencyKey?: string,
  ) =>
    platformFetch<{ id: string; internal: boolean }>(
      `/v1/platform-admin/support/tickets/${ticketId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ message, internal }),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      },
    ),

  listContentReports: (page = 0, size = 20, status?: string) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (status) params.set("status", status)
    return platformFetch<PageResponse<ContentReport>>(`/v1/platform-admin/moderation/reports?${params}`)
  },
  createContentReport: (data: { entityType: string; entityId: string; entityTitle?: string; reporterId?: string; reason: string; description?: string }) =>
    platformFetch<ContentReport>("/v1/platform-admin/moderation/reports", { method: "POST", body: JSON.stringify(data) }),
  actOnContentReport: (id: string, action: string, notes?: string) =>
    platformFetch<ContentReport>(`/v1/platform-admin/moderation/reports/${id}/action`, { method: "PUT", body: JSON.stringify({ action, notes }) }),

  exportPlatformData: async (type: "users" | "institutions" | "audit" = "users"): Promise<void> => {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers["Authorization"] = `Bearer ${token}`
    const res = await fetch(`${API_BASE}/v1/platform-admin/export?type=${type}`, { headers })
    if (!res.ok) throw new Error(await describeError(res))
    const blob = await res.blob()
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `platform_${type}_export.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  },

  // ── BATCH 13 ──

  listIntegrations: () => platformFetch<IntegrationStatus[]>("/v1/platform-admin/integrations"),
  probeIntegration: (key: string) =>
    platformFetch<IntegrationStatus>(`/v1/platform-admin/integrations/${key}/probe`, { method: "POST" }),
  listWebhookEvents: (source?: string, failedOnly = false, page = 0, size = 20) => {
    const params = new URLSearchParams({ page: String(page), size: String(size) })
    if (source) params.set("source", source)
    if (failedOnly) params.set("failedOnly", "true")
    return platformFetch<PageResponse<WebhookEvent>>(`/v1/platform-admin/webhook-events?${params}`)
  },
  getBackupStatus: () => platformFetch<BackupStatus>("/v1/platform-admin/backup/status"),

  listPolicies: () => platformFetch<PolicyFlag[]>("/v1/platform-admin/policies"),
  updatePolicy: (key: string, value: boolean) =>
    platformFetch<PolicyFlag>(`/v1/platform-admin/policies/${key}`, {
      method: "PUT", body: JSON.stringify({ value: String(value) }),
    }),

  getRetentionStatus: () => platformFetch<RetentionStatus>("/v1/platform-admin/data-governance/retention"),
  runRetentionSweep: () =>
    platformFetch<RetentionStatus>("/v1/platform-admin/data-governance/retention/run", { method: "POST" }),
  getDataQuality: () => platformFetch<DataQualityCheck[]>("/v1/platform-admin/data-governance/quality"),

  assignSupportTicket: (ticketId: string, assigneeId: string | null) =>
    platformFetch<SupportTicket>(`/v1/platform-admin/support/tickets/${ticketId}/assign`, {
      method: "PUT", body: JSON.stringify({ assigneeId }),
    }),

  listAdmins: () => platformFetch<AdminAccount[]>("/v1/platform-admin/admins"),
  getRolePermissions: (roleId: string) => platformFetch<string[]>(`/v1/platform-admin/roles/${roleId}/permissions`),
  updateRolePermissions: (roleId: string, permissions: string[]) =>
    platformFetch<string[]>(`/v1/platform-admin/roles/${roleId}/permissions`, {
      method: "PUT", body: JSON.stringify({ permissions }),
    }),
  getAdminPermissions: (userId: string) =>
    platformFetch<string[]>(`/v1/platform-admin/admins/${userId}/permissions`),
  updateAdminPermissions: (userId: string, permissions: string[]) =>
    platformFetch<string[]>(`/v1/platform-admin/admins/${userId}/permissions`, {
      method: "PUT", body: JSON.stringify({ permissions }),
    }),
  createAdmin: (payload: AdminCreatePayload) =>
    platformFetch<AdminAccount>(`/v1/platform-admin/admins`, { method: "POST", body: JSON.stringify(payload) }),
  updateAdmin: (id: string, payload: AdminUpdatePayload) =>
    platformFetch<AdminAccount>(`/v1/platform-admin/admins/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteAdmin: (id: string) =>
    platformFetch<null>(`/v1/platform-admin/admins/${id}`, { method: "DELETE" }),
  updateAdminRole: (id: string, role: string) =>
    platformFetch<AdminAccount>(`/v1/platform-admin/admins/${id}/role`, { method: "PUT", body: JSON.stringify({ role }) }),

  getOffboardingChecklist: (institutionId: string) =>
    platformFetch<OffboardingChecklist>(`/v1/platform-admin/institutions/${institutionId}/offboarding`),

  bulkContentAction: (type: "COURSE" | "EVENT" | "RESOURCE" | "MEDIA", action: "PUBLISH" | "UNPUBLISH" | "ARCHIVE" | "RESTORE", ids: string[]) =>
    platformFetch<{ affected: number; requested: number; failures: string[] }>(
      "/v1/platform-admin/content/bulk-action", { method: "POST", body: JSON.stringify({ type, action, ids }) }),

  getObserverJoinUrl: (liveClassId: string) =>
    platformFetch<{ websocketUrl: string; token: string; liveClassId: string; title: string; institutionName: string; subjectName: string; teacherName: string }>(
      `/v1/oversight/live-classes/${liveClassId}/observe`),

  listFeatures: () => platformFetch<FeatureStatus[]>("/v1/platform-admin/features"),
  updateFeatureStatus: (key: string, status: string) =>
    platformFetch<FeatureStatus>(`/v1/platform-admin/features/${key}/status`, {
      method: "PUT", body: JSON.stringify({ status }),
    }),

  getCommunicationDelivery: () => platformFetch<CommunicationDelivery>("/v1/platform-admin/communications/delivery"),

  listAnalyticsSnapshots: (limit = 20) =>
    platformFetch<AnalyticsSnapshot[]>(`/v1/platform-admin/analytics/snapshots?limit=${limit}`),
  createAnalyticsSnapshot: () =>
    platformFetch<AnalyticsSnapshot>("/v1/platform-admin/analytics/snapshots", { method: "POST" }),

  revokeCertificatePlatform: (certificateId: string, reason?: string) =>
    platformFetch<{ id: string; status: string; serialNumber: string; reason: string | null }>(
      `/v1/platform-admin/certificates/${certificateId}/revoke`,
      { method: "POST", body: JSON.stringify({ reason }) }),

  // ------------------------------------------------------------------
  // Financial command centre - transactions
  //
  // The search and the export take the same filters on purpose: what an operator can see on
  // screen is exactly what they can take away in the file, so a report and its export can never
  // quietly disagree.
  // ------------------------------------------------------------------

  searchFinancialTransactions: (filters: TransactionSearchFilters = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && `${value}` !== "") {
        params.set(key, `${value}`)
      }
    }
    const query = params.toString()
    return platformFetch<PageResponse<FinancialTransaction>>(
      `/v1/platform-admin/financial/transactions${query ? `?${query}` : ""}`,
    )
  },

  /** Returns a path, not bytes: the browser should download it, not parse it in JS. */
  financialTransactionsExportUrl: (filters: TransactionSearchFilters = {}) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      // Paging is meaningless for a file; the backend bounds the export itself.
      if (key === "page" || key === "size" || key === "sortBy" || key === "sortDir") continue
      if (value !== undefined && value !== null && `${value}` !== "") {
        params.set(key, `${value}`)
      }
    }
    const query = params.toString()
    return `${API_BASE}/v1/platform-admin/financial/transactions/export${query ? `?${query}` : ""}`
  },
}
