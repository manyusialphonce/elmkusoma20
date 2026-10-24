package tz.elmkusoma.config.security;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import jakarta.persistence.EntityManager;
import tz.elmkusoma.shared.repository.InstitutionMembershipRepository;
import tz.elmkusoma.shared.repository.UserRepository;

import java.util.List;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
@Import(PermissionConfig.class)
public class SecurityConfig {

    private final JwtTokenProvider jwtTokenProvider;
    private final UserRepository userRepository;
    private final InstitutionMembershipRepository membershipRepository;
    private final OrganizationContextHolder contextHolder;
    private final EntityManager entityManager;
    private final PermissionService permissionService;
    private final RateLimitService rateLimitService;
    private final ClientIpResolver clientIpResolver;

    private static final String[] PUBLIC_URLS = {
            "/v1/auth/**",
            "/v1/public/**",
            "/v1/certificates/verify/**",
            "/v1/institutions",
            "/v1/institutions/{id}",
            "/v1/webhooks/livekit",
            "/v1/webhooks/**",
            "/v1/content/**",
            "/ws/**"
    };

    private static final String[] ADMIN_ONLY_URLS = {
            "/swagger-ui/**",
            "/swagger-ui.html",
            "/v3/api-docs/**",
            "/actuator/**"
    };

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter() {
        return new JwtAuthenticationFilter(
                jwtTokenProvider, userDetailsService(), userRepository);
    }

    @Bean
    public AuthRateLimitFilter authRateLimitFilter(
            ClientIpResolver clientIpResolver) {
        return new AuthRateLimitFilter(rateLimitService, clientIpResolver);
    }

