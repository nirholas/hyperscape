# Security Architecture - Hyperscape Client

This document outlines the security architecture and best practices implemented in the Hyperscape client.

## Table of Contents

- [Token Storage](#token-storage)
- [XSS Prevention](#xss-prevention)
- [CSRF Protection](#csrf-protection)
- [Input Validation](#input-validation)
- [Content Security Policy](#content-security-policy)
- [Rate Limiting](#rate-limiting)
- [WebSocket Security](#websocket-security)
- [Secure Defaults](#secure-defaults)

## Token Storage

### Current Implementation

Player tokens are stored in `localStorage` for session persistence. This allows:
- Players to maintain their identity across browser sessions
- Automatic reconnection without re-authentication
- Offline capability for cached data

### Storage Keys

| Key | Purpose | Sensitivity |
|-----|---------|-------------|
| `hyperscape_player_token` | Player identity token | Medium |
| `hyperscape_session` | Active session info | Low |
| Privy tokens | Authentication tokens | High (managed by Privy SDK) |

### Security Considerations

**Trade-offs:**
- `localStorage` is accessible to JavaScript, making it vulnerable to XSS attacks
- However, Privy handles the most sensitive auth tokens with secure storage
- Our player tokens are identity tokens, not auth tokens - compromise allows impersonation but not account takeover

**Mitigations:**
- Strict CSP headers prevent inline script injection
- Input validation prevents XSS payload injection
- Player tokens expire and can be invalidated server-side
- Critical auth is handled by Privy's secure infrastructure

### Future Improvements

For enhanced security, consider:
- Server-side session with httpOnly cookies for sensitive operations
- Token rotation on suspicious activity
- Device fingerprinting for anomaly detection

## httpOnly Cookie Integration

### Server Coordination Required

To implement httpOnly cookies for enhanced session security:

#### Server Changes Needed

1. **Set httpOnly Cookie on Login**
```typescript
// Server-side (Fastify example)
reply.setCookie('session_id', sessionToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60, // 7 days
  path: '/',
});
```

2. **Validate Cookie on Requests**
```typescript
// Server middleware
const sessionId = request.cookies.session_id;
if (!sessionId || !validateSession(sessionId)) {
  return reply.status(401).send({ error: 'Unauthorized' });
}
```

3. **Clear Cookie on Logout**
```typescript
reply.clearCookie('session_id', { path: '/' });
```

#### Client Changes Needed

1. **Configure fetch/axios for credentials**
```typescript
// api-client.ts
fetch(url, {
  credentials: 'include', // Include cookies
  // ...other options
});
```

2. **Handle 401 responses**
```typescript
// Redirect to login on session expiry
if (response.status === 401) {
  redirectToLogin();
}
```

### Current Implementation

Currently, the client uses localStorage for player tokens because:
1. Privy SDK handles the most sensitive authentication tokens
2. Player tokens are identity tokens, not auth tokens
3. Session management is simpler without server cookie coordination
4. Works with CDN-hosted clients (different domain than API)

### Migration Path

When ready to implement httpOnly cookies:

1. Ensure client and API are on same domain (or use subdomain)
2. Update server to set/validate httpOnly cookies
3. Update client API calls to include credentials
4. Keep localStorage for non-sensitive preferences only
5. Test cross-origin scenarios carefully

## XSS Prevention

### Input Validation

All user inputs are sanitized using `InputValidator`:

```typescript
import { InputValidator } from "@/utils/InputValidator";

// Username validation
const result = InputValidator.validate(username, "username");
if (!result.isValid) {
  showError(result.error);
}

// Chat message validation
const sanitized = InputValidator.sanitizeForDisplay(message);
```

### Validation Rules

| Input Type | Rules |
|------------|-------|
| Username | Alphanumeric + underscore, 1-20 chars |
| Chat | No script tags, HTML entities encoded |
| Numeric | Range validation, integer check |

### Dangerous Patterns Blocked

- Script tags: `<script>`, `javascript:`
- Event handlers: `onerror`, `onload`, etc.
- Data URLs with scripts
- HTML injection attempts

## CSRF Protection

### Implementation

CSRF tokens are managed for API requests:

```typescript
// api-client.ts automatically handles CSRF
const response = await apiClient.post("/api/action", data);
// Token is automatically included in headers
```

### Token Flow

1. Server issues CSRF token with auth response
2. Client stores token in memory (not localStorage)
3. Client includes token in `X-CSRF-Token` header
4. Server validates token on state-changing requests

## Input Validation

### InputValidator Class

Located at `src/utils/InputValidator.ts`:

```typescript
// Types of validation
InputValidator.validate(input, "username");  // Username rules
InputValidator.validate(input, "numeric");   // Numeric input
InputValidator.validate(input, "text");      // General text

// Sanitization
InputValidator.sanitizeForDisplay(text);     // HTML escape
InputValidator.sanitizeForDatabase(text);    // SQL-safe
```

### Validation Features

- **Length limits**: Prevents oversized inputs
- **Character filtering**: Only allowed characters pass
- **Pattern matching**: Regex-based validation
- **XSS detection**: Blocks malicious patterns
- **SQL injection detection**: Blocks SQL patterns

## Content Security Policy

### HTTP Headers

Security headers are set via:
- `public/_headers` for production (Cloudflare)
- `vite.config.ts` for development

### CSP Directives

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://auth.privy.io;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https: blob:;
  connect-src 'self' wss: https: ws://localhost:*;
  frame-src 'self' https://auth.privy.io;
  worker-src 'self' blob:;
```

### Other Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer |

## Rate Limiting

### Client-Side Limiting

Rate limiters prevent UI spam and reduce server load:

```typescript
import { rateLimiters } from "@/lib/RateLimiter";

// Chat messages: 5 per 10 seconds
if (!rateLimiters.chat.tryProceed()) {
  showError("Slow down! You're sending messages too fast.");
  return;
}
sendChatMessage(message);
```

### Pre-configured Limiters

| Limiter | Rate | Purpose |
|---------|------|---------|
| `chat` | 5/10s | Chat spam prevention |
| `actions` | 30/s | Game action throttling |
| `api` | 60/min | API request limiting |
| `trade` | 10/min | Trade request limiting |
| `login` | 5/5min | Login attempt limiting |

### Server-Side Enforcement

Note: Client-side rate limiting is for UX improvement. Server-side rate limiting is the authoritative control and cannot be bypassed.

## WebSocket Security

### Connection Security

- WebSocket connections use WSS (TLS) in production
- Server validates auth tokens on connection
- Heartbeat mechanism detects stale connections

### Message Security

- Binary protocol prevents simple message injection
- Server validates all incoming messages
- Malformed messages are logged and rejected

### Reconnection Security

- Exponential backoff prevents reconnection storms
- Token refresh on reconnection
- Session validation on each connection

## Secure Defaults

### Development vs Production

| Feature | Development | Production |
|---------|-------------|------------|
| CSP | Relaxed for HMR | Strict |
| Source maps | Enabled | Disabled |
| Debug logging | Enabled | Disabled |
| HTTPS | Optional | Required |

### Environment Variables

**Never exposed to client:**
- `PRIVY_APP_SECRET`
- `JWT_SECRET`
- `DATABASE_URL`
- `LIVEKIT_API_SECRET`

**Safe for client (PUBLIC_ prefix):**
- `PUBLIC_PRIVY_APP_ID`
- `PUBLIC_API_URL`
- `PUBLIC_WS_URL`

## Security Checklist

When adding new features, verify:

- [ ] User input is validated with `InputValidator`
- [ ] API requests include CSRF token
- [ ] Sensitive data uses server-side session, not localStorage
- [ ] Rate limiting is applied to user-triggered actions
- [ ] Error messages don't leak sensitive information
- [ ] Console logs are removed in production
- [ ] New endpoints have proper authentication

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** open a public GitHub issue
2. Email security concerns to the maintainers
3. Include steps to reproduce
4. Allow time for a fix before public disclosure

## References

- [OWASP XSS Prevention](https://owasp.org/www-community/xss-filter-evasion-cheatsheet)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Web Security Best Practices](https://web.dev/secure/)
