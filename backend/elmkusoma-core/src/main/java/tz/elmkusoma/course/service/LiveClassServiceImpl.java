package tz.elmkusoma.course.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tz.elmkusoma.academic.domain.Subject;
import tz.elmkusoma.academic.repository.SubjectRepository;
import tz.elmkusoma.attendance.domain.AttendanceRecord;
import tz.elmkusoma.attendance.repository.AttendanceRecordRepository;
import tz.elmkusoma.audit.domain.AuditLog;
import tz.elmkusoma.audit.service.AuditService;
import tz.elmkusoma.certificate.domain.Certificate;
import tz.elmkusoma.certificate.repository.CertificateRepository;
import tz.elmkusoma.course.domain.LiveBroadcastSource;
import tz.elmkusoma.course.domain.LiveClass;
import tz.elmkusoma.course.domain.LiveClass.LiveClassStatus;
import tz.elmkusoma.course.domain.LiveClassSessionType;
import tz.elmkusoma.course.dto.CreateLiveClassRequest;
import tz.elmkusoma.course.dto.LiveClassResponse;
import tz.elmkusoma.course.repository.LiveClassRepository;
import tz.elmkusoma.event.domain.Replay;
import tz.elmkusoma.event.repository.ReplayRepository;
import tz.elmkusoma.exception.ForbiddenException;
import tz.elmkusoma.exception.ResourceNotFoundException;
import tz.elmkusoma.learner.service.NotificationService;
import tz.elmkusoma.learning.domain.Lesson;
import tz.elmkusoma.learning.repository.LessonRepository;
import tz.elmkusoma.liveclass.domain.LiveClassAttendanceDetail;
import tz.elmkusoma.liveclass.domain.LiveClassParticipant;
import tz.elmkusoma.liveclass.repository.LiveClassAttendanceDetailRepository;
import tz.elmkusoma.liveclass.repository.LiveClassParticipantRepository;
import tz.elmkusoma.liveclass.service.LiveKitService;
import tz.elmkusoma.shared.domain.User;
import tz.elmkusoma.shared.repository.UserRepository;
import tz.elmkusoma.student.domain.Student;
import tz.elmkusoma.student.repository.StudentRepository;
import tz.elmkusoma.teacher.domain.Teacher;
import tz.elmkusoma.teacher.repository.TeacherAssignmentRepository;
import tz.elmkusoma.teacher.repository.TeacherRepository;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional
@Slf4j
public class LiveClassServiceImpl implements LiveClassService {

    /**
     * Grace window for scheduling a class that is (very slightly) in the past.
     * Browser and server clocks disagree by seconds, and a teacher picking
     * "now" on a datetime-local input crosses the second boundary before the
     * request lands - which failed with "Scheduled time must be in the future"
     * even though the intent was to start immediately. One minute is enough to
     * absorb that skew without allowing genuinely stale scheduling.
     */
    private static final long SCHEDULE_PAST_GRACE_MINUTES = 1;

    /** Statuses an administrator is allowed to force-end (i.e. any running session). */
    private static final java.util.Set<String> FORCE_ENDABLE_STATUSES = java.util.Set.of(
            "STARTING", "LIVE", "IN_PROGRESS", "RECOVERING", "ENDING");

    private final LiveClassRepository liveClassRepository;
    private final TeacherRepository teacherRepository;
    private final UserRepository userRepository;
    private final SubjectRepository subjectRepository;
    private final tz.elmkusoma.common.AudienceTargetGuard audienceTargetGuard;
    private final LiveClassParticipantRepository participantRepository;
    private final LiveClassAttendanceDetailRepository attendanceDetailRepository;
    private final AttendanceRecordRepository attendanceRecordRepository;
    private final CertificateRepository certificateRepository;
    private final tz.elmkusoma.certificate.service.CertificateIssuanceSupport certificateIssuanceSupport;
    private final StudentRepository studentRepository;
    private final LiveKitService liveKitService;
    private final ReplayRepository replayRepository;
    private final LessonRepository lessonRepository;
    private final TeacherAssignmentRepository teacherAssignmentRepository;
    private final NotificationService notificationService;
    private final AuditService auditService;
    /** Publishes finished/failed recordings into the existing media library (media_assets). */
    private final tz.elmkusoma.liveclass.service.LiveRecordingMediaPublisher liveRecordingMediaPublisher;
    private final org.springframework.transaction.PlatformTransactionManager transactionManager;
    /**
     * Builds the application-owned playback URL that client-facing responses expose in place
     * of the private object-storage location.
     */
    private final tz.elmkusoma.liveclass.service.RecordingPlaybackUrls recordingPlaybackUrls;
    private final tz.elmkusoma.teacher.service.TeacherVerificationStateService teacherVerificationStateService;

