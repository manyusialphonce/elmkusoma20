import { uploadFile, UploadError, type UploadOptions } from "./upload"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ""

export interface ApiError {
  success: false
  error?: string
  message?: string
  data?: Record<string, string>
  timestamp?: string
}

export interface ApiSuccess<T> {
  success: true
  data: T
  message?: string
  timestamp?: string
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError

function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("elmkusoma_access_token")
}

export function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem("elmkusoma_access_token", accessToken)
  localStorage.setItem("elmkusoma_refresh_token", refreshToken)
}

export function clearTokens() {
  localStorage.removeItem("elmkusoma_access_token")
  localStorage.removeItem("elmkusoma_refresh_token")
  localStorage.removeItem("elmkusoma_current_user")
  localStorage.removeItem("elmkusoma_institution_id")
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("elmkusoma_refresh_token")
}

export function getInstitutionId(): string | null {
  if (typeof window === "undefined") return null
  const stored = localStorage.getItem("elmkusoma_institution_id")
  if (stored) return stored
  try {
    const raw = localStorage.getItem("elmkusoma_current_user")
    if (raw) {
      const user = JSON.parse(raw)
      if (user?.institutionId) return user.institutionId
    }
  } catch {}
  return null
}

export function setInstitutionId(id: string) {
  localStorage.setItem("elmkusoma_institution_id", id)
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const base64 = token.split(".")[1]
    const json = atob(base64.replace(/-/g, "+").replace(/_/g, "/"))
    return JSON.parse(json)
  } catch {
    return null
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const institutionId = getInstitutionId()
  // Audit B-28: a FormData body must keep the browser-generated multipart boundary, so the JSON
  // content type is only set when we actually send JSON.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...((options.headers as Record<string, string>) || {}),
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  if (institutionId) {
    headers["X-Institution-Id"] = institutionId
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  })

  let body: Record<string, unknown>
  try {
    body = await res.json()
  } catch {
    throw new ApiRequestError(
      `Server returned a non-JSON response (HTTP ${res.status}). The service that handles this request ` +
        `may be unavailable - check that it is running, then retry.`,
      res.status,
      null,
    )
  }

  if (!res.ok || body.success === false) {
    const errorMsg = String(body.error || body.message || `Request failed (${res.status})`)
    throw new ApiRequestError(errorMsg, res.status, body)
  }

  return body.data !== undefined ? (body.data as T) : body as T
}

export class ApiRequestError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.body = body
  }
}

async function fetchJSON<T>(path: string, options: RequestInit = {}): Promise<T> {
  return request<T>(path, options)
}

export interface UserInfo {
  id: string
  email: string
  firstName: string
  lastName: string
  fullName?: string
  phone?: string
  role: string
  institutionId: string
  /** School name resolved server-side from the persisted institution; null when unassigned. */
  institutionName?: string | null
  classGroupId: string | null
  learningLevel?: string | null
  secondaryStage?: string | null
  form?: string | null
  regionId?: string | null
  districtId?: string | null
}

export interface AuthResponse {
  accessToken: string | null
  refreshToken: string | null
  tokenType: string
  expiresIn: number
  user: UserInfo | null
  mfaRequired?: boolean
  mfaToken?: string | null
}

export interface RegisterPayload {
  firstName: string
  middleName?: string
  lastName: string
  email: string
  password: string
  phone?: string
  role: string
  learningLevel?: string
  secondaryStage?: string
  form?: string
}

export interface LoginPayload {
  email: string
  password: string
}

