
package tz.elmkusoma.identity.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import tz.elmkusoma.identity.domain.PasswordResetToken;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Bulk purge for consumed/expired single-use security artifacts.
 *
 * <p>Retention: used-or-expired reset/email tokens are kept 7 days for
 * forensics, verification codes 1 day, and revocation rows until the revoked
 * credential itself has expired. Audit/security-event rows are never touched
 * here.
 */
@Repository
public interface TokenCleanupRepository
        extends JpaRepository<PasswordResetToken, UUID> {

    @Modifying
    @Query("""
            DELETE FROM PasswordResetToken t
            WHERE t.used = true OR t.expiresAt < :cutoff
            """)
    int deleteUsedOrExpiredResetTokens(LocalDateTime cutoff);

    @Modifying
    @Query("""
            DELETE FROM EmailVerificationToken t
            WHERE t.used = true OR t.expiresAt < :cutoff
            """)
    int deleteUsedOrExpiredEmailTokens(LocalDateTime cutoff);

    @Modifying
    @Query("""
            DELETE FROM VerificationCode t
            WHERE t.used = true OR t.expiresAt < :cutoff
            """)
    int deleteUsedOrExpiredCodes(LocalDateTime cutoff);

    @Modifying
    @Query("""
            DELETE FROM RevokedToken t
            WHERE t.expiresAt < :now
            """)
    int deleteExpiredRevocations(LocalDateTime now);
}
