
package tz.elmkusoma.emailoutbox.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tz.elmkusoma.emailoutbox.domain.EmailOutboxEvent;
import tz.elmkusoma.emailoutbox.repository.EmailOutboxRepository;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class EmailOutboxClaimService {

    private final EmailOutboxRepository repository;

    @Value("${elmkusoma.email.outbox.batch-size:50}")
    private int batchSize = 50;

    @Value("${elmkusoma.email.outbox.lease-minutes:5}")
    private int leaseMinutes = 5;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public List<EmailOutboxRelay.Dispatch> claimBatch() {
        LocalDateTime now = LocalDateTime.now();
        String worker = "relay-" + UUID.randomUUID();

        List<EmailOutboxEvent> due =
                repository.findDueForUpdate(
                        now, PageRequest.of(0, batchSize));

        List<EmailOutboxRelay.Dispatch> claimed =
                new ArrayList<>(due.size());

        for (EmailOutboxEvent event : due) {
            event.claim(worker, now, leaseMinutes);
            claimed.add(EmailOutboxRelay.Dispatch.from(event));
        }

        if (!due.isEmpty()) {
            repository.saveAll(due);
        }

        return claimed;
    }
}