    @Bean
    public FilterRegistrationBean<AuthRateLimitFilter>
    authRateLimitFilterRegistration(AuthRateLimitFilter filter) {
        FilterRegistrationBean<AuthRateLimitFilter> registration =
                new FilterRegistrationBean<>();
        registration.setFilter(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public JwtRequestAttributeFilter jwtRequestAttributeFilter() {
        return new JwtRequestAttributeFilter(
                jwtTokenProvider, userRepository, membershipRepository);
    }

    @Bean
    public OrganizationContextResolver organizationContextResolver() {
        return new OrganizationContextResolver(
                jwtTokenProvider,
                userRepository,
                membershipRepository,
                contextHolder,
                entityManager,
                permissionService);
    }

    /**
     * The resolver is already wired into the security chain.
     * Disable separate servlet-container registration to prevent
     * it from running before authentication.
     */
    @Bean
    public FilterRegistrationBean<OrganizationContextResolver>
    organizationContextResolverFilterRegistration(
            OrganizationContextResolver filter) {
        FilterRegistrationBean<OrganizationContextResolver> registration =
                new FilterRegistrationBean<>();
        registration.setFilter(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public org.springframework.security.core.userdetails.UserDetailsService
    userDetailsService() {
        return email -> {
            tz.elmkusoma.shared.domain.User user =
                    userRepository.findByEmailAndIsDeletedFalse(email)
                            .orElseThrow(() ->
                                    new org.springframework.security.core.userdetails
                                            .UsernameNotFoundException(
                                            "User not found with email: " + email));

            return org.springframework.security.core.userdetails.User.builder()
                    .username(user.getEmail())
                    .password(user.getPasswordHash())
                    .authorities("ROLE_" + user.getRole().name())
                    .build();
        };
    }

    /**
     * Prevent servlet-container auto-registration of JWT filters.
     * These filters must run only inside the Spring Security chain.
     */
    @Bean
    public FilterRegistrationBean<JwtAuthenticationFilter>
    jwtFilterRegistration(JwtAuthenticationFilter filter) {
        FilterRegistrationBean<JwtAuthenticationFilter> registration =
                new FilterRegistrationBean<>();
        registration.setFilter(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public FilterRegistrationBean<JwtRequestAttributeFilter>
    jwtRequestFilterRegistration(JwtRequestAttributeFilter filter) {
        FilterRegistrationBean<JwtRequestAttributeFilter> registration =
                new FilterRegistrationBean<>();
        registration.setFilter(filter);
        registration.setEnabled(false);
        return registration;
    }

    /**
     * Register the correlation filter before the security chain so
     * request IDs are available even for rejected requests.
     */
    @Bean
    public FilterRegistrationBean<RequestCorrelationFilter>
    requestCorrelationFilterRegistration() {
        FilterRegistrationBean<RequestCorrelationFilter> registration =
                new FilterRegistrationBean<>();
        registration.setFilter(new RequestCorrelationFilter());
        registration.addUrlPatterns("/*");
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 1);
        return registration;
    }

    @Bean
    public OrganizationContextHolder organizationContextHolder() {
        return new OrganizationContextHolder();
    }

    @Bean
    public DaoAuthenticationProvider daoAuthenticationProvider() {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
        provider.setUserDetailsService(userDetailsService());
        provider.setPasswordEncoder(passwordEncoder());
        return provider;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http)
            throws Exception {
        http
                .cors(cors ->
                        cors.configurationSource(corsConfigurationSource()))
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session ->
                        session.sessionCreationPolicy(
                                SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Password changes require an authenticated caller.
                        .requestMatchers(
                                org.springframework.http.HttpMethod.POST,
                                "/v1/auth/change-password")
                        .authenticated()

                        .requestMatchers(PUBLIC_URLS).permitAll()

                        // Public invitation activation endpoints.
                        .requestMatchers(
                                org.springframework.http.HttpMethod.POST,
                                "/v1/admin/people/invitations/activate")
                        .permitAll()
                        .requestMatchers(
                                org.springframework.http.HttpMethod.POST,
                                "/v1/admin/people/invitations/confirm")
                        .permitAll()

                        .requestMatchers(ADMIN_ONLY_URLS).hasRole("ADMIN")

                        // Organization-scoped administration.
                        .requestMatchers("/v1/admin", "/v1/admin/**")
                        .hasAnyRole(
                                "ADMIN", "INSTITUTION_ADMIN", "PROVIDER_ADMIN")

                        .requestMatchers(
                                "/v1/platform-admin",
                                "/v1/platform-admin/**")
                        .hasRole("ADMIN")

                        .requestMatchers("/v1/provider", "/v1/provider/**")
                        .hasAnyRole(
                                "ADMIN",
                                "INSTITUTION_ADMIN",
                                "PROVIDER_ADMIN",
                                "PROVIDER_STAFF")

                        // Payment detail endpoints remain explicitly denied.
                        .requestMatchers("/v1/payments", "/v1/payments/**")
                        .denyAll()

                        .requestMatchers(
                                org.springframework.http.HttpMethod.DELETE,
                                "/v1/teachers/me/**")
                        .hasRole("TEACHER")

                        .requestMatchers(
                                org.springframework.http.HttpMethod.DELETE,
                                "/v1/teachers/**")
                        .hasAnyRole("ADMIN", "INSTITUTION_ADMIN")

                        .requestMatchers(
                                org.springframework.http.HttpMethod.PUT,
                                "/v1/students/**")
                        .hasAnyRole("ADMIN", "INSTITUTION_ADMIN")

                        .anyRequest().authenticated()
                )
                .addFilterBefore(
                        authRateLimitFilter(clientIpResolver),
                        UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(
                        jwtAuthenticationFilter(),
                        UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(
                        organizationContextResolver(),
                        UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(
                        jwtRequestAttributeFilter(),
                        UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();

        // Explicit allowlist for local development and deployed frontends.
        config.setAllowedOrigins(List.of(
                "http://localhost:3000",
                "http://localhost:3001",
                "http://localhost:3002",
                "http://localhost:3003",
                "http://localhost:3004",
                "http://localhost:3005",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:3001",
                "http://127.0.0.1:3002",
                "http://127.0.0.1:3003",
                "http://localhost:5173",
                "https://elmkusoma.com",
                "https://www.elmkusoma.com",
                "https://elmkusoma20-one.vercel.app"
        ));

        config.setAllowedMethods(List.of(
                "GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);
        config.setExposedHeaders(List.of("Authorization", "X-Total-Count"));
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source =
                new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(
            DaoAuthenticationProvider daoAuthenticationProvider) {
        return new org.springframework.security.authentication.ProviderManager(
                List.of(daoAuthenticationProvider));
    }
}