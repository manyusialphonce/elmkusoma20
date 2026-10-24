
package tz.elmkusoma.emailoutbox.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tz.elmkusoma.config.EventPublisherService;
import tz.elmkusoma.emailoutbox.domain.EmailOutboxEvent;
import tz.elmkusoma.emailoutbox.repository.EmailOutboxRepository;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Moves durable outbox rows onto the broker.
 *
 * Claiming is delegated to EmailOutboxClaimService so that the
 * transactional claim operation is invoked through a separate Spring bean.
 * Publishing happens outside the claim transaction.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailOutboxRelay {

    private final EmailOutboxRepository repository;
    private final RabbitTemplate rabbitTemplate;
    private final EmailOutboxClaimService claimService;

    @Value("${elmkusoma.email.outbox.base-backoff-seconds:30}")
    private int baseBackoffSeconds = 30;

    @Value("${elmkusoma.email.outbox.confirm-timeout-ms:5000}")
    private long confirmTimeoutMs = 5000;

    /** Correlation ids returned by the broker as unroutable. */
    private final Map<String, Boolean> returned = new ConcurrentHashMap<>();

    @jakarta.annotation.PostConstruct
    void configureMandatoryPublishing() {
        rabbitTemplate.setMandatory(true);
        rabbitTemplate.setReturnsCallback(returnedMessage -> {
            String correlationId = returnedMessage.getMessage()
                    .getMessageProperties().getCorrelationId();

            if (correlationId != null) {
                returned.put(correlationId, Boolean.TRUE);
            }

            log.warn("Email event returned as unroutable: {}",
                    returnedMessage.getReplyText());
        });
    }

    @Scheduled(
            fixedRateString = "${elmkusoma.email.outbox.poll-interval-ms:15000}",
            initialDelayString = "${elmkusoma.email.outbox.initial-delay-ms:20000}"
    )
    public void dispatchDueEvents() {
        List<Dispatch> batch = claimService.claimBatch();

        if (batch.isEmpty()) {
            return;
        }

        log.info("Email outbox relay dispatching {} event(s)", batch.size());

        for (Dispatch dispatch : batch) {
            publish(dispatch);
        }
    }

    void publish(Dispatch dispatch) {
        Map<String, Object> payload = toPayload(dispatch);
        CorrelationData correlation =
                new CorrelationData(dispatch.id().toString());

        try {
            rabbitTemplate.convertAndSend(
                    EventPublisherService.EXCHANGE_NAME,
                    EventPublisherService.EMAIL_ROUTING_KEY,
                    payload,
                    correlation
            );

            CorrelationData.Confirm confirm =
                    correlation.getFuture().get(
                            confirmTimeoutMs,
                            TimeUnit.MILLISECONDS
                    );

            if (!confirm.isAck()) {
                recordFailure(
                        dispatch,
                        "broker negatively acknowledged: " + confirm.getReason()
                );
                return;
            }

            boolean wasReturned = correlation.getReturned() != null
                    || returned.remove(dispatch.id().toString()) != null;

            if (wasReturned) {
                recordFailure(
                        dispatch,
                        "message was returned as unroutable"
                );
                return;
            }

            recordSuccess(dispatch);

        } catch (Exception e) {
            recordFailure(
                    dispatch,
                    e.getClass().getSimpleName() + ": " + e.getMessage()
            );
        }
    }

    /**
     * Preserves the payload expected by the email worker.
     */
    private Map<String, Object> toPayload(Dispatch dispatch) {
        Map<String, Object> event = new HashMap<>();

        event.put("toEmail", dispatch.recipient());
        event.put("subject", dispatch.subject());
        event.put("templateName", dispatch.template());
        event.put("templateVariables", dispatch.variables());
        event.put(
                "institutionId",
                dispatch.institutionId() != null
                        ? dispatch.institutionId().toString()
                        : null
        );
        event.put("timestamp", System.currentTimeMillis());

        return event;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordSuccess(Dispatch dispatch) {
        repository.findById(dispatch.id()).ifPresent(event -> {
            event.markPublished(LocalDateTime.now());
            repository.save(event);
        });
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(Dispatch dispatch, String error) {
        repository.findById(dispatch.id()).ifPresent(event -> {
            boolean willRetry = event.recordFailure(
                    error,
                    LocalDateTime.now(),
                    baseBackoffSeconds
            );

            repository.save(event);

            if (willRetry) {
                log.warn(
                        "Email outbox event {} attempt {} failed, will retry: {}",
                        event.getId(),
                        event.getAttempts(),
                        event.getLastError()
                );
            } else {
                log.error(
                        "Email outbox event {} exhausted {} attempts and is now FAILED: {}",
                        event.getId(),
                        event.getAttempts(),
                        event.getLastError()
                );
            }
        });
    }

    /** Immutable snapshot taken while the database row was locked. */
    public record Dispatch(
            UUID id,
            UUID institutionId,
            String recipient,
            String subject,
            String template,
            Map<String, Object> variables
    ) {
        static Dispatch from(EmailOutboxEvent event) {
            return new Dispatch(
                    event.getId(),
                    event.getInstitutionId(),
                    event.getRecipient(),
                    event.getSubject(),
                    event.getTemplateName(),
                    event.getTemplateVariables()
            );
        }
    }
}
