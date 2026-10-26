package tz.elmkusoma.security;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tz.elmkusoma.testutil.TestDataSeeder;
import tz.elmkusoma.testutil.TestTokens;

import java.time.LocalDateTime;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * End-to-end publication workflow for a teacher's live class, driven entirely through the HTTP
 * API so each transition is the real one, not a repository shortcut:
 *
 * <pre>
 *   create (DRAFT) -> start refused -> submit (PENDING_APPROVAL) -> reject with note (REJECTED)
 *   -> teacher sees the note -> resubmit -> approve (APPROVED) -> start allowed
 * </pre>
 *
 * Also pins that only a Platform Admin can review, and that a teacher cannot approve their own
 * class.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(locations = "classpath:application-test.properties")
class LiveClassReviewWorkflowTest {

    private static final String TEACHER_HEADER = "X-Institution-Id";

    @Autowired
    private MockMvc mockMvc;

    @Test
    void draftMustBeSubmittedRejectedFixedApprovedBeforeItCanStart() throws Exception {
        String title = "Workflow " + UUID.randomUUID().toString().substring(0, 8);
        String teacher = TestTokens.teacherToken();
        String admin = TestTokens.adminToken();
        String institution = TestDataSeeder.INSTITUTION_ID.toString();

        // 1. Teacher creates a class: it starts as DRAFT.
        MvcResult created = mockMvc.perform(post("/v1/teachers/me/live-classes")
                        .header("Authorization", "Bearer " + teacher)
                        .header(TEACHER_HEADER, institution)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"" + title + "\",\"scheduledAt\":\""
                                + LocalDateTime.now().plusHours(20).withNano(0)
                                + "\",\"durationMinutes\":30}"))
                .andExpect(status().isCreated())
                .andReturn();
        String id = JsonPath.read(created.getResponse().getContentAsString(), "$.data.id");

        // 2. A DRAFT cannot start, and the refusal names the reason.
        mockMvc.perform(post("/v1/teachers/me/live-classes/" + id + "/start")
                        .header("Authorization", "Bearer " + teacher)
                        .header(TEACHER_HEADER, institution))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value(org.hamcrest.Matchers.containsString("platform-approved")));

        // 3. Teacher submits for review: DRAFT -> PENDING_APPROVAL.
        mockMvc.perform(post("/v1/teachers/me/live-classes/" + id + "/submit-for-approval")
                        .header("Authorization", "Bearer " + teacher)
                        .header(TEACHER_HEADER, institution))
                .andExpect(status().isOk());
        assertPublicationStatus(teacher, institution, id, "PENDING_APPROVAL");

        // 4. The review queue lists it for the Platform Admin.
        mockMvc.perform(get("/v1/platform-admin/live-classes/governance")
                        .param("publicationStatus", "PENDING_APPROVAL")
                        .param("size", "100")
                        .header("Authorization", "Bearer " + admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content[?(@.id == '" + id + "')]").exists());

        // 5. A teacher cannot use the review endpoints at all.
        mockMvc.perform(get("/v1/platform-admin/live-classes/governance")
                        .header("Authorization", "Bearer " + teacher))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/v1/platform-admin/live-classes/governance/" + id + "/approve")
                        .header("Authorization", "Bearer " + teacher)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());

        // 6. Admin rejection needs a reason; without one it is refused.
        mockMvc.perform(post("/v1/platform-admin/live-classes/governance/" + id + "/reject")
                        .header("Authorization", "Bearer " + admin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());

        // 7. Admin rejects with a reason: PENDING_APPROVAL -> REJECTED.
        mockMvc.perform(post("/v1/platform-admin/live-classes/governance/" + id + "/reject")
                        .header("Authorization", "Bearer " + admin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"Add the lesson outline\"}"))
                .andExpect(status().isOk());

        // 8. The teacher sees REJECTED and the reason, so they can act on it.
        mockMvc.perform(get("/v1/teachers/me/live-classes")
                        .header("Authorization", "Bearer " + teacher)
                        .header(TEACHER_HEADER, institution))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[?(@.id == '" + id + "')].publicationStatus").value(org.hamcrest.Matchers.hasItem("REJECTED")))
                .andExpect(jsonPath("$.data[?(@.id == '" + id + "')].reviewNote").value(org.hamcrest.Matchers.hasItem("Add the lesson outline")));

        // 9. A rejected class can be resubmitted: REJECTED -> PENDING_APPROVAL.
        mockMvc.perform(post("/v1/teachers/me/live-classes/" + id + "/submit-for-approval")
                        .header("Authorization", "Bearer " + teacher)
                        .header(TEACHER_HEADER, institution))
                .andExpect(status().isOk());

        // 10. Admin approves: PENDING_APPROVAL -> APPROVED.
        mockMvc.perform(post("/v1/platform-admin/live-classes/governance/" + id + "/approve")
                        .header("Authorization", "Bearer " + admin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());
        assertPublicationStatus(teacher, institution, id, "APPROVED");

        // 11. Only now may the verified teacher start the session.
        String startBody = mockMvc.perform(post("/v1/teachers/me/live-classes/" + id + "/start")
                        .header("Authorization", "Bearer " + teacher)
                        .header(TEACHER_HEADER, institution))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertTrue(startBody.contains("\"success\""), "start should return the standard envelope");
    }

    @Test
    void teacherCannotApproveTheirOwnDraft() throws Exception {
        String teacher = TestTokens.teacherToken();
        String institution = TestDataSeeder.INSTITUTION_ID.toString();

        MvcResult created = mockMvc.perform(post("/v1/teachers/me/live-classes")
                        .header("Authorization", "Bearer " + teacher)
                        .header(TEACHER_HEADER, institution)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Self approve " + UUID.randomUUID().toString().substring(0, 8)
                                + "\",\"scheduledAt\":\"" + LocalDateTime.now().plusHours(21).withNano(0)
                                + "\",\"durationMinutes\":30}"))
                .andExpect(status().isCreated())
                .andReturn();
        String id = JsonPath.read(created.getResponse().getContentAsString(), "$.data.id");

        mockMvc.perform(post("/v1/platform-admin/live-classes/governance/" + id + "/approve")
                        .header("Authorization", "Bearer " + teacher)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());
        assertEquals("DRAFT", publicationStatusOf(teacher, institution, id));
    }

    private void assertPublicationStatus(String teacher, String institution, String id, String expected) throws Exception {
        assertEquals(expected, publicationStatusOf(teacher, institution, id));
    }

    private String publicationStatusOf(String teacher, String institution, String id) throws Exception {
        String body = mockMvc.perform(get("/v1/teachers/me/live-classes")
                        .header("Authorization", "Bearer " + teacher)
                        .header(TEACHER_HEADER, institution))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        java.util.List<String> values = JsonPath.read(body, "$.data[?(@.id == '" + id + "')].publicationStatus");
        assertEquals(1, values.size(), "class should appear once in the teacher's list");
        return values.get(0);
    }
}