export const authApi = {
  register: (data: RegisterPayload) =>
    request<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  login: (data: LoginPayload) =>
    request<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  me: () => request<UserInfo>("/v1/auth/me"),

  forgotPassword: (data: { email: string }) =>
    request<void>("/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  resetPassword: (data: { token: string; newPassword: string }) =>
    request<void>("/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    request<void>("/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  mfaVerify: (data: { mfaToken: string; code: string }) =>
    request<AuthResponse>("/v1/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  mfaEnroll: () =>
    request<{ factorId: string; otpauthUri: string; base32Secret: string; recoveryCodes: string[]; remainingCodes: number }>(
      "/v1/auth/mfa/enroll",
      { method: "POST" },
    ),

  mfaConfirm: (data: { factorId: string; code: string }) =>
    request<void>("/v1/auth/mfa/confirm", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  mfaStatus: () =>
    request<{ enrolled: boolean; remainingCodes: number; recoveryCodes: string[] | null }>(
      "/v1/auth/mfa/status",
    ),

  regenerateRecoveryCodes: () =>
    request<{ enrolled: boolean; remainingCodes: number; recoveryCodes: string[] | null }>(
      "/v1/auth/mfa/codes/regenerate",
      { method: "POST" },
    ),

  revokeAllSessions: () =>
    request<void>("/v1/auth/sessions/revoke-all", { method: "POST" }),

  emergencyRecover: (data: { email: string; recoveryCode: string; newPassword: string }) =>
    request<void>("/v1/auth/emergency-recover", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  verifyEmail: (token: string) =>
    request<void>("/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  serverLogout: (refreshToken: string) =>
    request<void>("/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),

  refresh: (refreshToken: string) =>
    request<AuthResponse>("/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken: string) =>
    request<void>("/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),

  sendVerificationCode: (data: { email: string }) =>
    request<void>("/v1/auth/send-code", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  verifyCode: (data: { email: string; code: string }) =>
    request<void>("/v1/auth/verify-code", {
      method: "POST",
      body: JSON.stringify(data),
    }),
}

// Enrollment API
export interface Enrollment {
  id: string
  studentId: string
  classGroupId: string
  academicYearId: string
  status: "PENDING" | "ENROLLED" | "WITHDRAWN" | "COMPLETED"
  enrolledAt: string
  withdrawnAt?: string
  completedAt?: string
  createdAt: string
}

export const enrollmentApi = {
  list: (page = 0, size = 20) =>
    request<PageResponse<Enrollment>>(`/v1/enrollments?page=${page}&size=${size}`),
byStudent: (studentId: string) =>
request<Enrollment[]>(`/v1/enrollments/student/${studentId}`),
  /** Audit B-22: the caller's own enrollments; the server resolves the student from the JWT. */
  mine: () => request<Enrollment[]>(`/v1/enrollments/me`),
  byClass: (classGroupId: string) =>
    request<Enrollment[]>(`/v1/enrollments/class/${classGroupId}`),
  enroll: (data: { studentId: string; classGroupId: string; academicYearId: string }) =>
    request<Enrollment>("/v1/enrollments", { method: "POST", body: JSON.stringify(data) }),
  updateStatus: (id: string, status: string) =>
    request<Enrollment>(`/v1/enrollments/${id}/status?status=${status}`, { method: "PUT" }),
  transfer: (id: string, data: { toClassGroupId: string; reason?: string }) =>
    request<{ id: string }>(`/v1/enrollments/${id}/transfer`, { method: "POST", body: JSON.stringify(data) }),
}

// Learning API
export interface Lesson {
  id: string
  subjectId: string
  classGroupId: string
  title: string
  description?: string
  contentText?: string
  videoUrl?: string
  fileAttachments?: string
  sortOrder: number
  isPublished: boolean
  createdAt: string
  subjectName?: string
}

export interface LessonProgress {
  id: string
  lessonId: string
  studentId: string
  completionPercentage: number
  startedAt?: string
  completedAt?: string
  createdAt: string
}

export interface Assignment {
  id: string
  subjectId: string
  classGroupId: string
  title: string
  description?: string
  dueDate?: string
  totalMarks: number
  attachments?: string
  createdAt: string
}

export interface AssignmentSubmission {
  id: string
  assignmentId: string
  studentId: string
  studentName?: string
  /** @deprecated legacy field name; backend returns {@link submissionText}. */
  content?: string
  /** Learner's typed answer body (assignment_submissions.submission_text). */
  submissionText?: string
  fileUrl?: string
  submittedAt?: string
  grade?: number
  feedback?: string
  gradedAt?: string
  gradedBy?: string
  status?: "DRAFT" | "SUBMITTED" | "GRADED" | string
  isDraft?: boolean
  isLate?: boolean
  createdAt: string
}

export const learningApi = {
  getLessons: (subjectId: string, classGroupId: string) =>
    request<Lesson[]>(`/v1/learning/lessons/subject/${subjectId}/class/${classGroupId}`),
  getLessonsByClass: (classGroupId: string) =>
    request<Lesson[]>(`/v1/learning/lessons/class/${classGroupId}`),
  createLesson: (data: Partial<Lesson>) =>
    request<Lesson>("/v1/learning/lessons", { method: "POST", body: JSON.stringify(data) }),
  updateProgress: (lessonId: string, completionPercentage: number) =>
    request<LessonProgress>("/v1/learning/progress", { method: "POST", body: JSON.stringify({ lessonId, completionPercentage }) }),
  getStudentProgress: (studentId: string) =>
    request<LessonProgress[]>(`/v1/learning/progress/student/${studentId}`),
  getAssignments: (classGroupId: string) =>
    request<Assignment[]>(`/v1/learning/assignments/class/${classGroupId}`),
  /** Batch: assignments across many classes in one request (teacher workspace). */
  getAssignmentsByClasses: (classGroupIds: string[]) =>
    request<Assignment[]>(`/v1/learning/assignments/classes?ids=${classGroupIds.join(",")}`),
  createAssignment: (data: Partial<Assignment>) =>
    request<Assignment>("/v1/learning/assignments", { method: "POST", body: JSON.stringify(data) }),
  submitAssignment: (
    assignmentId: string,
    data?: { submissionText?: string; content?: string; fileUrl?: string; draft?: boolean }
  ) =>
    request<AssignmentSubmission>(`/v1/learning/assignments/${assignmentId}/submit`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  getMySubmission: async (assignmentId: string) => {
    const res = await request<AssignmentSubmission | null>(
      `/v1/learning/assignments/${assignmentId}/my-submission`
    )
    // "None yet" is a 200 without a `data` field, which request() falls back to
    // (the envelope). Only trust a payload that is an actual submission entity.
    return res && typeof res === "object" && "id" in res ? res : null
  },
  getSubmissions: (assignmentId: string) =>
    request<AssignmentSubmission[]>(`/v1/learning/assignments/${assignmentId}/submissions`),
  gradeSubmission: (submissionId: string, grade: number, feedback?: string) => {
    const params = new URLSearchParams({ grade: String(grade) })
    if (feedback) params.set("feedback", feedback)
    return request<AssignmentSubmission>(`/v1/learning/submissions/${submissionId}/grade?${params}`, { method: "PUT" })
  },
}

// Assessment API
export interface Assessment {
  id: string
  subjectId: string
  classGroupId: string
  title: string
  description?: string
  timeLimitMinutes?: number
  totalMarks: number
  passMarks: number
  isPublished: boolean
  startsAt?: string
  endsAt?: string
  createdAt: string
}

export interface Question {
  id: string
  assessmentId: string
  questionType: "MCQ" | "TRUE_FALSE" | "SHORT_ANSWER" | "ESSAY"
  questionText: string
  marks: number
  sortOrder: number
  options: Option[]
}

export interface Option {
  id: string
  questionId: string
  optionText: string
  isCorrect: boolean
  sortOrder: number
}

export interface Attempt {
  id: string
  assessmentId: string
  studentId: string
  startedAt: string
  submittedAt?: string
  isCompleted: boolean
  answers?: Answer[]
  result?: AssessmentResult
}

export interface Answer {
  id: string
  attemptId: string
  questionId: string
  selectedOptionId?: string
  textAnswer?: string
  isCorrect?: boolean
  marksObtained?: number
}

export interface AssessmentResult {
  id: string
  assessmentId: string
  studentId: string
  attemptId: string
  totalScore: number
  isPassed: boolean
  gradedAt?: string
  feedback?: string
}

export const assessmentApi = {
  getByClass: (classGroupId: string) =>
    request<Assessment[]>(`/v1/assessments/class/${classGroupId}`),
  /** Batch: assessments across many classes in one request (teacher workspace). */
  getByClasses: (classGroupIds: string[]) =>
    request<Assessment[]>(`/v1/assessments/classes?ids=${classGroupIds.join(",")}`),
  getBySubject: (subjectId: string) =>
    request<Assessment[]>(`/v1/assessments/subject/${subjectId}`),
  create: (data: Partial<Assessment>) =>
    request<Assessment>("/v1/assessments", { method: "POST", body: JSON.stringify(data) }),
  /** Update an assessment — including publish/unpublish (makes it visible to learners). */
  update: (id: string, data: Partial<Assessment>) =>
    request<Assessment>(`/v1/assessments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  getQuestions: (assessmentId: string) =>
    request<Question[]>(`/v1/assessments/${assessmentId}/questions`),
  addQuestion: (assessmentId: string, data: Partial<Question>) =>
    request<Question>(`/v1/assessments/${assessmentId}/questions`, { method: "POST", body: JSON.stringify(data) }),
  startAttempt: (assessmentId: string) =>
    request<Attempt>(`/v1/assessments/${assessmentId}/start`, { method: "POST" }),
  /** Resume: returns the learner's attempt (with autosaved answers) or 404/empty. */
  getMyAttempt: async (assessmentId: string) => {
    const res = await request<Attempt | null>(`/v1/assessments/${assessmentId}/my-attempt`)
    // "No attempt yet" is a 200 without `data` — request() would fall back to the
    // envelope object (truthy). Only accept a real attempt entity (has an id).
    return res && typeof res === "object" && "id" in res ? res : null
  },
  /** Autosave one answer (upsert server-side; never grades until submit). */
  saveAnswer: (attemptId: string, answer: { questionId: string; selectedOptionId?: string; textAnswer?: string }) =>
    request<Attempt>(`/v1/assessments/attempts/${attemptId}/answers`, {
      method: "PUT",
      body: JSON.stringify(answer),
    }),
  submitAttempt: (attemptId: string, answers: Array<{ questionId: string; selectedOptionId?: string; textAnswer?: string }>) =>
    request<Attempt>(`/v1/assessments/attempts/${attemptId}/submit`, { method: "POST", body: JSON.stringify({ answers }) }),
  getResults: (assessmentId: string) =>
    request<AssessmentResult[]>(`/v1/assessments/${assessmentId}/results`),
  getResult: (assessmentId: string, studentId: string) =>
    request<AssessmentResult>(`/v1/assessments/${assessmentId}/results/student/${studentId}`),
}

export interface NotificationItem {
  id: string
  title: string
  message: string
  notificationType: string
  targetType: string | null
  targetId: string | null
  isRead: boolean
  createdAt: string
}

// Notifications — NotificationController allows EVERY role
// (STUDENT, OTHER_LEARNER, TEACHER, ADMIN, INSTITUTION_ADMIN, PARENT,
// NATIONAL_ADMIN, REGIONAL_ADMIN, DISTRICT_ADMIN), so the topbar bell can
// poll one endpoint for all of them (Nationaladmin.md §23).
export const notificationsApi = {
  getUnreadCount: () => request<{ count: number }>("/v1/notifications/unread-count"),
  list: () => request<NotificationItem[]>("/v1/notifications"),
  markRead: (id: string) => request<void>(`/v1/notifications/${id}/read`, { method: "PUT" }),
  markAllRead: () => request<void>("/v1/notifications/read-all", { method: "PUT" }),
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

// ── Academic API ─────────────────────────────────────────────────

export interface AcademicYear {
  id: string
  institutionId: string
  educationLevel: string
  yearLabel: string
  startDate: string
  endDate: string
  isCurrent: boolean
  isActive: boolean
  createdAt: string
}

export interface Term {
  id: string
  institutionId: string
  academicYearId: string
  name: string
  termNumber: number
  startDate: string
  endDate: string
  isActive: boolean
  createdAt: string
}

export interface Grade {
  id: string
  institutionId: string
  educationLevel: string
  name: string
  code?: string
  sortOrder: number
  isActive: boolean
  createdAt: string
}

export interface Subject {
  id: string
  institutionId: string
  educationLevel: string
  name: string
  code?: string
  description?: string
  category?: string
  isActive: boolean
  createdAt: string
}

export interface ClassGroup {
  id: string
  institutionId: string
  gradeId: string
  academicYearId: string
  termId: string
  name: string
  section?: string
  capacity?: number
  classTeacherId?: string
  isActive: boolean
  createdAt: string
}

export const academicApi = {
  // Academic Years
  getAcademicYears: (institutionId: string, educationLevel?: string) => {
    const params = new URLSearchParams({ institutionId })
    if (educationLevel) params.set("educationLevel", educationLevel)
    return request<AcademicYear[]>(`/v1/academic/years?${params}`)
  },
  getAcademicYear: (id: string) =>
    request<AcademicYear>(`/v1/academic/years/${id}`),
  createAcademicYear: (data: {
    institutionId: string
    educationLevel: string
    yearLabel: string
    startDate: string
    endDate: string
    isCurrent?: boolean
  }) =>
    request<AcademicYear>("/v1/academic/years", { method: "POST", body: JSON.stringify(data) }),

  // Terms
  getTerms: (academicYearId: string) =>
    request<Term[]>(`/v1/academic/years/${academicYearId}/terms`),
  createTerm: (academicYearId: string, data: {
    institutionId: string
    name: string
    termNumber: number
    startDate: string
    endDate: string
  }) =>
    request<Term>(`/v1/academic/years/${academicYearId}/terms`, { method: "POST", body: JSON.stringify(data) }),

  // Grades
  getGrades: (institutionId: string, educationLevel?: string) => {
    const params = new URLSearchParams({ institutionId })
    if (educationLevel) params.set("educationLevel", educationLevel)
    return request<Grade[]>(`/v1/academic/grades?${params}`)
  },
  getGrade: (id: string) =>
    request<Grade>(`/v1/academic/grades/${id}`),
  createGrade: (data: {
    institutionId: string
    educationLevel: string
    name: string
    code?: string
    sortOrder?: number
  }) =>
    request<Grade>("/v1/academic/grades", { method: "POST", body: JSON.stringify(data) }),

  // Subjects
  getSubjects: (institutionId: string, educationLevel?: string) => {
    const params = new URLSearchParams({ institutionId })
    if (educationLevel) params.set("educationLevel", educationLevel)
    return request<Subject[]>(`/v1/academic/subjects?${params}`)
  },
  getSubject: (id: string) =>
    request<Subject>(`/v1/academic/subjects/${id}`),
  createSubject: (data: {
    institutionId: string
    educationLevel: string
    name: string
    code?: string
    description?: string
  }) =>
    request<Subject>("/v1/academic/subjects", { method: "POST", body: JSON.stringify(data) }),

  // Class Groups
  getClassGroups: (institutionId: string, gradeId?: string, termId?: string) => {
    const params = new URLSearchParams({ institutionId })
    if (gradeId) params.set("gradeId", gradeId)
    if (termId) params.set("termId", termId)
    return request<ClassGroup[]>(`/v1/academic/classes?${params}`)
  },
  getClassGroup: (id: string) =>
    request<ClassGroup>(`/v1/academic/classes/${id}`),
  createClassGroup: (data: {
    institutionId: string
    gradeId: string
    academicYearId: string
    termId: string
    name: string
    section?: string
    capacity?: number
  }) =>
    request<ClassGroup>("/v1/academic/classes", { method: "POST", body: JSON.stringify(data) }),
}

// ── Student API ──────────────────────────────────────────────────

export interface Student {
  id: string
  userId: string
  institutionId: string
  admissionNumber: string
  status: string
  firstName: string
  middleName?: string
  lastName: string
  email: string
  phone?: string
  dateOfBirth?: string
  gender?: string
  address?: string
  city?: string
  region?: string
  guardianName?: string
  guardianPhone?: string
  guardianRelationship?: string
  enrollmentDate: string
  createdAt: string
}

export interface StudentClassAssignment {
  id: string
  institutionId: string
  studentId: string
  classGroupId: string
  academicYearId: string
  termId: string
  assignedDate: string
  isActive: boolean
  createdAt: string
}

export const studentApi = {
  getStudents: (institutionId: string, classId?: string, query?: string) => {
    const params = new URLSearchParams({ institutionId })
    if (classId) params.set("classId", classId)
    if (query) params.set("query", query)
    return request<Student[]>(`/v1/students?${params}`)
  },
  getStudent: (id: string) =>
    request<Student>(`/v1/students/${id}`),
  getStudentByAdmission: (admissionNumber: string) =>
    request<Student>(`/v1/students/admission/${admissionNumber}`),
  createStudent: (data: {
    institutionId: string
    userId: string
    firstName: string
    middleName?: string
    lastName: string
    email: string
    phone?: string
    dateOfBirth?: string
    gender?: string
    address?: string
    city?: string
    region?: string
    guardianName?: string
    guardianPhone?: string
    guardianRelationship?: string
  }) =>
    request<Student>("/v1/students", { method: "POST", body: JSON.stringify(data) }),
  updateStudent: (id: string, data: Partial<{
    firstName: string
    middleName: string
    lastName: string
    phone: string
    dateOfBirth: string
    gender: string
    address: string
    city: string
    region: string
    guardianName: string
    guardianPhone: string
    guardianRelationship: string
    status: string
  }>) =>
    request<Student>(`/v1/students/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  assignClass: (id: string, data: {
    classGroupId: string
    academicYearId: string
    termId: string
  }) =>
    request<StudentClassAssignment>(`/v1/students/${id}/assign-class`, { method: "POST", body: JSON.stringify(data) }),
  countStudents: (institutionId: string) =>
    request<number>(`/v1/students/stats/count?institutionId=${institutionId}`),
  countActiveStudents: (institutionId: string) =>
    request<number>(`/v1/students/stats/active?institutionId=${institutionId}`),
}

// ---------------------------------------------------------------------------
// Certificate API
// ---------------------------------------------------------------------------

export interface TemplateResponse {
  id: string
  institutionId: string
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
  createdAt: string
  updatedAt: string
}

export interface CertificateResponse {
  id: string
  institutionId: string
  templateId: string
  studentId: string
  issuedBy: string | null
  serialNumber: string
  certificateType: string
  title: string
  courseTitle: string | null
  description: string | null
  studentName: string
  studentIdNumber: string | null
  courseOrProgramme: string | null
  instructorName: string | null
  grade: string | null
  skills: string[]
  completionDate: string
  issueDate: string | null
  expiryDate: string | null
  status: string
  verificationCode: string
  verificationUrl: string | null
  qrCodeUrl: string | null
  revokedReason: string | null
  revokedAt: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface CertificateVerificationResponse {
  valid: boolean
  id: string | null
  serialNumber: string | null
  studentName: string | null
  certificateType: string | null
  title: string | null
  courseTitle: string | null
  instructorName: string | null
  grade: string | null
  skills: string[]
  completionDate: string | null
  institutionName: string | null
  issuedBy: string | null
  issueDate: string | null
  status: string | null
  message: string | null
  /**
   * Serial of the certificate that took this award's place, when the one presented has been
   * replaced by a re-issue. Null for a certificate nobody has replaced.
   *
   * Present so a holder turning up with the withdrawn copy is told which document is current,
   * not merely that theirs is worthless.
   */
  supersededBySerialNumber: string | null
  supersededAt: string | null
}

/**
 * The gate a decision satisfies. Mirrors CertificateApproval.ApprovalStage on the server.
 *
 * TRAINING   - the award was prepared correctly. Always required.
 * VALIDATION - evidence was checked. Required for the academic family only.
 * APPROVAL   - the institution authorises release. Always required.
 */
export type CertificateApprovalStage = "PREPARATION" | "VALIDATION" | "APPROVAL"

export type CertificateDecisionStatus = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN"

export interface CertificateApprovalResponse {
  id: string
  certificateId: string
  certificateSerialNumber: string | null
  certificateTitle: string | null
  certificateType: string | null
  certificateStatus: string | null
  studentName: string | null
  stage: CertificateApprovalStage
  decisionStatus: CertificateDecisionStatus
  actorUserId: string | null
  actorEmail: string | null
  actorRole: string | null
  templateVersion: number | null
  reason: string | null
  decidedAt: string | null
  createdAt: string
}

/** The certificate lifecycle, including the review states added by V161. */
export type CertificateLifecycleStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "ISSUED"
  | "REVOKED"

export interface TranscriptEntryResponse {
  id: string
  subjectName: string
  subjectCode: string | null
  score: number | null
  grade: string | null
  remarks: string | null
}

export interface TranscriptResponse {
  id: string
  institutionId: string
  studentId: string
  issuedBy: string | null
  serialNumber: string
  academicYear: string | null
  term: string | null
  status: string
  totalSubjects: number | null
  averageScore: number | null
  classRank: number | null
  remarks: string | null
  generatedAt: string
  issuedAt: string | null
  entries: TranscriptEntryResponse[]
  createdAt: string
}

export interface CreateTemplateRequest {
  name: string
  description?: string
  templateType: string
  htmlContent?: string
  cssContent?: string
  logoUrl?: string
  signatureLine1?: string
  signatureLine2?: string
  signatureLine3?: string
}

export interface GenerateCertificateRequest {
  templateId: string
  studentId: string
  certificateType: string
  title: string
  description?: string
  studentName: string
  studentIdNumber?: string
  courseOrProgramme?: string
  instructorName?: string
  grade?: string
  skills?: string[]
  completionDate: string
  expiryDate?: string
}

export interface GenerateTranscriptRequest {
  studentId: string
  academicYear?: string
  term?: string
  entries?: { subjectName: string; subjectCode?: string; score?: number; grade?: string; remarks?: string }[]
  remarks?: string
}

export const certificateApi = {
  listTemplates: () =>
    request<TemplateResponse[]>("/v1/certificates/templates"),

  getTemplate: (templateId: string) =>
    request<TemplateResponse>(`/v1/certificates/templates/${templateId}`),

  createTemplate: (data: CreateTemplateRequest) =>
    request<TemplateResponse>("/v1/certificates/templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  generate: (data: GenerateCertificateRequest) =>
    request<CertificateResponse>("/v1/certificates/generate", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  issue: (certificateId: string) =>
    request<CertificateResponse>(`/v1/certificates/${certificateId}/issue`, {
      method: "POST",
    }),

  revoke: (certificateId: string, reason: string) =>
    request<CertificateResponse>(`/v1/certificates/${certificateId}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  verify: (verificationCode: string) =>
    request<CertificateVerificationResponse>(`/v1/certificates/verify/${verificationCode}`),

  /**
   * Streams the rendered document for one certificate and hands it to the browser's download
   * dialog.
   *
   * <p>Not built on {@link request}: that helper assumes a JSON envelope and would choke on a
   * PDF body, and the file name arrives in {@code Content-Disposition}, which needs reading from
   * the response before anything is written to disk.</p>
   */
  downloadPdf: async (certificateId: string, fallbackName = "certificate.pdf"): Promise<void> => {
    const headers: Record<string, string> = {}
    const token = getToken()
    const institutionId = getInstitutionId()
    if (token) headers["Authorization"] = `Bearer ${token}`
    if (institutionId) headers["X-Institution-Id"] = institutionId

    const res = await fetch(
      `${API_BASE_URL}/v1/certificates/${encodeURIComponent(certificateId)}/pdf`,
      { headers },
    )
    if (!res.ok) {
      let message = `Request failed (HTTP ${res.status})`
      try {
        const body = (await res.json()) as { error?: string; message?: string }
        message = body.error || body.message || message
      } catch {
        // A non-JSON body here means the endpoint is not the one we called; the status is the
        // only useful information left, so keep it.
      }
      throw new ApiRequestError(message, res.status, null)
    }

    const disposition = res.headers.get("Content-Disposition") || ""
    const match = disposition.match(/filename="?([^";]+)"?/)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = match?.[1] || fallbackName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  // ── Approval workflow ───────────────────────────────────────────────────────────────
  //
  // Issuance is gated on approvals, so these are what make a certificate reviewable at all.
  // Before them there was no way to move a certificate past DRAFT except to issue it directly.

  /** Moves a DRAFT certificate into review, recording the PREPARATION decision. */
  submitForApproval: (certificateId: string) =>
    request<CertificateResponse>(`/v1/certificates/${certificateId}/submit-for-approval`, {
      method: "POST",
    }),

  /**
   * Records an approve/reject decision for one stage.
   *
   * <p>A rejection requires a reason server-side; the UI enforces it too so the operator is not
   * told "a reason is required" only after the fact.</p>
   */
  decideApproval: (
    certificateId: string,
    stage: CertificateApprovalStage,
    approved: boolean,
    reason?: string,
  ) =>
    request<CertificateResponse>(
      `/v1/certificates/${certificateId}/approvals/${stage}`,
      {
        method: "POST",
        body: JSON.stringify({ approved, reason: reason ?? null }),
      },
    ),

  /** Withdraws a previously granted approval, returning the certificate to review. */
  withdrawApproval: (certificateId: string, stage: CertificateApprovalStage, reason: string) =>
    request<CertificateResponse>(
      `/v1/certificates/${certificateId}/approvals/${stage}/withdraw`,
      {
        method: "POST",
        body: JSON.stringify({ reason }),
      },
    ),

  /** The full decision history for one certificate, including refused and withdrawn decisions. */
  approvalHistory: (certificateId: string) =>
    request<CertificateApprovalResponse[]>(`/v1/certificates/${certificateId}/approvals`),

  /** Outstanding approval work for the caller's institution, oldest first. */
  approvalQueue: () =>
    request<CertificateApprovalResponse[]>("/v1/certificates/approval-queue"),

  get: (certificateId: string) =>
    request<CertificateResponse>(`/v1/certificates/${certificateId}`),

  /**
   * Certificates for one student, or (staff only) the whole institution.
   *
   * <p>A learner must name their own student id. Omitting it is an institution-wide view and is
   * refused for learner roles server-side, because the unfiltered branch returns every certificate
   * in the school.</p>
   */
  list: async (studentId?: string): Promise<CertificateResponse[]> => {    const params = studentId ? `?studentId=${studentId}` : ""
    const payload = await request<CertificateResponse[] | PageResponse<CertificateResponse>>(
      `/v1/certificates${params}`,
    )
    // GET /v1/certificates answers with a Spring Page envelope
    // ({ content, totalElements, ... }); callers expect a plain array, so unwrap
    // here instead of guarding at every call site.
    if (Array.isArray(payload)) return payload
    return Array.isArray(payload?.content) ? payload.content : []
  },

  generateTranscript: (data: GenerateTranscriptRequest) =>
    request<TranscriptResponse>("/v1/certificates/transcripts/generate", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  issueTranscript: (transcriptId: string) =>
    request<TranscriptResponse>(`/v1/certificates/transcripts/${transcriptId}/issue`, {
      method: "POST",
    }),

  listTranscripts: (studentId: string) =>
    request<TranscriptResponse[]>(`/v1/certificates/transcripts?studentId=${studentId}`),
}

// ---------------------------------------------------------------------------
// Administration API
// ---------------------------------------------------------------------------

export interface DashboardResponse {
  institutionId: string
  totalStudents: number
  totalTeachers: number
  totalParents: number
  activeStudents: number
  certificatesIssued: number
  pendingImportJobs: number
  totalCourses: number
  publishedCourses: number
  draftCourses: number
  totalModules: number
  totalLessons: number
  liveClassesScheduled: number
  additionalStats: Record<string, unknown>
}

export interface Course {
  id: string
  institutionId: string
  subjectId: string | null
  subjectName: string | null
  title: string
  description: string | null
  thumbnailUrl: string | null
  level: string
  category: string | null
  isPublished: boolean
  isFeatured: boolean
  createdByName: string | null
  moduleCount: number
  lessonCount: number
  createdAt: string
  updatedAt: string
}

export interface CourseModule {
  id: string
  courseId: string
  title: string
  /** Programme-style module code; optional, so provider courses need not carry one. */
  moduleCode?: string | null
  description: string | null
  sortOrder: number
  lessonCount: number
  createdAt: string
}

export interface CourseLesson {
  id: string
  moduleId: string
  title: string
  contentType: string
  contentUrl: string | null
  durationMinutes: number | null
  sortOrder: number
  isFree: boolean
  createdAt: string
}

export interface CourseStats {
  totalCourses: number
  publishedCourses: number
  draftCourses: number
  featuredCourses: number
  totalModules: number
  totalLessons: number
  liveClassesScheduled: number
  liveClassesCompleted: number
  coursesByLevel: Record<string, number>
}

export interface SettingResponse {
  id: string
  institutionId: string
  settingKey: string
  settingValue: Record<string, unknown>
  settingType: string | null
  description: string | null
  isPublic: boolean
  createdAt: string
  updatedAt: string
}

export interface RoleResponse {
  id: string
  institutionId: string
  name: string
  displayName: string
  description: string | null
  isSystemRole: boolean
  isActive: boolean
  permissions: string[]
  createdAt: string
}

export interface ImportJobResponse {
  id: string
  institutionId: string
  importedBy: string
  importType: string
  fileName: string
  status: string
  totalRows: number | null
  processedRows: number | null
  successfulRows: number | null
  failedRows: number | null
  errorLog: Record<string, unknown> | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

export interface CreateRoleRequest {
  name: string
  displayName: string
  description?: string
  permissions?: string[]
}

export interface SettingRequest {
  settingKey: string
  settingValue: Record<string, unknown>
  settingType?: string
  description?: string
  isPublic?: boolean
}

export interface QuickAction {
  id: string
  label: string
  icon: string
  actionUrl: string
  requiredPermission: string
  available: boolean
}

export interface WorkQueueItem {
  type: string
  label: string
  count: number
  actionUrl: string
}

export interface WorkQueueSummary {
  pendingApprovals: number
  pendingReviews: number
  pendingVerifications: number
  queueUrl: string
  items?: WorkQueueItem[]
}

export interface HealthMetric {
  name: string
  status: string
  value: string
  threshold: string
}

export interface OrganizationHealthSummary {
  overallStatus: string
  metrics: HealthMetric[]
  lastChecked: string
}

export interface EnhancedDashboardResponse {
  institutionId: string
  institutionName: string
  institutionType: string
  currentUserRole?: string
  userPermissions?: string[]
  totalStudents: number
  totalTeachers: number
  totalParents: number
  activeStudents: number
  certificatesIssued: number
  pendingImportJobs: number
  totalCourses: number
  publishedCourses: number
  draftCourses: number
  totalModules: number
  totalLessons: number
  liveClassesScheduled: number
  liveClassesLiveNow?: number
  upcomingLiveClasses?: number
  pendingInvitations: number
  unreadNotifications: number
  enabledServices: string[]
  recentActivity: { type: string; title: string; description: string; timestamp: string }[]
  attentionItems: {
    type: string
    title: string
    description: string
    count: number
    severity?: string
    actionUrl: string
    actionLabel?: string
  }[]
  quickActions?: QuickAction[]
  workQueueSummary?: WorkQueueSummary
  healthSummary?: OrganizationHealthSummary
}

export interface GlobalSearchResult {
  type: string
  id: string
  title: string
  subtitle: string
}

export interface MyAccessScope {
  type: string
  id: string | null
}

export interface MyAccessOrganization {
  id: string
  name: string
  type: string | null
  logoUrl: string | null
  active: boolean
  current: boolean
}

export interface MyAccessDelegation {
  id: string
  scope: string
  status: string
  permissions: string[]
  startsAt: string | null
  expiresAt: string | null
}

export interface MyAccessResponse {
  userId: string
  userEmail: string
  systemRole: string
  membershipRole: string | null
  membershipStatus: string
  membershipActive: boolean
  institutionId: string | null
  institutionName: string | null
  institutionType: string | null
  institutionActive: boolean | null
  scope: MyAccessScope | null
  permissions: string[]
  organizations: MyAccessOrganization[]
  delegations: MyAccessDelegation[]
}

export interface InstitutionServiceItem {
  id: string
  institutionId: string
  featureKey: string
  featureName: string
  status: string
  enabled: boolean
  configuration: string | null
  enabledAt: string | null
  enabledBy: string | null
  description: string
}

export interface PlatformFeatureItem {
  key: string
  name: string
  status: string
  description: string
  updatedAt?: string
}

export interface OrgProfileResponse {
  id: string
  name: string
  code: string
  type: string
  description: string
  address: string
  city: string
  region: string
  regionId: string
  districtId: string
  country: string
  phone: string
  email: string
  website: string
  logoUrl: string
  bannerUrl: string
  motto: string
  foundedYear: number
  totalCapacity: number
  isActive: boolean
  approvedAt: string
  createdAt: string
  enabledServices: string[]
  peopleSummary: {
    totalUsers: number
    totalTeachers: number
    totalStudents: number
    totalParents: number
    activeUsers: number
    pendingInvitations: number
  }
  activitySummary: {
    unreadNotifications: number
    recentActivity: { id: string; actorName: string; activityType: string; title: string; description: string; createdAt: string }[]
  }
}

export interface UpdateOrgProfileRequest {
  name?: string
  description?: string
  address?: string
  city?: string
  region?: string
  phone?: string
  email?: string
  website?: string
  logoUrl?: string
  bannerUrl?: string
  motto?: string
  foundedYear?: number
  totalCapacity?: number
}

export interface PeopleMemberResponse {
  userId: string
  email: string
  firstName: string
  middleName: string
  lastName: string
  fullName: string
  phone: string
  membershipRole: string
  isActive: boolean
  isEmailVerified: boolean
  profileImageUrl: string
  memberSince: string
}

export interface InviteUserRequest {
  email: string
  role: string
  firstName?: string
  lastName?: string
}

export interface InvitationResponse {
  id: string
  email: string
  role: string
  status: string
  expiresAt: string
  createdAt: string
}

export interface InstitutionAuditLogResponse {
  id: string
  actorEmail: string
  actorRole: string
  action: string
  targetType: string
  targetId: string
  details: string
  ipAddress: string
  createdAt: string
}

// --- Live session monitoring (AdminLiveSessionController / LiveSessionHealthController) ---
export interface ActiveLiveSession {
  id: string
  title: string
  teacherId: string | null
  scheduledAt: string
  durationMinutes: number | null
  maxParticipants: number | null
  currentParticipants: number
  status: string
}

export interface LiveSessionStats {
  totalSessions: number
  scheduled: number
  inProgress: number
  completed: number
}

export interface SessionParticipant {
  userId: string
  userName: string
  role: string
  joinedAt: string | null
  leftAt: string | null
  durationSeconds: number | null
  online: boolean
}

export interface LiveSessionHealth {
  service: string
  liveKitConfigured: boolean
  mode: "full" | "chat-only"
  status: "OPERATIONAL" | "DEGRADED"
  message: string
}

export interface LiveSessionIssue {
  id: string
  liveClassId: string
  classTitle: string | null
  issueType: string
  description: string | null
  severity: string
  status: string
  userId: string
  reportedBy: string
  createdAt: string | null
}

export const adminApi = {
  getDashboard: (institutionId: string) =>
    request<DashboardResponse>(`/v1/admin/dashboard?institutionId=${institutionId}`),

  listSettings: (institutionId: string) =>
    request<SettingResponse[]>(`/v1/admin/settings?institutionId=${institutionId}`),

  getSetting: (institutionId: string, key: string) =>
    request<SettingResponse>(`/v1/admin/settings/${key}?institutionId=${institutionId}`),

  updateSetting: (institutionId: string, data: SettingRequest) =>
    request<SettingResponse>(`/v1/admin/settings?institutionId=${institutionId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  createRole: (institutionId: string, data: CreateRoleRequest) =>
    request<RoleResponse>(`/v1/admin/roles?institutionId=${institutionId}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listRoles: (institutionId: string) =>
    request<RoleResponse[]>(`/v1/admin/roles?institutionId=${institutionId}`),

  getRole: (institutionId: string, roleId: string) =>
    request<RoleResponse>(`/v1/admin/roles/${roleId}?institutionId=${institutionId}`),

  /** B-57: roles could be created and deleted but never edited, so a role's permission set was frozen. */
  updateRole: (institutionId: string, roleId: string, data: CreateRoleRequest) =>
    request<RoleResponse>(`/v1/admin/roles/${roleId}?institutionId=${institutionId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteRole: (institutionId: string, roleId: string) =>
    request<void>(`/v1/admin/roles/${roleId}?institutionId=${institutionId}`, {
      method: "DELETE",
    }),

  /** Audit B-28: the CSV itself is now uploaded; previously only its name was sent. */
  triggerImport: (institutionId: string, importType: string, file: File) => {
    const form = new FormData()
    form.append("importType", importType)
    form.append("file", file, file.name)
    return request<ImportJobResponse>(
      `/v1/admin/users/import?institutionId=${institutionId}`,
      { method: "POST", body: form },
    )
  },

  listImportJobs: (institutionId: string) =>
    request<ImportJobResponse[]>(`/v1/admin/users/import?institutionId=${institutionId}`),

  getImportJob: (institutionId: string, jobId: string) =>
    request<ImportJobResponse>(`/v1/admin/users/import/${jobId}?institutionId=${institutionId}`),

  getEnhancedDashboard: (institutionId: string) =>
    request<EnhancedDashboardResponse>(`/v1/admin/dashboard/enhanced?institutionId=${institutionId}`),

  getOrgProfile: (institutionId: string) =>
    request<OrgProfileResponse>(`/v1/admin/org/profile?institutionId=${institutionId}`),

  updateOrgProfile: (institutionId: string, data: UpdateOrgProfileRequest) =>
    request<OrgProfileResponse>(`/v1/admin/org/profile?institutionId=${institutionId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getEnabledServices: (institutionId: string) =>
    request<string[]>(`/v1/admin/org/enabled-services?institutionId=${institutionId}`),

  updateEnabledServices: (institutionId: string, services: string[]) =>
    request<void>(`/v1/admin/org/enabled-services?institutionId=${institutionId}`, {
      method: "PUT",
      body: JSON.stringify(services),
    }),

  // Organization switcher preflight. The target institution id is sent as an
  // explicit X-Institution-Id header BEFORE it is persisted: the server-side
  // OrganizationContextResolver answers 403 for institutions the caller has no
  // membership in, so a rejected probe never mutates local state.
  verifyInstitutionAccess: async (institutionId: string): Promise<void> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("elmkusoma_access_token") : null
    let res: Response
    try {
      res = await fetch(`${API_BASE_URL}/v1/admin/org/profile`, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "X-Institution-Id": institutionId,
        },
      })
    } catch (err) {
      throw new ApiRequestError(
        err instanceof Error ? err.message : "Network error",
        0,
        null,
      )
    }
    if (res.status === 403) {
      throw new ApiRequestError(
        "Access to the requested institution is not permitted",
        403,
        null,
      )
    }
    if (!res.ok) {
      throw new ApiRequestError(`Organization switch check failed (${res.status})`, res.status, null)
    }
  },

  // Access & permission center — everything derived server-side from
  // OrganizationContext (role, membership, scope, effective permissions).
  getMyAccess: () => request<MyAccessResponse>("/v1/admin/my-access"),

  // Org-scoped search (AdministrationService.orgSearch) — scoped to the
  // caller's resolved institution by OrganizationContextResolver.
  orgSearch: (q: string, type = "all", limit = 10) =>
    request<GlobalSearchResult[]>(
      `/v1/admin/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&limit=${limit}`,
    ),

  // Per-institution service records (enabled + disabled rows).
  getInstitutionServices: () => request<InstitutionServiceItem[]>("/v1/admin/services"),

  // Platform feature catalogue. ADMIN-only — callers must tolerate 403.
  listPlatformFeatures: () => request<PlatformFeatureItem[]>("/v1/platform-admin/features"),

  getAuditLog: (institutionId: string, page = 0, size = 50) =>
    request<InstitutionAuditLogResponse[]>(`/v1/admin/org/audit-log?institutionId=${institutionId}&page=${page}&size=${size}`),

  listPeople: (institutionId: string, page = 0, size = 50) =>
    request<PeopleMemberResponse[]>(`/v1/admin/people?institutionId=${institutionId}&page=${page}&size=${size}`),

  getMember: (institutionId: string, userId: string) =>
    request<PeopleMemberResponse>(`/v1/admin/people/${userId}?institutionId=${institutionId}`),

  updateMemberRole: (institutionId: string, userId: string, newRole: string) =>
    request<PeopleMemberResponse>(`/v1/admin/people/${userId}/role?institutionId=${institutionId}&newRole=${newRole}`, {
      method: "PUT",
    }),

  deactivateMember: (institutionId: string, userId: string) =>
    request<void>(`/v1/admin/people/${userId}/deactivate?institutionId=${institutionId}`, {
      method: "PUT",
    }),

  activateMember: (institutionId: string, userId: string) =>
    request<void>(`/v1/admin/people/${userId}/activate?institutionId=${institutionId}`, {
      method: "PUT",
    }),

  inviteUser: (institutionId: string, data: InviteUserRequest) =>
    request<InvitationResponse>(`/v1/admin/people/invite?institutionId=${institutionId}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  listInvitations: (institutionId: string) =>
    request<InvitationResponse[]>(`/v1/admin/people/invitations?institutionId=${institutionId}`),

  cancelInvitation: (institutionId: string, invitationId: string) =>
    request<void>(`/v1/admin/people/invitations/${invitationId}?institutionId=${institutionId}`, {
      method: "DELETE",
    }),

  // Live session monitoring — backend requires the X-Institution-Id HEADER
  // (request() attaches it from getInstitutionId()); query params are ignored.
  getActiveLiveSessions: () =>
    request<ActiveLiveSession[]>(`/v1/admin/live-sessions/active`),

  getLiveSessionStats: () =>
    request<LiveSessionStats>(`/v1/admin/live-sessions/stats`),

  getSessionParticipants: (classId: string) =>
    request<SessionParticipant[]>(`/v1/admin/live-sessions/participants/${classId}`),

  forceEndLiveSession: (classId: string) =>
    request<ActiveLiveSession>(`/v1/admin/live-sessions/${classId}/force-end`, {
      method: "POST",
    }),

  getLiveSessionIssues: () =>
    request<LiveSessionIssue[]>(`/v1/admin/live-sessions/issues`),

  getLiveSessionHealth: () =>
    request<LiveSessionHealth>(`/v1/live-session/health`),

  // Events
  getEvents: (institutionId: string) =>
    request<any[]>(`/v1/events?institutionId=${institutionId}`),

  getEvent: (eventId: string) =>
    request<any>(`/v1/events/${eventId}`),

  createEvent: (data: Record<string, unknown>) =>
    request<any>(`/v1/events`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateEvent: (eventId: string, data: Record<string, unknown>) =>
    request<any>(`/v1/events/${eventId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteEvent: (eventId: string) =>
    request<void>(`/v1/events/${eventId}`, {
      method: "DELETE",
    }),

  publishEvent: (eventId: string) =>
    request<any>(`/v1/events/${eventId}/publish`, {
      method: "POST",
    }),

  cancelEvent: (eventId: string) =>
    request<any>(`/v1/events/${eventId}/cancel`, {
      method: "POST",
    }),

  startLiveEvent: (eventId: string) =>
    request<any>(`/v1/events/${eventId}/start-live`, {
      method: "POST",
    }),

  endLiveEvent: (eventId: string) =>
    request<any>(`/v1/events/${eventId}/end-live`, {
      method: "POST",
    }),

  getEventSummary: (eventId: string) =>
    request<any>(`/v1/events/${eventId}/summary`),
}

// ---------------------------------------------------------------------------
// Course API
// ---------------------------------------------------------------------------

export const courseApi = {
  listCourses: (institutionId: string) =>
    request<Course[]>(`/v1/courses`),

  getCourse: (courseId: string) =>
    request<Course>(`/v1/courses/${courseId}`),

  createCourse: (data: { title: string; description?: string; subjectId?: string; level?: string; category?: string; thumbnailUrl?: string; isPublished?: boolean; isFeatured?: boolean }) =>
    request<Course>(`/v1/courses`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateCourse: (courseId: string, data: { title?: string; description?: string; subjectId?: string; level?: string; category?: string; thumbnailUrl?: string; isPublished?: boolean; isFeatured?: boolean }) =>
    request<Course>(`/v1/courses/${courseId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteCourse: (courseId: string) =>
    request<void>(`/v1/courses/${courseId}`, {
      method: "DELETE",
    }),

  uploadThumbnail: async (file: File, options?: UploadOptions): Promise<{ url: string }> => {
    const headers: Record<string, string> = {}
    const token = getToken()
    const institutionId = getInstitutionId()
    if (token) headers["Authorization"] = `Bearer ${token}`
    if (institutionId) headers["X-Institution-Id"] = institutionId
    try {
      const body = (await uploadFile({
        url: `${API_BASE_URL}/v1/courses/thumbnail`,
        file,
        headers,
        ...options,
      })) as { data?: { url: string } }
      return body.data as { url: string }
    } catch (err) {
      if (err instanceof UploadError) {
        throw new ApiRequestError(err.message, err.status, (err.body as Record<string, unknown>) ?? null)
      }
      throw err
    }
  },

  togglePublish: (courseId: string) =>
    request<Course>(`/v1/courses/${courseId}/toggle-publish`, {
      method: "POST",
    }),

  getStats: () =>
    request<CourseStats>(`/v1/courses/stats`),

  listModules: (courseId: string) =>
    request<CourseModule[]>(`/v1/courses/${courseId}/modules`),

  createModule: (courseId: string, data: { title: string; moduleCode?: string; description?: string; sortOrder?: number }) =>
    request<CourseModule>(`/v1/courses/${courseId}/modules`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteModule: (moduleId: string) =>
    request<void>(`/v1/courses/modules/${moduleId}`, {
      method: "DELETE",
    }),

  listLessons: (moduleId: string) =>
    request<CourseLesson[]>(`/v1/courses/modules/${moduleId}/lessons`),

  createLesson: (moduleId: string, data: { title: string; contentType: string; contentUrl?: string; durationMinutes?: number; sortOrder?: number; isFree?: boolean }) =>
    request<CourseLesson>(`/v1/courses/modules/${moduleId}/lessons`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteLesson: (lessonId: string) =>
    request<void>(`/v1/courses/lessons/${lessonId}`, {
      method: "DELETE",
    }),
}

// ---------------------------------------------------------------------------
// Audit API
// ---------------------------------------------------------------------------

export interface AuditLogResponse {
  id: string
  institutionId: string
  userId: string
  userEmail: string | null
  userRole: string | null
  entityType: string
  entityId: string
  entityName: string | null
  action: string
  oldValues: Record<string, unknown> | null
  newValues: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  requestMethod: string | null
  requestUrl: string | null
  responseStatus: number | null
  durationMs: number | null
  createdAt: string
}

export interface ActivityFeedResponse {
  id: string
  institutionId: string
  userId: string
  actorName: string
  action: string
  description: string
  entityType: string
  entityId: string | null
  entityName: string | null
  metadata: Record<string, unknown> | null
  visibility: string
  createdAt: string
}

export interface SecurityEventResponse {
  id: string
  institutionId: string
  userId: string
  userEmail: string | null
  eventType: string
  description: string
  ipAddress: string | null
  userAgent: string | null
  location: string | null
  severity: string
  metadata: Record<string, unknown> | null
  resolved: boolean
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
}

export interface ComplianceReportResponse {
  totalAuditLogs: number
  totalSecurityEvents: number
  unresolvedSecurityEvents: number
  criticalEvents: number
  failedLoginAttempts: number
  topEventTypes: { eventType: string; count: number }[]
  severityBreakdown: { severity: string; count: number }[]
}

export const auditApi = {
  listLogs: (institutionId: string, from?: string, to?: string, page = 0, size = 20) => {
    const params = new URLSearchParams({ institutionId, page: String(page), size: String(size) })
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    return request<AuditLogResponse[]>(`/v1/audit/logs?${params}`)
  },

  listLogsByUser: (userId: string, page = 0, size = 20) =>
    request<AuditLogResponse[]>(`/v1/audit/logs/user/${userId}?page=${page}&size=${size}`),

  listLogsByEntity: (institutionId: string, entityType: string, entityId: string) =>
    request<AuditLogResponse[]>(`/v1/audit/logs/entity/${entityType}/${entityId}?institutionId=${institutionId}`),

  listActivity: (institutionId: string, page = 0, size = 20) =>
    request<ActivityFeedResponse[]>(`/v1/audit/activity?institutionId=${institutionId}&page=${page}&size=${size}`),

  listActivityByUser: (userId: string, page = 0, size = 20) =>
    request<ActivityFeedResponse[]>(`/v1/audit/activity/user/${userId}?page=${page}&size=${size}`),

  listSecurityEvents: (institutionId: string, page = 0, size = 20) =>
    request<SecurityEventResponse[]>(`/v1/audit/security?institutionId=${institutionId}&page=${page}&size=${size}`),

  listUnresolvedSecurityEvents: (institutionId: string) =>
    request<SecurityEventResponse[]>(`/v1/audit/security/unresolved?institutionId=${institutionId}`),

  resolveSecurityEvent: (eventId: string) =>
    request<SecurityEventResponse>(`/v1/audit/security/${eventId}/resolve`, {
      method: "POST",
    }),

  getComplianceReport: (institutionId: string) =>
    request<ComplianceReportResponse>(`/v1/audit/compliance?institutionId=${institutionId}`),
}

export interface Institution {
  id: string
  name: string
  description: string | null
  type: string
  status: string | null
  logoUrl: string | null
  website: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  country: string | null
  createdAt: string
}

export interface CreateInstitutionRequest {
  name: string
  description?: string
  type: string
  logoUrl?: string
  website?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  country?: string
}

export interface UpdateInstitutionRequest {
  name?: string
  description?: string
  logoUrl?: string
  website?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  country?: string
}

export const institutionApi = {
  get: (id: string) =>
    request<Institution>(`/v1/institutions/${id}`),

  list: (page = 0, size = 20) =>
    request<{ content: Institution[]; totalElements: number; totalPages: number }>(
      `/v1/institutions?page=${page}&size=${size}`
    ),

  create: (data: CreateInstitutionRequest) =>
    request<Institution>("/v1/institutions", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: UpdateInstitutionRequest) =>
    request<Institution>(`/v1/institutions/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<void>(`/v1/institutions/${id}`, { method: "DELETE" }),

  activate: (id: string) =>
    request<Institution>(`/v1/institutions/${id}/activate`, { method: "PUT" }),

  deactivate: (id: string) =>
    request<Institution>(`/v1/institutions/${id}/deactivate`, { method: "PUT" }),
}

export interface TeacherProfile {
  id: string
  userId: string
  fullName: string
  email: string
  phone: string
  employeeNumber: string
  status: string
  specialization: string
  hireDate: string
  bio: string
  /** School affiliation resolved server-side from the persisted relationship. */
  institutionId?: string
  institutionName?: string | null
  createdAt: string
}

export interface TeacherClassGroup {
  classGroupId: string
  className: string
  classSection: string
  subjectId: string
  subjectName: string
  academicYear: string
  enrolledStudents: number
  totalAssignments: number
  totalLessons: number
}

export interface TeacherStudent {
  studentId: string
  fullName: string
  email: string
  admissionNumber: string
  className: string
  subjectName: string
  gender: string
  status: string
  classGroupId: string
}

export interface TeacherDashboard {
  totalStudents: number
  totalClasses: number
  totalAssignments: number
  totalAssessments: number
  pendingSubmissions: number
  pendingGrading: number
  classes: Array<{
    classGroupId: string
    className: string
    subjectName: string
    enrolledStudents: number
  }>
  recentActivity: Array<{
    type: string
    title: string
    description: string
    timestamp: string
  }>
  /** School identity resolved server-side from the teacher's persisted affiliation. */
  institutionId?: string
  institutionName?: string | null
}

export interface LiveClass {
  id: string
  subjectId: string
  teacherId: string
  title: string
  description: string
  scheduledAt: string
  /**
   * Actual start time (server clock). Null until the teacher starts the session.
   * This - not scheduledAt - is the baseline for automatic expiry, so a late
   * start still gets the full configured duration. Read-only; the backend never
   * accepts a client-supplied startedAt.
   */
  startedAt?: string | null
  durationMinutes: number
  status: string
  maxParticipants: number
  recordingUrl: string
  createdAt: string
}

export const teacherApi = {
  getProfile: () =>
    request<TeacherProfile>("/v1/teachers/me/profile"),

  getClasses: () =>
    request<TeacherClassGroup[]>("/v1/teachers/me/classes"),

  getStudents: () =>
    request<TeacherStudent[]>("/v1/teachers/me/students"),

  getDashboard: () =>
    request<TeacherDashboard>("/v1/teachers/me/dashboard"),
}

export interface CreateLessonRequest {
  subjectId: string
  classGroupId: string
  title: string
  description?: string
  contentText?: string
  videoUrl?: string
  fileAttachments?: string
  sortOrder?: number
  isPublished?: boolean
}

export const lessonApi = {
  create: (data: CreateLessonRequest) =>
    request<Lesson>("/v1/learning/lessons", {
      method: "POST",
      body: JSON.stringify(data),
    }),
}

export interface CreateAssessmentRequest {
  subjectId: string
  classGroupId: string
  title: string
  description?: string
  timeLimitMinutes?: number
  totalMarks: number
  passMarks: number
  isPublished?: boolean
  startsAt?: string
  endsAt?: string
}

export const assessmentCreateApi = {
  create: (data: CreateAssessmentRequest) =>
    request<Assessment>("/v1/assessments", {
      method: "POST",
      body: JSON.stringify(data),
    }),
}

export interface CreateAssignmentRequest {
  subjectId: string
  classGroupId: string
  title: string
  description?: string
  dueDate?: string
  totalMarks: number
  attachments?: string
}

export const assignmentCreateApi = {
  create: (data: CreateAssignmentRequest) =>
    request<Assignment>("/v1/learning/assignments", {
      method: "POST",
      body: JSON.stringify(data),
    }),
}

export const attendanceApi = {
  getByClassAndDate: (classGroupId: string, date: string) =>
    request<unknown[]>(`/v1/attendance?classGroupId=${classGroupId}&date=${date}`),

  mark: (data: { studentId: string; classGroupId: string; attendanceDate: string; status: string; remarks?: string }) =>
    request<unknown>("/v1/attendance/mark", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  bulkMark: (data: { classGroupId: string; attendanceDate: string; records: Array<{ studentId: string; status: string; remarks?: string }> }) =>
    request<unknown>("/v1/attendance/bulk", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getSummary: (studentId: string) =>
    request<unknown>(`/v1/attendance/summary/student/${studentId}`),
}

export interface GradebookItem {
  id: string
  title: string
  maxMarks: number
  /** null when ungraded/unattempted. */
  score?: number | null
  /** Assignments: NOT_SUBMITTED | DRAFT | SUBMITTED | GRADED. */
  status: string
}

export interface GradebookRow {
  studentId: string
  studentName?: string
  admissionNumber?: string
  assignments: GradebookItem[]
  assessments: GradebookItem[]
  totalObtained: number
  totalObtainable: number
  /** null when nothing is graded yet. */
  averagePercentage?: number | null
}

export interface GradebookData {
  classGroupId: string
  className?: string
  rows: GradebookRow[]
}

export interface ReportCardSummary {
  id: string
  studentId: string
  studentName?: string
  admissionNumber?: string
  className?: string
  academicYear?: string | null
  term?: string | null
  termName?: string | null
  totalMarks?: number | null
  averageMark?: number | null
  overallGrade?: string | null
  gpa?: number | null
  classRank?: number | null
  totalStudentsInClass?: number | null
  remarks?: string | null
  status: string
  publishedAt?: string | null
}

export interface RubricCriteriaSummary {
  id: string
  name: string
  description?: string | null
  maxPoints?: number | null
  sortOrder?: number | null
}

export interface RubricSummary {
  id: string
  name: string
  description?: string | null
  subjectId?: string | null
  totalPoints?: number | null
  isActive?: boolean
  criteria: RubricCriteriaSummary[]
}

export const gradingApi = {
  getScales: () =>
    request<unknown[]>("/v1/grading/scales"),

  /** Rubric engine (B31): institution rubrics with criteria lines. */
  getRubrics: () =>
    request<RubricSummary[]>("/v1/grading/rubrics"),

  /** One-request class gradebook: all learners + submissions + results. */
  getGradebook: (classGroupId: string) =>
    request<GradebookData>(`/v1/grading/gradebook/class/${classGroupId}`),

  getReportCard: (id: string) =>
    request<unknown>(`/v1/grading/report-cards/${id}`),

  getStudentReportCards: (studentId: string) =>
    request<unknown[]>(`/v1/grading/report-cards/student/${studentId}`),

  /** Batch report cards for many learners in one query. */
  getReportCardsForStudents: (studentIds: string[]) =>
    request<ReportCardSummary[]>(`/v1/grading/report-cards/for-students?ids=${studentIds.join(",")}`),
}

// ---------------------------------------------------------------------------
// Media API
// ---------------------------------------------------------------------------

export const mediaApi = {
  upload: async (file: File, options?: UploadOptions) => {
    const token = localStorage.getItem("elmkusoma_access_token")
    const instId = localStorage.getItem("elmkusoma_institution_id")
    // Audit B-42: this path used to substitute the National HQ id when no organization was stored,
    // which silently filed every upload into the HQ tenant -- a cross-tenant data-integrity bug
    // with no error anywhere. The server binds the file to whatever header it receives, so the
    // only honest option is to fail loudly and let the caller surface it.
    if (!instId) {
      throw new Error("No organization scope available. Sign in again to upload files.")
    }
    return uploadFile({
      url: "/api/v1/media/upload",
      file,
      headers: { Authorization: `Bearer ${token}`, "X-Institution-Id": instId },
      ...options,
    })
  },
  list: (institutionId?: string) => {
    // The tenant is never invented on the client. api.request() attaches the
    // X-Institution-Id header only when this account actually stores one, and the
    // server resolves membership from that claim — an account without a school
    // (independent teacher or learner) sends no header at all and is shown exactly
    // what its account may reach: its own material plus published open-learning
    // recordings, decided entirely server-side. A hardcoded National-HQ id used to
    // be substituted here when no organization was stored, fabricating an institution
    // for a reader that has none; the backend never consumed that query parameter,
    // so an explicitly supplied id stays an explicit opt-in and nothing else.
    const qs = institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : ""
    return request<any[]>(`/v1/media${qs}`)
  },
  getDownloadUrl: (mediaId: string) => request<any>(`/v1/media/${mediaId}/download-url`),
  delete: (mediaId: string) => request<void>(`/api/v1/media/${mediaId}`, { method: "DELETE" }),
}

// ── Student Dashboard API ────────────────────────────────────────────────────

export interface DashboardSummary {
  studentId: string
  admissionNumber: string
  status: string
  /** School identity resolved server-side from the student's persisted assignment. */
  institutionId?: string
  institutionName?: string | null
  totalEnrollments: number
  activeEnrollments: number
  totalReportCards: number
  monthAttendanceTotal: number
  monthAttendancePresent: number
  monthAttendanceRate: number
  totalLessonsStarted: number
  completedLessons: number
  overallAverage: number
}

export interface ContinueLearningItem {
  lessonId: string
  completionPercentage: number
  startedAt: string
  completedAt: string | null
}

export interface RecentActivity {
  type: string
  lessonId?: string
  completedAt?: string
  date?: string
  status?: string
}

export interface SubjectGradeResult {
  subjectId: string
  marksObtained: number
  grade: string
  gradePoints: number
  teacherRemarks: string
}

export interface StudentResult {
  id: string
  academicYearId: string
  termId: string
  totalMarks: number
  averageMark: number
  classRank: number
  remarks: string
  overallGrade: string
  isPublished: boolean
  subjectGrades: SubjectGradeResult[]
}

export interface AttendanceRecordItem {
  id: string
  date: string
  status: string
  checkInTime: string | null
  checkOutTime: string | null
  remarks: string | null
}

export interface AttendanceSummary {
  totalDays: number
  present: number
  absent: number
  late: number
  excused: number
  attendanceRate: number
  records: AttendanceRecordItem[]
}

export const dashboardApi = {
  getSummary: () =>
    request<DashboardSummary>("/v1/student/dashboard/summary"),

  getContinueLearning: () =>
    request<ContinueLearningItem[]>("/v1/student/dashboard/continue-learning"),

  getRecentActivity: () =>
    request<RecentActivity[]>("/v1/student/dashboard/recent-activity"),

  getResults: () =>
    request<StudentResult[]>("/v1/student/dashboard/results"),

  getAttendance: () =>
    request<AttendanceSummary>("/v1/student/dashboard/attendance"),

  getLiveClasses: () =>
    request<unknown[]>("/v1/student/dashboard/live-classes"),

  // Student live-class list that includes classes that are currently running
  // and recently completed (±7 day window). The dashboard variant above only
  // queries "now → +7 days", which can never include an IN_PROGRESS class
  // (its scheduledAt is already in the past), leaving the live "Join Now!"
  // section permanently empty — used by the student Live Learning page that
  // students return to after leaving a live classroom. size=100 because the
  // endpoint's default first-20 window is institution-wide and unprioritized:
  // a running class could otherwise be paginated out of the list a student
  // returns to after leaving it.
  getStudentLiveClasses: () =>
    request<unknown[]>("/v1/student/live-classes?size=100"),

  // Unpaginated today's-running-classes list (IN_PROGRESS/LIVE/STARTING);
  // merged into the list page so the Join action for the class being returned
  // to is always visible regardless of list pagination.
  getStudentLiveNow: () =>
    request<unknown[]>("/v1/student/live-classes/live-now"),
}

// ── Primary Student API ──────────────────────────────────────────────────────

export interface TeacherInfo {
  id: string
  firstName: string
  lastName: string
  email: string
  subjectName: string
  specialization: string
  profileImageUrl?: string
}

export interface PortfolioItem {
  id: string
  title: string
  description?: string
  fileUrl?: string
  thumbnailUrl?: string
  portfolioType: "DRAWING" | "STORY" | "PROJECT" | "PHOTO" | "VOICE_RECORDING" | "ESSAY"
  subjectName?: string
  content?: string
  isFeatured: boolean
  createdAt: string
}

export interface StudentBadge {
  id: string
  badgeName: string
  badgeType: string
  description: string
  iconUrl?: string
  points: number
  awardedAt: string
}

export interface StreakInfo {
  currentStreak: number
  longestStreak: number
  totalPoints: number
  lastActivityDate?: string
}

export interface CurriculumTopic {
  id: string
  topicName: string
  description: string
  sortOrder: number
  totalLessons: number
}

export interface StudentNotification {
  id: string
  title: string
  message: string
  notificationType: string
  isRead: boolean
  createdAt: string
}

export interface LearningProfile {
  id?: string
  learningStyle: string
  strengths: string
  interests: string
  goals: string
  totalPoints: number
  level: number
}

export interface DiscoveryEntry {
  id: string
  title: string
  question: string
  discoveryType: "WONDER" | "EXPERIMENT" | "OBSERVATION" | "RESEARCH"
  subjectName?: string
  result?: string
  isResolved: boolean
  evidence?: string
  createdAt: string
}

export interface ReadingAdventure {
  id: string
  title: string
  content: string
  subjectName?: string
  readingLevel: string
  wordCount: number
  readTimeMinutes: number
  timesRead: number
  isFavorite: boolean
  coverColor: string
}

export interface LearningEvidence {
  id: string
  title: string
  evidenceType: string
  description: string
  evidenceUrl?: string
  subjectName?: string
  points: number
  createdAt: string
}

export interface LearningPassport {
  id?: string
  stampsEarned: number
  totalStamps: number
  currentCountry: string
  lastActivity?: string
}

export interface QuestChallenge {
  id: string
  title: string
  description: string
  questType: string
  difficulty: string
  subjectName?: string
  isCompleted: boolean
  score: number
  totalPoints: number
  completedAt?: string
}

export interface MistakeLabEntry {
  id: string
  question: string
  wrongAnswer: string
  correctAnswer: string
  explanation: string
  subjectName?: string
  isReviewed: boolean
}

export interface LiveClassActivity {
  id: string
  activityType: string
  title: string
  question: string
  options: string[]
  correctAnswer?: string
  orderIndex?: number
  timerSeconds?: number
}

export interface LiveClassActivityResponse {
  id: string
  userId: string
  activityId: string
  answer: string
  isCorrect: boolean | null
  score: number | null
  submittedAt: string
}

export interface LiveClassActivityStats {
  activityId: string
  totalResponses: number
  correctCount: number
  responses: Array<{
    userId: string
    userName: string
    answer: string
    isCorrect: boolean | null
    score: number | null
    submittedAt: string
  }>
  optionCounts: Record<string, number>
}

export interface ELmkusomaLab {
  id: string
  labTitle: string
  labType: string
  hypothesis: string
  materialsList: string[]
  steps: string[]
  expectedResult: string
  studentNotes: string
  isAttempted: boolean
  score: number
}

export interface SpeakingActivity {
  id: string
  activityType: string
  title: string
  description: string
  audioUrl?: string
  imageUrl?: string
  subjectName?: string
  isCompleted: boolean
  durationSeconds: number
}

export interface LearningCollaboration {
  id: string
  collaborationType: string
  partnerName: string
  activity: string
  subjectName?: string
  isCompleted: boolean
}

export interface RealWorldMission {
  id: string
  missionTitle: string
  missionType: string
  description: string
  location: string
  instructions: string
  evidence: string
  isCompleted: boolean
  points: number
}

export const primaryApi = {
  async getTeachers(): Promise<TeacherInfo[]> {
    return fetchJSON<TeacherInfo[]>("/v1/primary/me/teachers")
  },
  async getPortfolio(): Promise<PortfolioItem[]> {
    return fetchJSON<PortfolioItem[]>("/v1/primary/me/portfolio")
  },
  async addPortfolioItem(data: { title: string; description?: string; fileUrl?: string; portfolioType: string; subjectName?: string; content?: string }): Promise<PortfolioItem> {
    return fetchJSON<PortfolioItem>("/v1/primary/me/portfolio", { method: "POST", body: JSON.stringify(data) })
  },
  async deletePortfolioItem(itemId: string): Promise<void> {
    await fetchJSON(`/v1/primary/me/portfolio/${itemId}`, { method: "DELETE" })
  },
  async getBadges(): Promise<StudentBadge[]> {
    return fetchJSON<StudentBadge[]>("/v1/primary/me/badges")
  },
  async getStreak(): Promise<StreakInfo> {
    return fetchJSON<StreakInfo>("/v1/primary/me/streak")
  },
  async getCurriculumTopics(subjectId: string): Promise<CurriculumTopic[]> {
    return fetchJSON<CurriculumTopic[]>(`/v1/primary/curriculum/subject/${subjectId}/topics`)
  },
  async getNotifications(): Promise<StudentNotification[]> {
    return fetchJSON<StudentNotification[]>("/v1/primary/me/notifications")
  },
  async getLiveClassActivities(liveClassId: string): Promise<LiveClassActivity[]> {
    return fetchJSON<LiveClassActivity[]>(`/v1/primary/live-classes/${liveClassId}/activities`)
  },
  async createLiveClassActivity(liveClassId: string, data: {
    activityType: string
    title: string
    question: string
    options?: string[]
    correctAnswer?: string
    orderIndex?: number
    timerSeconds?: number
  }): Promise<LiveClassActivity> {
    return fetchJSON<LiveClassActivity>(`/v1/primary/live-classes/${liveClassId}/activities`, {
      method: "POST",
      body: JSON.stringify(data),
    })
  },
  async submitActivityAnswer(activityId: string, data: {
    answer: string
    drawingData?: string
  }): Promise<LiveClassActivityResponse> {
    return fetchJSON<LiveClassActivityResponse>(`/v1/primary/live-classes/activities/${activityId}/submit`, {
      method: "POST",
      body: JSON.stringify(data),
    })
  },
  async getActivityStats(activityId: string): Promise<LiveClassActivityStats> {
    return fetchJSON<LiveClassActivityStats>(`/v1/primary/live-classes/activities/${activityId}/stats`)
  },
  async getLearningProfile(): Promise<LearningProfile> {
    return fetchJSON<LearningProfile>("/v1/primary/me/learning-profile")
  },
  async updateLearningProfile(data: { learningStyle: string; strengths: string; interests: string; goals: string }): Promise<LearningProfile> {
    return fetchJSON<LearningProfile>("/v1/primary/me/learning-profile", { method: "PUT", body: JSON.stringify(data) })
  },
  async getDiscoveryEntries(): Promise<DiscoveryEntry[]> {
    return fetchJSON<DiscoveryEntry[]>("/v1/primary/me/discovery")
  },
  async addDiscoveryEntry(data: { title: string; question: string; discoveryType: string; subjectName?: string }): Promise<DiscoveryEntry> {
    return fetchJSON<DiscoveryEntry>("/v1/primary/me/discovery", { method: "POST", body: JSON.stringify(data) })
  },
  async resolveDiscoveryEntry(id: string): Promise<DiscoveryEntry> {
    return fetchJSON<DiscoveryEntry>(`/v1/primary/me/discovery/${id}/resolve`, { method: "POST" })
  },
  async getReadingAdventures(): Promise<ReadingAdventure[]> {
    return fetchJSON<ReadingAdventure[]>("/v1/primary/me/reading-adventures")
  },
  async markReadingComplete(id: string): Promise<ReadingAdventure> {
    return fetchJSON<ReadingAdventure>(`/v1/primary/me/reading-adventures/${id}/complete`, { method: "POST" })
  },
  async toggleFavoriteReading(id: string): Promise<ReadingAdventure> {
    return fetchJSON<ReadingAdventure>(`/v1/primary/me/reading-adventures/${id}/favorite`, { method: "POST" })
  },
  async getLearningEvidence(): Promise<LearningEvidence[]> {
    return fetchJSON<LearningEvidence[]>("/v1/primary/me/evidence")
  },
  async addLearningEvidence(data: { title: string; evidenceType: string; description: string; subjectName?: string }): Promise<LearningEvidence> {
    return fetchJSON<LearningEvidence>("/v1/primary/me/evidence", { method: "POST", body: JSON.stringify(data) })
  },
  async getLearningPassport(): Promise<LearningPassport> {
    return fetchJSON<LearningPassport>("/v1/primary/me/passport")
  },
  async getQuestChallenges(): Promise<QuestChallenge[]> {
    return fetchJSON<QuestChallenge[]>("/v1/primary/me/quests")
  },
  async completeQuest(questId: string, score: number): Promise<QuestChallenge> {
    return fetchJSON<QuestChallenge>(`/v1/primary/me/quests/${questId}/complete`, { method: "POST", body: JSON.stringify({ score }) })
  },
  async getMistakeLabEntries(): Promise<MistakeLabEntry[]> {
    return fetchJSON<MistakeLabEntry[]>("/v1/primary/me/mistake-lab")
  },
  async addMistakeLabEntry(data: { question: string; wrongAnswer: string; correctAnswer: string; explanation: string; subjectName?: string }): Promise<MistakeLabEntry> {
    return fetchJSON<MistakeLabEntry>("/v1/primary/me/mistake-lab", { method: "POST", body: JSON.stringify(data) })
  },
  async reviewMistake(id: string): Promise<MistakeLabEntry> {
    return fetchJSON<MistakeLabEntry>(`/v1/primary/me/mistake-lab/${id}/review`, { method: "POST" })
  },
  async getLabs(): Promise<ELmkusomaLab[]> {
    return fetchJSON<ELmkusomaLab[]>("/v1/primary/me/labs")
  },
  async attemptLab(labId: string, data: { studentNotes: string; score: number }): Promise<ELmkusomaLab> {
    return fetchJSON<ELmkusomaLab>(`/v1/primary/me/labs/${labId}/attempt`, { method: "POST", body: JSON.stringify(data) })
  },
  async getSpeakingActivities(): Promise<SpeakingActivity[]> {
    return fetchJSON<SpeakingActivity[]>("/v1/primary/me/speaking")
  },
  async addSpeakingActivity(data: { activityType: string; title: string; description?: string; subjectName?: string }): Promise<SpeakingActivity> {
    return fetchJSON<SpeakingActivity>("/v1/primary/me/speaking", { method: "POST", body: JSON.stringify(data) })
  },
  async completeSpeakingActivity(activityId: string): Promise<SpeakingActivity> {
    return fetchJSON<SpeakingActivity>(`/v1/primary/me/speaking/${activityId}/complete`, { method: "POST" })
  },
  async getCollaborations(): Promise<LearningCollaboration[]> {
    return fetchJSON<LearningCollaboration[]>("/v1/primary/me/collaborations")
  },
  async getRealWorldMissions(): Promise<RealWorldMission[]> {
    return fetchJSON<RealWorldMission[]>("/v1/primary/me/missions")
  },
  async completeMission(missionId: string, evidence: string): Promise<RealWorldMission> {
    return fetchJSON<RealWorldMission>(`/v1/primary/me/missions/${missionId}/complete`, { 
method: "POST", body: JSON.stringify({ evidence }) })
  },
}
// ── Oversight / National Command Center (docs/Nationaladmin.md) ────────────────
// Every endpoint below is jurisdiction-scoped server-side from the JWT; the
// optional scope only narrows within the caller's own authority.

export interface OversightScope {
  regionId?: string | null
  districtId?: string | null
}

function oversightPath(path: string, scope?: OversightScope): string {
  if (!scope?.regionId && !scope?.districtId) return path
  const params = new URLSearchParams()
  if (scope.regionId) params.set("regionId", scope.regionId)
  if (scope.districtId) params.set("districtId", scope.districtId)
  return `${path}?${params.toString()}`
}

export interface OversightDashboard {
  totalInstitutions: number
  totalTeachers: number
  totalStudents: number
  totalUsers: number
  activeLiveClasses: number
  totalLessons: number
  totalClasses: number
  totalCourses: number
  totalSubjects: number
  totalRegions: number
  totalDistricts: number
  attendanceRate: number
  averagePerformance: number
  curriculumProgress: number
  alertsCount: number
  jurisdictionSummary: { type: string; name: string; code: string }
  topRegions: Array<{
    regionName: string
    regionCode: string
    institutionCount: number
    teacherCount: number
    studentCount: number
    attendanceRate: number
    averagePerformance: number
  }>
  recentAlerts: Array<{
    id: string
    type: string
    message: string
    severity: string
    institutionName: string
    timestamp: string
  }>
}

export interface OversightRegion {
  id: string
  name: string
  code: string
  isActive: boolean
  institutionCount: number
  teacherCount: number
  studentCount: number
}

export interface OversightDistrict {
  id: string
  name: string
  code: string
  regionId: string | null
  regionName: string | null
  isActive: boolean
  institutionCount: number
  teacherCount: number
  studentCount: number
}

export interface OversightAttentionItem {
  id: string
  category: string
  type: string
  title: string
  message: string
  severity: string
  jurisdiction: string | null
  jurisdictionId: string | null
  timestamp: string | null
}

export interface OversightAttention {
  items: OversightAttentionItem[]
  summary: {
    total: number
    high: number
    medium: number
    low: number
    attendance: number
    performance: number
    verification: number
    contentReport: number
    dataQuality: number
  }
}

export interface OversightDataQualityCheck {
  id: string
  title: string
  description: string
  severity: string
  affectedCount: number
  sample: string[]
}

export interface OversightDataQuality {
  score: number
  totalIssues: number
  checks: OversightDataQualityCheck[]
}

export interface OversightReport {
  id: string
  title: string
  description: string
  type: string
  icon: string
  color: string
  available: boolean
}

export interface OversightAnnouncement {
  id: string
  title: string
  content: string
  priority: string
  audienceType: string | null
  audienceRegionId: string | null
  audienceRegionName: string | null
  audienceDistrictId: string | null
  audienceDistrictName: string | null
  status: string | null
  scheduledAt: string | null
  publishedAt: string | null
  createdAt: string | null
  authorName: string | null
  institutionName: string | null
}

export interface OversightSearchResult {
  type: string
  id: string
  title: string
  subtitle: string | null
}

export const oversightApi = {
  dashboard: (scope?: OversightScope) =>
    fetchJSON<OversightDashboard>(oversightPath("/v1/oversight/dashboard", scope)),
  regions: () => fetchJSON<OversightRegion[]>("/v1/oversight/regions"),
  districts: (regionId: string) =>
    fetchJSON<OversightDistrict[]>(`/v1/oversight/regions/${regionId}/districts`),
  attention: (scope?: OversightScope) =>
    fetchJSON<OversightAttention>(oversightPath("/v1/oversight/attention", scope)),
  dataQuality: (scope?: OversightScope) =>
    fetchJSON<OversightDataQuality>(oversightPath("/v1/oversight/data-quality", scope)),
  reports: () => fetchJSON<OversightReport[]>("/v1/oversight/reports"),
  search: (query: string, scope?: OversightScope) =>
    fetchJSON<OversightSearchResult[]>(
      oversightPath(`/v1/oversight/search?q=${encodeURIComponent(query)}`, scope),
    ),
  announcements: (scope?: OversightScope) =>
    fetchJSON<OversightAnnouncement[]>(oversightPath("/v1/oversight/announcements", scope)),
  createAnnouncement: (body: {
    title: string
    content: string
    priority?: string
    audienceType: string
    audienceRegionId?: string | null
    audienceDistrictId?: string | null
    scheduledAt?: string | null
  }) =>
    fetchJSON<OversightAnnouncement>("/v1/oversight/announcements", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Real CSV export — downloads the file generated from live aggregations. */
  async exportReport(
    reportId: string,
    scope?: OversightScope,
  ): Promise<{ filename: string; blob: Blob }> {
    const token = getToken()
    const res = await fetch(
      `${API_BASE_URL}${oversightPath(`/v1/oversight/reports/${reportId}/export`, scope)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
    if (!res.ok) {
      throw new ApiRequestError(`Export failed (${res.status})`, res.status, null)
    }
    const disposition = res.headers.get("Content-Disposition") || ""
    const match = disposition.match(/filename=([^;]+)/)
    return { filename: match ? match[1] : `${reportId}.csv`, blob: await res.blob() }
  },
}