    /**
     * Runs each expiry in its own transaction so one failing session cannot abort the rest of
     * the sweep. The class-level @Transactional means a failure would otherwise mark the single
     * shared transaction rollback-only: every later session then failed with "current
     * transaction is aborted" and the whole sweep rolled back, leaving expired sessions stuck
     * in IN_PROGRESS forever.
     */
    private org.springframework.transaction.support.TransactionTemplate newTransaction() {
        org.springframework.transaction.support.TransactionTemplate template =
                new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        template.setPropagationBehavior(
                org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return template;
    }

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private tz.elmkusoma.administration.service.PlatformPolicyService platformPolicyService;

    @Override
    @Transactional(readOnly = true)
    public List<LiveClassResponse> getTeacherLiveClasses(UUID teacherId) {
        return liveClassRepository.findByTeacherIdAndIsDeletedFalse(teacherId).stream()
                .filter(lc -> !"CANCELLED".equals(lc.getStatus()))
                .map(this::mapToResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<LiveClassResponse> getUpcomingClasses(UUID institutionId) {
        return liveClassRepository.findByInstitutionIdAndIsDeletedFalse(institutionId).stream()
                .filter(lc -> "SCHEDULED".equals(lc.getStatus()))
                .filter(lc -> lc.getScheduledAt() != null && lc.getScheduledAt().isAfter(LocalDateTime.now()))
                .sorted(Comparator.comparing(LiveClass::getScheduledAt))
                .map(this::mapToResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<LiveClassResponse> getLiveClassesByStatus(UUID institutionId, String status) {
        return liveClassRepository.findByInstitutionIdAndStatusAndIsDeletedFalse(institutionId, status).stream()
                .map(this::mapToResponse)
                .toList();
    }

    @Override
    public LiveClassResponse createLiveClass(UUID teacherId, UUID institutionId, UUID callerUserId,
                                              String userRole, CreateLiveClassRequest request) {
        if (platformPolicyService != null && !platformPolicyService.liveCreateEnabled()) {
            throw new IllegalStateException("Platform policy forbids creating live sessions");
        }
        Teacher teacher = teacherRepository.findById(teacherId)
                .orElseThrow(() -> new ResourceNotFoundException("Teacher", "id", teacherId));

        // subjectId and classGroupId arrive from the client and decide who will be able to join
        // and who the recording is later released to, so they are claims rather than proof.
        // Prove they belong to this institution - and that this teacher is assigned to the class -
        // before any scheduling work happens.
        audienceTargetGuard.validateTarget(institutionId, request.getClassGroupId(),
                request.getSubjectId(), callerUserId, userRole);

        LocalDateTime scheduledAt = parseDateTime(request.getScheduledAt());
        if (scheduledAt == null) {
            throw new IllegalArgumentException("Scheduled time is required");
        }
        if (scheduledAt.isBefore(LocalDateTime.now().minusMinutes(SCHEDULE_PAST_GRACE_MINUTES))) {
            throw new IllegalArgumentException("Scheduled time must be in the future");
        }

        int duration = request.getDurationMinutes() != null ? request.getDurationMinutes() : 60;
        LocalDateTime endTime = scheduledAt.plusMinutes(duration);
        List<LiveClass> overlaps = liveClassRepository.findOverlappingForTeacher(
                teacherId, scheduledAt.minusMinutes(1), endTime.plusMinutes(1));
        if (!overlaps.isEmpty()) {
            LiveClass conflict = overlaps.get(0);
            throw new IllegalArgumentException("Schedule conflict: you already have \"" + conflict.getTitle()
                    + "\" scheduled at " + conflict.getScheduledAt());
        }

        LiveClass liveClass = LiveClass.builder()
                .teacherId(teacherId)
                .title(request.getTitle())
                .description(request.getDescription())
                .scheduledAt(scheduledAt)
                .durationMinutes(request.getDurationMinutes() != null ? request.getDurationMinutes() : 60)
                .status(LiveClassStatus.SCHEDULED.name())
                .subjectId(request.getSubjectId())
                .maxParticipants(request.getMaxParticipants())
                .classGroupId(request.getClassGroupId())
                .lessonId(request.getLessonId())
                .recordingEnabled(Boolean.TRUE.equals(request.getRecordingEnabled()))
                .sessionType(request.getSessionType() != null ? LiveClassSessionType.valueOf(request.getSessionType()) : LiveClassSessionType.LECTURE)
                .broadcastSource(parseBroadcastSource(request.getBroadcastSource()))
                .timezone(request.getTimezone() != null ? request.getTimezone() : "Africa/Dar_es_Salaam")
                .isRecurring(Boolean.TRUE.equals(request.getIsRecurring()))
                .recurrencePattern(request.getRecurrencePattern())
                .lobbyEnabled(Boolean.TRUE.equals(request.getLobbyEnabled()))
                .coverImageUrl(normaliseOptional(request.getCoverImageUrl()))
                .accessLevel(normaliseAccessLevel(request.getAccessLevel()))
                // Publication always starts as a draft, whatever the caller sends. This request DTO
                // has no publication field precisely so a teacher cannot publish by accident.
                .publicationStatus(LiveClass.PublicationStatus.DRAFT.name())
                .build();
        liveClass.setInstitutionId(institutionId);
        // An institution-less (independent) teacher declares no school scope: INSTITUTION would
        // name no audience at all, so the honest scope for their session is PUBLIC — which still
        // keeps the existing DRAFT → Platform Admin review → publish workflow before anyone can
        // discover or join it. Publication, not access level, remains the editorial gate.
        if (institutionId == null && LiveClass.AccessLevel.INSTITUTION.name().equals(liveClass.getAccessLevel())) {
            liveClass.setAccessLevel(LiveClass.AccessLevel.PUBLIC.name());
        }

        // Lesson ↔ Live Class: validate ownership/scope + duplicate prevention (§11)
        if (request.getLessonId() != null) {
            validateLessonLink(teacherId, liveClass, request.getLessonId(), null);
        }

        if (request.getRecurrenceEndDate() != null && !request.getRecurrenceEndDate().isBlank()) {
            try {
                liveClass.setRecurrenceEndDate(java.time.LocalDate.parse(request.getRecurrenceEndDate()));
            } catch (Exception e) {
                throw new IllegalArgumentException("Invalid recurrence end date format. Expected: yyyy-MM-dd");
            }
        }

        LiveClass saved = liveClassRepository.save(liveClass);
        createRecurringInstances(saved, request);
        return mapToResponse(saved);
    }

    @Override
    public LiveClassResponse updateLiveClass(UUID teacherId, UUID liveClassId, UUID callerUserId,
                                              String userRole, CreateLiveClassRequest request) {
        LiveClass liveClass = liveClassRepository.findById(liveClassId)
                .filter(lc -> lc.getTeacherId().equals(teacherId) && !lc.getIsDeleted())
                .orElseThrow(() -> new ResourceNotFoundException("LiveClass", "id", liveClassId));

        // Retargeting a live class changes its audience and who later receives the recording.
        // Checked against the class's own institution, so a foreign id can never be adopted even
        // though the caller legitimately owns this live class.
        if (request.getClassGroupId() != null || request.getSubjectId() != null) {
            audienceTargetGuard.validateTarget(liveClass.getInstitutionId(),
                    request.getClassGroupId(), request.getSubjectId(), callerUserId, userRole);
        }

        String currentStatus = liveClass.getStatus();
        if (LiveClassStatus.IN_PROGRESS.name().equals(currentStatus)
                || LiveClassStatus.LIVE.name().equals(currentStatus)
                || LiveClassStatus.COMPLETED.name().equals(currentStatus)) {
            throw new IllegalArgumentException("Cannot edit a " + currentStatus.toLowerCase().replace('_', ' ') + " class");
        }

        // Any material change to a class that is already publicly listed returns it to DRAFT so a
        // Platform Admin re-examines it before the change stays visible. Editing what visitors
        // already see, or when they see it, must not ride along silently on an unrelated edit.
        boolean materialChange = false;

        if (request.getTitle() != null && !request.getTitle().equals(liveClass.getTitle())) {
            liveClass.setTitle(request.getTitle());
            materialChange = true;
        }
        if (request.getDescription() != null && !request.getDescription().equals(liveClass.getDescription())) {
            liveClass.setDescription(request.getDescription());
            materialChange = true;
        }
        if (request.getScheduledAt() != null) {
            LocalDateTime newScheduledAt = parseDateTime(request.getScheduledAt());
            if (newScheduledAt != null && newScheduledAt.isBefore(LocalDateTime.now().minusMinutes(SCHEDULE_PAST_GRACE_MINUTES))) {
                throw new IllegalArgumentException("Scheduled time must be in the future");
            }
            if (newScheduledAt != null && !newScheduledAt.equals(liveClass.getScheduledAt())) {
                liveClass.setScheduledAt(newScheduledAt);
                materialChange = true;
            }
        }
        if (request.getDurationMinutes() != null) liveClass.setDurationMinutes(request.getDurationMinutes());
        if (request.getSubjectId() != null) liveClass.setSubjectId(request.getSubjectId());
        if (request.getClassGroupId() != null) liveClass.setClassGroupId(request.getClassGroupId());
        if (request.getLessonId() != null && !request.getLessonId().equals(liveClass.getLessonId())) {
            // Lesson ↔ Live Class: same guard as create (ownership/scope + duplicate)
            validateLessonLink(teacherId, liveClass, request.getLessonId(), liveClassId);
            liveClass.setLessonId(request.getLessonId());
        }
        if (request.getMaxParticipants() != null) liveClass.setMaxParticipants(request.getMaxParticipants());
        if (request.getRecordingEnabled() != null) liveClass.setRecordingEnabled(request.getRecordingEnabled());
        if (request.getSessionType() != null) {
            liveClass.setSessionType(LiveClassSessionType.valueOf(request.getSessionType()));
        }
        if (request.getBroadcastSource() != null) {
            liveClass.setBroadcastSource(parseBroadcastSource(request.getBroadcastSource()));
        }
        if (request.getCoverImageUrl() != null) {
            String requestedCover = normaliseOptional(request.getCoverImageUrl());
            if (!java.util.Objects.equals(requestedCover, liveClass.getCoverImageUrl())) {
                liveClass.setCoverImageUrl(requestedCover);
                materialChange = true;
            }
        }
        if (request.getAccessLevel() != null && !request.getAccessLevel().isBlank()) {
            String requested = normaliseAccessLevel(request.getAccessLevel());
            if (!requested.equals(liveClass.getAccessLevel())) {
                liveClass.setAccessLevel(requested);
                materialChange = true;
            }
        }

        // Detaching the class audience (school-wide / open learning) is an explicit request:
        // a lesson link belongs to a class, so it leaves with the class — otherwise an open
        // session would keep advertising school material through its public representation.
        if (Boolean.TRUE.equals(request.getClearClassGroupId())) {
            if (liveClass.getClassGroupId() != null) {
                liveClass.setClassGroupId(null);
                materialChange = true;
            }
            if (liveClass.getLessonId() != null) {
                liveClass.setLessonId(null);
                materialChange = true;
            }
        }

        // Independent teachers declare no school: an INSTITUTION audience on a school-less
        // class is meaningless (no institution's members could be "inside" it), so the honest
        // audience stays PUBLIC — the same normalisation create performs.
        if (liveClass.getInstitutionId() == null
                && LiveClass.AccessLevel.INSTITUTION.name().equals(liveClass.getAccessLevel())) {
            liveClass.setAccessLevel(LiveClass.AccessLevel.PUBLIC.name());
            materialChange = true;
        }

        if (materialChange && LiveClass.PublicationStatus.PUBLISHED.name().equals(liveClass.getPublicationStatus())) {
            liveClass.setPublicationStatus(LiveClass.PublicationStatus.DRAFT.name());
            liveClass.setPublishedAt(null);
        }

        if (liveClass.getScheduledAt() != null) {
            int dur = liveClass.getDurationMinutes() != null ? liveClass.getDurationMinutes() : 60;
            LocalDateTime endTime = liveClass.getScheduledAt().plusMinutes(dur);
            List<LiveClass> overlaps = liveClassRepository.findOverlappingForTeacher(
                    teacherId, liveClass.getScheduledAt().minusMinutes(1), endTime.plusMinutes(1));
            overlaps.removeIf(lc -> lc.getId().equals(liveClassId));
            if (!overlaps.isEmpty()) {
                LiveClass conflict = overlaps.get(0);
                throw new IllegalArgumentException("Schedule conflict: you already have \"" + conflict.getTitle()
                        + "\" scheduled at " + conflict.getScheduledAt());
            }
        }

        LiveClass saved = liveClassRepository.save(liveClass);
        return mapToResponse(saved);
    }

    @Override
    public LiveClassResponse linkLesson(UUID teacherId, UUID liveClassId, UUID lessonId) {
        LiveClass liveClass = liveClassRepository.findById(liveClassId)
                .filter(lc -> lc.getTeacherId().equals(teacherId) && !lc.getIsDeleted())
                .orElseThrow(() -> new ResourceNotFoundException("LiveClass", "id", liveClassId));

        validateLessonLink(teacherId, liveClass, lessonId, liveClassId);
        liveClass.setLessonId(lessonId);
        LiveClass saved = liveClassRepository.save(liveClass);
        log.info("Live class {} linked to lesson {} by teacher {}", liveClassId, lessonId, teacherId);
        return mapToResponse(saved);
    }

    @Override
    public LiveClassResponse unlinkLesson(UUID teacherId, UUID liveClassId) {
        LiveClass liveClass = liveClassRepository.findById(liveClassId)
                .filter(lc -> lc.getTeacherId().equals(teacherId) && !lc.getIsDeleted())
                .orElseThrow(() -> new ResourceNotFoundException("LiveClass", "id", liveClassId));

        if (liveClass.getLessonId() == null) {
            throw new IllegalArgumentException("Live class has no linked lesson");
        }
        liveClass.setLessonId(null);
        LiveClass saved = liveClassRepository.save(liveClass);
        log.info("Live class {} unlinked from lesson by teacher {}", liveClassId, teacherId);
        return mapToResponse(saved);
    }

    @Override
    public void cancelLiveClass(UUID teacherId, UUID liveClassId) {
        LiveClass liveClass = liveClassRepository.findById(liveClassId)
                .filter(lc -> lc.getTeacherId().equals(teacherId) && !lc.getIsDeleted())
                .orElseThrow(() -> new ResourceNotFoundException("LiveClass", "id", liveClassId));

        String currentStatus = liveClass.getStatus();
        if (LiveClassStatus.COMPLETED.name().equals(currentStatus)) {
            throw new IllegalArgumentException("Cannot cancel a completed class");
        }
        if (LiveClassStatus.CANCELLED.name().equals(currentStatus)) {
            throw new IllegalArgumentException("Class is already cancelled");
        }

        liveClass.setStatus(LiveClassStatus.CANCELLED.name());
        liveClassRepository.save(liveClass);
    }

    @Override
    public LiveClassResponse startSession(UUID teacherId, UUID liveClassId) {
        LiveClass liveClass = liveClassRepository.findById(liveClassId)
                .filter(lc -> lc.getTeacherId().equals(teacherId) && !lc.getIsDeleted())
                .orElseThrow(() -> new ResourceNotFoundException("LiveClass", "id", liveClassId));

        // Delivery gate 1: starting a session delivers the service to learners, so the class
        // must carry Platform Admin approval — SCHEDULED alone never authorized delivery.
        if (!LiveClass.PublicationStatus.APPROVED.name().equals(liveClass.getPublicationStatus())
                && !LiveClass.PublicationStatus.PUBLISHED.name().equals(liveClass.getPublicationStatus())) {
            throw new ForbiddenException(
                    "Only platform-approved live classes can be started. Current publication status: "
                            + liveClass.getPublicationStatus());
        }
        // Delivery gate 2: the teacher themselves must hold formal verification.
        teacherVerificationStateService.requireTeacherVerifiedByTeacherRow(teacherId);

        if (!LiveClassStatus.SCHEDULED.name().equals(liveClass.getStatus())) {
            throw new IllegalArgumentException("Only SCHEDULED classes can be started. Current status: " + liveClass.getStatus());
        }

        // Authoritative actual start (server clock, never client supplied) and the
        // baseline for auto-expiry: a teacher starting late keeps the full
        // configured duration. Only the first successful start sets it, so a
        // re-entry can never extend the session.
        if (liveClass.getStartedAt() == null) {
            liveClass.setStartedAt(LocalDateTime.now());
        }

        liveClass.setStatus(LiveClassStatus.IN_PROGRESS.name());
        LiveClass saved = liveClassRepository.save(liveClass);

        // recordingEnabled => auto-start LiveKit Egress; failure must not block the class
        if (Boolean.TRUE.equals(saved.getRecordingEnabled())) {
            try {
                String egressId = liveKitService.startRecording(saved.getId());
                if (egressId != null) {
                    saved.setRecordingUrl("egress:" + egressId);
                    // Fresh capture: any stop accepted for an earlier recording no longer applies.
                    saved.setRecordingStopRequested(false);
                    saved = liveClassRepository.save(saved);
                    log.info("Auto-recording started for live class {}", saved.getId());
                } else {
                    log.warn("Auto-recording did not start for live class {}", saved.getId());
                }
            } catch (Exception e) {
                log.warn("Auto-recording start failed for live class {}: {}", saved.getId(), e.getMessage());
            }
        }

        return mapToResponse(saved);
    }

    @Override
    public LiveClassResponse endSession(UUID teacherId, UUID liveClassId, UUID markedBy) {
        LiveClass liveClass = liveClassRepository.findById(liveClassId)
                .filter(lc -> lc.getTeacherId().equals(teacherId) && !lc.getIsDeleted())
                .orElseThrow(() -> new ResourceNotFoundException("LiveClass", "id", liveClassId));

        if (!LiveClassStatus.IN_PROGRESS.name().equals(liveClass.getStatus())) {
            throw new IllegalArgumentException("Only IN_PROGRESS classes can be ended. Current status: " + liveClass.getStatus());
        }

        return completeSession(liveClass, markedBy, LiveClassStatus.COMPLETED);
    }

    /**
     * Administrative force-end. Unlike {@link #endSession(UUID, UUID, UUID)} this accepts every
     * running state (STARTING / LIVE / IN_PROGRESS / RECOVERING) and authorises on the acting
     * admin instead of impersonating the class teacher, so the attendance/certificate rows are
     * attributed to the admin who actually performed the action.
     */
    public LiveClassResponse forceEndSession(UUID liveClassId, UUID institutionId, UUID actingUserId) {
        LiveClass liveClass = liveClassRepository.findById(liveClassId)
                .filter(lc -> !lc.getIsDeleted())
                .orElseThrow(() -> new ResourceNotFoundException("LiveClass", "id", liveClassId));

        if (institutionId == null || !institutionId.equals(liveClass.getInstitutionId())) {
            throw new org.springframework.security.access.AccessDeniedException("Access denied");
        }
        if (!FORCE_ENDABLE_STATUSES.contains(liveClass.getStatus())) {
            throw new IllegalArgumentException(
                    "Only running classes can be force-ended. Current status: " + liveClass.getStatus());
        }

        log.info("Force-ending live class {} ({}) on behalf of admin {}", liveClassId, liveClass.getStatus(), actingUserId);
        return completeSession(liveClass, actingUserId, LiveClassStatus.COMPLETED);
    }

    /**
     * Shared terminal path for both a teacher-initiated end and the authoritative
     * expiry sweep, so attendance, certificates and the recording/replay chain can
     * never diverge between the two.
     */
    private LiveClassResponse completeSession(LiveClass liveClass, UUID markedBy, LiveClassStatus terminalStatus) {
        liveClass.setStatus(terminalStatus.name());
        // Record when it actually finished. Past Classes previously inferred this from
        // scheduledAt, which cannot distinguish a 09:00 class that ran two hours from one that was
        // cancelled at 09:01. Guarded so a repeated call cannot move the recorded end time, which
        // matters because the expiry sweep can reach the same session a second time.
        if (liveClass.getEndedAt() == null) {
            liveClass.setEndedAt(LocalDateTime.now());
        }
        LiveClass saved = liveClassRepository.save(liveClass);

        createAttendanceFromParticipants(saved, markedBy);
        createLiveClassCertificates(saved, markedBy);
        finalizeRecordingAndCreateReplay(saved);

        return mapToResponse(saved);
    }

    /**
     * Authoritative expiry. A session ends when its configured duration has elapsed
     * measured from the ACTUAL start (startedAt), not the planned start: a class
     * scheduled for 10:00 with a 5-minute duration that the teacher actually starts
     * at 10:02 runs until 10:07.
     *
     * Legacy sessions (started before V135 added started_at) have startedAt == null
     * while being genuinely active, so they keep the previous scheduledAt baseline
     * rather than being stranded as never-ending. SCHEDULED classes are never
     * touched - a class nobody started must not get fabricated attendance/replay.
     */
    @Override
    public int endExpiredSessions() {
        List<String> activeStatuses = List.of(
                LiveClassStatus.STARTING.name(),
                LiveClassStatus.LIVE.name(),
                LiveClassStatus.IN_PROGRESS.name(),
                LiveClassStatus.ENDING.name());

        List<LiveClass> candidates = liveClassRepository.findByStatusInAndIsDeletedFalse(activeStatuses);
        if (candidates == null || candidates.isEmpty()) {
            return 0;
        }

        LocalDateTime now = LocalDateTime.now();
        int ended = 0;
        for (LiveClass liveClass : candidates) {
            LocalDateTime baseline = liveClass.getStartedAt() != null
                    ? liveClass.getStartedAt()
                    : liveClass.getScheduledAt();
            if (baseline == null) {
                continue;
            }
            int durationMinutes = liveClass.getDurationMinutes() != null && liveClass.getDurationMinutes() > 0
                    ? liveClass.getDurationMinutes()
                    : 60;
            LocalDateTime endsAt = baseline.plusMinutes(durationMinutes);
            if (now.isBefore(endsAt)) {
                continue;
            }
            try {
                // markedBy = null: nobody pressed "end", so attendance rows stay
                // system-attributed rather than being forged against the teacher.
                // Isolated transaction: a failure here rolls back only this session.
                newTransaction().executeWithoutResult(
                        status -> completeSession(liveClass, null, LiveClassStatus.ENDED));
                ended++;
                log.info("Auto-ended expired live class {} (started {} [legacy baseline {}], duration {}m, endedAt {})",
                        liveClass.getId(), liveClass.getStartedAt(), liveClass.getScheduledAt(),
                        durationMinutes, endsAt);
            } catch (Exception e) {
                // One bad session must never stop the sweep for the others.
                // The throwable is logged, not just its message: e.getMessage() is null for an NPE,
                // so a null-dependency failure here logged as ": null" and gave no indication of
                // what actually went wrong.
                log.warn("Auto-end failed for live class {}: {}", liveClass.getId(), e.getMessage(), e);
            }
        }
        return ended;
    }

    /**
     * Media Library representation of a finalized recording (mediaType = RECORDING).
     *
     * <p>Idempotent: the asset is keyed on source_type = LIVE_CLASS + source_id =
     * liveClass.id, which is the same origin link the library already exposes through
     * {@code GET /v1/media/recordings/{sourceType}/{sourceId}}. Reprocessing a session -
     * which happens because {@code completeSession} can run more than once, e.g. a manual
     * end followed by the expiry sweep - therefore refreshes the existing row instead of
     * creating a second one.</p>
     *
     * <p>Only a resolved, playable http(s) URL is ever stored. The transient
     * {@code egress:<id>} marker is a LiveKit bookkeeping value, not a media URL, and must
     * never reach a learner-facing library.</p>
     *
     * <p>Ownership is taken from the live class itself (its institution, its class, its
     * subject) rather than from any request input, so a recording cannot be filed under
     * another tenant.</p>
     */
    private void publishRecordingToMediaLibrary(LiveClass liveClass, String resolvedUrl) {
        if (resolvedUrl == null || resolvedUrl.isBlank() || !resolvedUrl.startsWith("http")) {
            return;
        }
        if (liveRecordingMediaPublisher == null) {
            return;
        }
        // Delegated to the publisher rather than inserting here: this method runs inside the
        // session-ending transaction, and V150 makes (source_type, source_id) unique, so a lost
        // race - a manual End while the expiry sweep is mid-completion, or a webhook retried on a
        // second instance - would mark this whole transaction rollback-only and roll back the
        // attendance and certificate writes above. The publisher inserts in its own REQUIRES_NEW
        // transaction and resolves a lost race to the sibling's row instead of erroring.
        liveRecordingMediaPublisher.publishRecordingSafely(liveClass, resolvedUrl, null);
    }

    /**
     * Stops an active LiveKit Egress, resolves the final file URL and creates the
     * learner-facing Replay row. Everything is best-effort: a recording problem must
     * never roll back ending the class (attendance/certificates above).
     */
    private void finalizeRecordingAndCreateReplay(LiveClass liveClass) {
        try {
            String url = liveClass.getRecordingUrl();
            if (url == null || url.isBlank()) {
                return;
            }

            if (url.startsWith("egress:")) {
                String egressId = url.substring("egress:".length());
                liveKitService.stopRecording(egressId);
                url = liveKitService.resolveRecordingUrl(egressId);
                if (url == null) {
                    // The upload to object storage routinely outlasts this in-request polling
                    // window. Clearing the marker and marking FAILED here destroyed recordings
                    // that had already been written to the bucket - and with LiveKit Cloud no
                    // egress_ended webhook arrives to converge, because the webhook has to be
                    // configured on the LiveKit side, not in this app's livekit.yaml.
                    // Keep the marker while egress is still running so reconciliation can file it.
                    if (!liveKitService.isEgressFinished(egressId)) {
                        log.info("Recording for class {} is still uploading (egress {}); "
                                        + "keeping marker for reconciliation",
                                liveClass.getId(), egressId);
                        return;
                    }
                    // Egress is genuinely finished and still produced no file: record it as a
                    // real FAILED library asset and clear the egress marker, so the download
                    // endpoint stops reporting "still processing" for a recording that will never
                    // exist.
                    log.warn("Recording URL unresolved for class {} (egress {}); marked FAILED",
                            liveClass.getId(), egressId);
                    liveClass.setRecordingUrl(null);
                    liveClassRepository.save(liveClass);
                    if (liveRecordingMediaPublisher != null) {
                        liveRecordingMediaPublisher.markRecordingFailedSafely(liveClass, "egress " + egressId);
                    }
                    return;
                }
                liveClass.setRecordingUrl(url);
                liveClass = liveClassRepository.save(liveClass);
            }

            if (!url.startsWith("http")) {
                if (liveRecordingMediaPublisher != null) {
                    liveClass.setRecordingUrl(null);
                    liveClassRepository.save(liveClass);
                    liveRecordingMediaPublisher.markRecordingFailedSafely(liveClass, "unresolved recording location");
                }
                return;
            }

            // Media Library representation. This runs before the replay guard on purpose:
            // reprocessing a session whose replay already exists must still be able to
            // repair a missing or stale library entry, and it is idempotent either way.
            publishRecordingToMediaLibrary(liveClass, url);

            if (!replayRepository.findByLiveSessionIdAndIsDeletedFalse(liveClass.getId()).isEmpty()) {
                return;
            }

            Replay replay = Replay.builder()
                    .liveSessionId(liveClass.getId())
                    .eventId(null)
                    .title(liveClass.getTitle())
                    .description("Live class recording - " + (liveClass.getTitle() != null ? liveClass.getTitle() : liveClass.getId()))
                    .recordingUrl(url)
                    .status("AVAILABLE")
                    .viewCount(0)
                    .lastPositionSeconds(0)
                    .institutionId(liveClass.getInstitutionId())
                    .build();
            replayRepository.save(replay);
            log.info("Replay created for live class {}: url={}", liveClass.getId(), url);
            notifyReplayAvailable(liveClass);
            auditReplayGenerated(liveClass, replay);
        } catch (Exception e) {
            log.warn("Finalize recording/replay skipped for class {}: {}", liveClass.getId(), e.getMessage());
        }
    }

    /**
     * Retries finalizing recordings whose storage location was still unresolved when the class
     * ended.
     *
     * <p>Uploading to object storage routinely outlasts the in-request polling window, and the
     * LiveKit {@code egress_ended} webhook that would otherwise converge the row is only delivered
     * when a webhook URL is configured on the LiveKit side - {@code livekit.yaml} in this repo
     * configures a <em>self-hosted</em> server and has no effect on LiveKit Cloud. Without this
     * sweep a recording that was written successfully stays invisible forever.
     *
     * <p>Safe to run repeatedly: finalization is idempotent, guarded by the replay uniqueness
     * check and by the media asset's (source_type, source_id) unique constraint.
     *
     * @return how many pending recordings were re-examined
     */
    public int reconcilePendingRecordings() {
        List<LiveClass> pending;
        try {
            pending = liveClassRepository.findWithUnresolvedRecordingMarker(
                    PageRequest.of(0, 25));
        } catch (Exception e) {
            log.warn("Recording reconciliation could not list pending classes: {}", e.getMessage());
            return 0;
        }
        int examined = 0;
        for (LiveClass liveClass : pending) {
            examined++;
            try {
                finalizeRecordingAndCreateReplay(liveClass);
            } catch (Exception e) {
                log.warn("Recording reconciliation failed for class {}: {}",
                        liveClass.getId(), e.getMessage());
            }
        }
        if (examined > 0) {
            log.info("Re-examined {} live class recording(s) awaiting upload completion", examined);
        }
        return examined;
    }

    /** §9: existing notification channel — fired only when a replay actually exists. */
    private void notifyReplayAvailable(LiveClass liveClass) {
        try {
            if (notificationService == null || liveClass.getInstitutionId() == null) {
                return;
            }
            UUID teacherUserId = teacherRepository.findById(liveClass.getTeacherId())
                    .map(Teacher::getUserId).orElse(null);
            notificationService.notifyInstitutionStudentsExcluding(
                    liveClass.getInstitutionId(), teacherUserId,
                    "Recording Available",
                    "The recording for \"" + liveClass.getTitle() + "\" is now available to watch.",
                    "REPLAY_AVAILABLE", "live_class", liveClass.getId());
        } catch (Exception ex) {
            log.warn("Replay available notification failed for live class {}: {}", liveClass.getId(), ex.getMessage());
        }
    }

    /** §13: audit trail for recording/replay generation, via the existing audit service. */
    private void auditReplayGenerated(LiveClass liveClass, Replay replay) {
        try {
            if (auditService == null) {
                return;
            }
            UUID actorUserId = teacherRepository.findById(liveClass.getTeacherId())
                    .map(Teacher::getUserId).orElse(null);
            String actorEmail = actorUserId != null
                    ? userRepository.findById(actorUserId).map(User::getEmail).orElse(null)
                    : null;
            auditService.recordAuditLog(liveClass.getInstitutionId(), actorUserId, actorEmail, "TEACHER",
                    "replay", replay.getId(), replay.getTitle(), AuditLog.AuditAction.CREATE,
                    null, Map.of(
                            "liveClassId", String.valueOf(liveClass.getId()),
                            "recordingUrl", String.valueOf(replay.getRecordingUrl())));
        } catch (Exception ex) {
            log.warn("Audit write failed for replay {}: {}", replay.getId(), ex.getMessage());
        }
    }

    @Override
    @Transactional(readOnly = true)
    public LiveClassResponse getLiveClassById(UUID liveClassId) {
        LiveClass liveClass = liveClassRepository.findById(liveClassId)
                .filter(lc -> !lc.getIsDeleted())
                .orElseThrow(() -> new ResourceNotFoundException("LiveClass", "id", liveClassId));
        return mapToResponse(liveClass);
    }

    private void createAttendanceFromParticipants(LiveClass liveClass, UUID markedBy) {
        if (liveClass.getClassGroupId() == null) {
            log.warn("No classGroupId on LiveClass {}, skipping attendance creation", liveClass.getId());
            return;
        }

        List<LiveClassParticipant> participants = participantRepository
                .findByLiveClassIdAndIsDeletedFalse(liveClass.getId());

        List<LiveClassAttendanceDetail> details = attendanceDetailRepository
                .findByLiveClassIdAndIsDeletedFalse(liveClass.getId());
        Map<UUID, LiveClassAttendanceDetail> detailByUser = new HashMap<>();
        for (LiveClassAttendanceDetail detail : details) {
            detailByUser.putIfAbsent(detail.getUserId(), detail);
        }

        LocalDate today = LocalDate.now();
        UUID classGroupId = liveClass.getClassGroupId();
        Map<AttendanceRecord.AttendanceStatus, Integer> counts = new HashMap<>();

        for (LiveClassParticipant participant : participants) {
            // participant.userId references users(id); attendance_records.student_id
            // has a FK to students(id) -- resolve the student row first.
            Student student = studentRepository.findByUserIdAndIsDeletedFalse(participant.getUserId())
                    .orElse(null);
            if (student == null) {
                continue; // teacher/host participants have no student row
            }
            UUID studentId = student.getId();

            // §attendance: status is derived from real joined/left evidence in the
            // session detail rows. The participant row itself is only the join
            // registration, so it counts as evidence when no detail row was recorded
            // for the class at all.
            LiveClassAttendanceDetail detail = detailByUser.get(participant.getUserId());
            LocalDateTime joinedAt;
            LocalDateTime leftAt;
            if (detail != null) {
                joinedAt = detail.getJoinedAt();
                leftAt = detail.getLeftAt();
            } else if (detailByUser.isEmpty()) {
                joinedAt = participant.getJoinedAt();
                leftAt = participant.getLeftAt();
            } else {
                joinedAt = null;
                leftAt = null;
            }
            AttendanceRecord.AttendanceStatus status = deriveAttendanceStatus(
                    joinedAt, leftAt, liveClass.getScheduledAt(), liveClass.getDurationMinutes());
            counts.merge(status, 1, Integer::sum);

            boolean alreadyExists = attendanceRecordRepository
                    .findByClassGroupIdAndAttendanceDateAndIsDeletedFalse(classGroupId, today)
                    .stream()
                    .anyMatch(r -> r.getStudentId().equals(studentId));

            if (!alreadyExists) {
                AttendanceRecord record = AttendanceRecord.builder()
                        .institutionId(liveClass.getInstitutionId())
                        .studentId(studentId)
                        .classGroupId(classGroupId)
                        .attendanceDate(today)
                        .status(status)
                        .markedBy(markedBy)
                        .remarks("Auto-recorded from live class participation")
                        .build();
                attendanceRecordRepository.save(record);
            }
        }

        log.info("Created attendance records for {} participants in live class {}: present={}, late={}, absent={}",
                participants.size(), liveClass.getId(),
                counts.getOrDefault(AttendanceRecord.AttendanceStatus.PRESENT, 0),
                counts.getOrDefault(AttendanceRecord.AttendanceStatus.LATE, 0),
                counts.getOrDefault(AttendanceRecord.AttendanceStatus.ABSENT, 0));
    }

    /**
     * §attendance: PRESENT when the joined window covers at least half of the
     * scheduled duration, LATE when the participant joined but covered less,
     * ABSENT when there is no join evidence at all. Without a usable scheduled
     * window the only defensible answer is PRESENT for joined / ABSENT otherwise.
     */
    private AttendanceRecord.AttendanceStatus deriveAttendanceStatus(LocalDateTime joinedAt, LocalDateTime leftAt,
                                                                    LocalDateTime scheduledAt, Integer durationMinutes) {
        if (joinedAt == null) {
            return AttendanceRecord.AttendanceStatus.ABSENT;
        }
        if (scheduledAt == null || durationMinutes == null || durationMinutes <= 0) {
            return AttendanceRecord.AttendanceStatus.PRESENT;
        }

        long windowSeconds = durationMinutes * 60L;
        LocalDateTime windowEnd = scheduledAt.plusMinutes(durationMinutes);
        LocalDateTime start = joinedAt.isBefore(scheduledAt) ? scheduledAt : joinedAt;
        LocalDateTime end = leftAt != null ? leftAt : LocalDateTime.now();
        if (end.isAfter(windowEnd)) {
            end = windowEnd;
        }
        long joinedSeconds = Math.max(0, Duration.between(start, end).getSeconds());
        return joinedSeconds * 2 >= windowSeconds
                ? AttendanceRecord.AttendanceStatus.PRESENT
                : AttendanceRecord.AttendanceStatus.LATE;
    }

    private void createLiveClassCertificates(LiveClass liveClass, UUID markedBy) {
        if (liveClass.getClassGroupId() == null) return;

        List<LiveClassParticipant> participants = participantRepository
                .findByLiveClassIdAndIsDeletedFalse(liveClass.getId());

        Teacher teacher = teacherRepository.findById(liveClass.getTeacherId()).orElse(null);
        String teacherName = "Unknown Teacher";
        if (teacher != null) {
            User tUser = userRepository.findById(teacher.getUserId()).orElse(null);
            if (tUser != null) teacherName = tUser.getFullName();
        }

        String subjectName = "";
        if (liveClass.getSubjectId() != null) {
            subjectName = subjectRepository.findById(liveClass.getSubjectId())
                    .map(Subject::getName).orElse("");
        }
        String title = subjectName.isEmpty() ? liveClass.getTitle() : subjectName + " - " + liveClass.getTitle();

        int created = 0;
        for (LiveClassParticipant participant : participants) {
            // certificates.student_id has a FK to students(id), not users(id).
            Student student = studentRepository.findByUserIdAndIsDeletedFalse(participant.getUserId())
                    .orElse(null);
            if (student == null) {
                continue; // teacher/host participants have no student row
            }
            UUID studentId = student.getId();

            boolean hasCert = certificateRepository.findAllByStudentId(studentId).stream()
                    .anyMatch(c -> Objects.equals(c.getTitle(), title)
                            && !Boolean.TRUE.equals(c.getIsDeleted()));
            if (hasCert) continue;

            User studentUser = userRepository.findById(participant.getUserId()).orElse(null);
            if (studentUser == null) continue;

            String serial = "LIVE-" + System.currentTimeMillis() + "-" + participant.getUserId().toString().substring(0, 8);

            // certificates.issued_by is NOT NULL. An automatic expiry has no pressing
            // teacher (markedBy == null, because attendance must stay system-attributed), so
            // the session's own teacher is the truthful issuer: they ran the class, and
            // instructorName below already names them. Passing null here violated the
            // constraint, which rolled back the whole expiry sweep - so no session was
            // ever auto-completed.
            UUID issuer = markedBy != null ? markedBy : liveClass.getTeacherId();

            String verificationCode = certificateIssuanceSupport.newVerificationCode();

            Certificate cert = Certificate.builder()
                    // template_id has an FK to certificate_templates(id) which is empty;
                    // the column is nullable, so leave it unset instead of a random UUID.
                    .templateId(null)
                    .studentId(studentId)
                    .issuedBy(issuer)
                    .serialNumber(serial)
                    .certificateType(Certificate.CertificateType.PARTICIPATION)
                    .title(title)
                    .description("Live class participation certificate for " + title)
                    .studentName(studentUser.getFullName())
                    .completionDate(LocalDate.now())
                    .issueDate(LocalDateTime.now())
                    .status(Certificate.CertificateStatus.ISSUED)
                    .verificationCode(verificationCode)
                    // Built from the same canonical config as the manual path. This used to be
                    // left null, so an auto-issued certificate had a code that resolved to
                    // nothing when printed or encoded into a QR code.
                    .verificationUrl(certificateIssuanceSupport.verificationUrl(verificationCode))
                    .instructorName(teacherName)
                    .build();
            cert.setInstitutionId(liveClass.getInstitutionId());
            certificateRepository.save(cert);

            // Automatic issuance is legitimate, but "the platform decided this" is exactly the
            // fact an auditor needs. Every other certificate transition is audited; this path
            // was not, so certificates appeared with no record of what produced them.
            certificateIssuanceSupport.recordAutomaticIssuance(cert, markedBy,
                    "live-class-expiry",
                    markedBy != null ? "Session ended by a teacher" : "Session expiry sweep");
            created++;
        }

        log.info("Participation certificates for live class {}: created={} (skipped students already holding this certificate)",
                liveClass.getId(), created);
    }

    private void createRecurringInstances(LiveClass parent, CreateLiveClassRequest request) {
        if (!Boolean.TRUE.equals(request.getIsRecurring()) || request.getRecurrencePattern() == null) return;
        if (request.getRecurrenceEndDate() == null || request.getRecurrenceEndDate().isBlank()) return;

        java.time.LocalDate endDate;
        try {
            endDate = java.time.LocalDate.parse(request.getRecurrenceEndDate());
        } catch (Exception e) {
            return;
        }

        java.time.LocalDateTime current = parent.getScheduledAt();
        int maxInstances = 52;
        int count = 0;

        while (current.toLocalDate().isBefore(endDate) && count < maxInstances) {
            count++;
            switch (request.getRecurrencePattern()) {
                case "DAILY" -> current = current.plusDays(1);
                case "WEEKLY" -> current = current.plusWeeks(1);
                case "BIWEEKLY" -> current = current.plusWeeks(2);
                case "MONTHLY" -> current = current.plusMonths(1);
                default -> { return; }
            }

            if (current.toLocalDate().isAfter(endDate)) break;

            LiveClass recurring = LiveClass.builder()
                    .teacherId(parent.getTeacherId())
                    .institutionId(parent.getInstitutionId())
                    .title(parent.getTitle())
                    .description(parent.getDescription())
                    .scheduledAt(current)
                    .durationMinutes(parent.getDurationMinutes())
                    .status(LiveClassStatus.SCHEDULED.name())
                    .subjectId(parent.getSubjectId())
                    .maxParticipants(parent.getMaxParticipants())
                    .classGroupId(parent.getClassGroupId())
                    .lessonId(parent.getLessonId())
                    .recordingEnabled(parent.getRecordingEnabled())
                    .broadcastSource(parent.getBroadcastSource())
                    .timezone(parent.getTimezone())
                    .isRecurring(true)
                    .recurrencePattern(parent.getRecurrencePattern())
                    .recurrenceEndDate(parent.getRecurrenceEndDate())
                    .parentRecurringId(parent.getId())
                    .lobbyEnabled(parent.getLobbyEnabled())
                    .build();

            liveClassRepository.save(recurring);
        }

        log.info("Created {} recurring instances for live class {}", count, parent.getId());
    }

    /**
     * Lesson ↔ Live Class link guard: the lesson must exist, belong to the same
     * institution (blocks cross-institution links), match the live class's class
     * when both are set, sit in a class the teacher is assigned to, and must not
     * already be linked to another active (non-terminal) live class (§11).
     */
    private void validateLessonLink(UUID teacherId, LiveClass liveClass, UUID lessonId, UUID excludeLiveClassId) {
        Lesson lesson = lessonRepository.findById(lessonId)
                .filter(l -> !Boolean.TRUE.equals(l.getIsDeleted()))
                .orElseThrow(() -> new ResourceNotFoundException("Lesson", "id", lessonId));

        if (liveClass.getInstitutionId() != null && lesson.getInstitutionId() != null
                && !liveClass.getInstitutionId().equals(lesson.getInstitutionId())) {
            throw new IllegalArgumentException("Lesson belongs to a different institution");
        }

        if (liveClass.getClassGroupId() != null && lesson.getClassGroupId() != null
                && !liveClass.getClassGroupId().equals(lesson.getClassGroupId())) {
            throw new IllegalArgumentException("Lesson belongs to a different class than this live class");
        }

        if (lesson.getClassGroupId() != null
                && !teacherAssignmentRepository.findClassGroupIdsByTeacherId(teacherId)
                        .contains(lesson.getClassGroupId())) {
            throw new IllegalArgumentException("You are not assigned to the lesson's class");
        }

        List<LiveClass> linked = liveClassRepository.findByLessonIdAndIsDeletedFalse(lessonId);
        for (LiveClass other : linked) {
            if (excludeLiveClassId != null && excludeLiveClassId.equals(other.getId())) {
                continue;
            }
            String st = other.getStatus();
            boolean terminal = LiveClassStatus.CANCELLED.name().equals(st)
                    || LiveClassStatus.COMPLETED.name().equals(st)
                    || LiveClassStatus.ENDED.name().equals(st);
            if (!terminal) {
                throw new IllegalArgumentException("Lesson is already linked to live class \""
                        + other.getTitle() + "\" — edit, relink or cancel it first");
            }
        }
    }

    private LiveClassResponse mapToResponse(LiveClass liveClass) {
        String subjectName = null;
        if (liveClass.getSubjectId() != null) {
            subjectName = subjectRepository.findById(liveClass.getSubjectId())
                    .map(Subject::getName).orElse(null);
        }

        String teacherName = null;
        Teacher teacher = teacherRepository.findById(liveClass.getTeacherId()).orElse(null);
        if (teacher != null) {
            User user = userRepository.findById(teacher.getUserId()).orElse(null);
            if (user != null) {
                teacherName = user.getFullName();
            }
        }

        long currentParticipants = participantRepository
                .countByLiveClassIdAndIsDeletedFalseAndLeftAtIsNull(liveClass.getId());

        String lessonTitle = null;
        if (liveClass.getLessonId() != null) {
            lessonTitle = lessonRepository.findById(liveClass.getLessonId())
                    .map(Lesson::getTitle).orElse(null);
        }

        return LiveClassResponse.builder()
                .id(liveClass.getId())
                .title(liveClass.getTitle())
                .description(liveClass.getDescription())
                .scheduledAt(liveClass.getScheduledAt() != null ? liveClass.getScheduledAt().toString() : null)
                .startedAt(liveClass.getStartedAt() != null ? liveClass.getStartedAt().toString() : null)
                .durationMinutes(liveClass.getDurationMinutes())
                .status(liveClass.getStatus())
                .accessLevel(liveClass.getAccessLevel())
                .publicationStatus(liveClass.getPublicationStatus())
                .reviewNote(liveClass.getReviewNote())
                .maxParticipants(liveClass.getMaxParticipants())
                .subjectName(subjectName)
                .teacherName(teacherName)
                .teacherId(liveClass.getTeacherId())
                .subjectId(liveClass.getSubjectId())
                .classGroupId(liveClass.getClassGroupId())
                .lessonId(liveClass.getLessonId())
                .lessonTitle(lessonTitle)
                .recordingUrl(recordingUrlForClient(liveClass))
                .recordingEnabled(Boolean.TRUE.equals(liveClass.getRecordingEnabled()))
                .sessionType(liveClass.getSessionType() != null ? liveClass.getSessionType().name() : "LECTURE")
                .broadcastSource(liveClass.getBroadcastSource() != null
                        ? liveClass.getBroadcastSource().name()
                        : LiveBroadcastSource.BROWSER.name())
                .timezone(liveClass.getTimezone() != null ? liveClass.getTimezone() : "Africa/Dar_es_Salaam")
                .isRecurring(Boolean.TRUE.equals(liveClass.getIsRecurring()))
                .recurrencePattern(liveClass.getRecurrencePattern())
                .recurrenceEndDate(liveClass.getRecurrenceEndDate() != null ? liveClass.getRecurrenceEndDate().toString() : null)
                .lobbyEnabled(Boolean.TRUE.equals(liveClass.getLobbyEnabled()))
                .currentParticipants((int) currentParticipants)
                .canJoin("IN_PROGRESS".equals(liveClass.getStatus()) || "LIVE".equals(liveClass.getStatus())
                        || "STARTING".equals(liveClass.getStatus()))
                .createdAt(liveClass.getCreatedAt() != null ? liveClass.getCreatedAt().toString() : null)
                .build();
    }

    /**
     * What a client is told about a finished recording.
     *
     * <p>Responses expose an entitlement-checked application playback URL, never the private
     * object-storage location. Before this existed the API shipped the storage URL to the
     * browser, so authorisation was only ever checked on the JSON request that produced the
     * link and a copied link played the file forever after.</p>
     *
     * <p>A recording that is not yet a URL - an {@code egress:<id>} marker or an absent value
     * - is passed through unchanged, so every existing "processing"/"unavailable" consumer
     * keeps its current behaviour exactly.</p>
     */
    private String recordingUrlForClient(LiveClass liveClass) {
        String stored = liveClass.getRecordingUrl();
        if (stored == null || stored.isBlank() || stored.startsWith("egress:")) {
            return stored;
        }
        // Null only if app.frontend-url is unset, which FrontendUrlValidator rejects at
        // startup. Returning null rather than the storage location keeps the fail-closed
        // property: better a missing link than a leaked object URL.
        return recordingPlaybackUrls.forLiveClass(liveClass.getId());
    }

    /**
     * Null/blank keeps the historical default (BROWSER = laptop camera workflow),
     * so older clients and stored rows behave exactly as before. An unknown value
     * fails loudly instead of silently downgrading the teacher's choice.
     */
    private LiveBroadcastSource parseBroadcastSource(String raw) {
        if (raw == null || raw.isBlank()) {
            return LiveBroadcastSource.BROWSER;
        }
        try {
            return LiveBroadcastSource.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid broadcast source: " + raw
                    + ". Supported: BROWSER, MOBILE, USB_CAMERA, PROFESSIONAL_CAMERA, OBS, ENCODER, STUDIO, OTHER");
        }
    }

    private LocalDateTime parseDateTime(String dateTimeStr) {
        if (dateTimeStr == null || dateTimeStr.isBlank()) {
            return null;
        }
        try {
            return LocalDateTime.parse(dateTimeStr, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
        } catch (Exception e) {
            try {
                String cleaned = dateTimeStr.replaceAll("\\.[0-9]{3}Z?$", "").replace("Z", "").trim();
                return LocalDateTime.parse(cleaned, DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            } catch (Exception ex) {
                throw new IllegalArgumentException("Invalid date/time format: " + dateTimeStr
                        + ". Expected format: yyyy-MM-ddTHH:mm:ss");
            }
        }
    }

    /**
     * Trims an optional string, collapsing blank to null.
     *
     * <p>Blank is meaningfully different from "absent" for a nullable column: a client sending
     * {@code ""} for an optional field usually means "clear it", and storing an empty string makes
     * downstream {@code isBlank()} checks behave inconsistently with {@code == null}.</p>
     */
    private static String normaliseOptional(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * Validates an access level against the shared {@code Event} vocabulary.
     *
     * <p>Defaults to INSTITUTION rather than PUBLIC, so an unrecognised or absent value can never
     * widen a class's reach.</p>
     */
    private static String normaliseAccessLevel(String value) {
        if (value == null || value.isBlank()) {
            return LiveClass.AccessLevel.INSTITUTION.name();
        }
        try {
            return LiveClass.AccessLevel.valueOf(value.trim().toUpperCase(java.util.Locale.ROOT)).name();
        } catch (IllegalArgumentException ex) {
            throw new IllegalArgumentException("Unknown access level: " + value);
        }
    }
}
