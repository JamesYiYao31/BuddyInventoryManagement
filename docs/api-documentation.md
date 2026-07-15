# Buddy Inventory Management — API Documentation

**Version:** Phase 8F  
**Last updated:** July 15, 2026  
**Base URL:** `https://yourbuddyapp.com`  
**Auth model:** Supabase JWT (`Authorization: Bearer <access_token>`) unless noted

All routes are Next.js Route Handlers (`app/api/*/route.ts`).  
Most routes are rate-limited via Upstash Redis (sliding window, per IP); limits are noted per route. The recovery-elevation-status route is not rate-limited because it is called on every gate evaluation.  
No route accepts or returns PHI. No route is accessible without HTTPS.

---

## Table of Contents

1. [POST /api/feedback-notify](#1-post-apifeedback-notify)
2. [POST /api/mfa/enroll](#2-post-apimfaenroll)
3a. [POST /api/mfa/recovery-codes/generate](#3a-post-apimfarecovery-codesgenerate)
3b. [POST /api/mfa/recovery-codes/redeem](#3b-post-apimfarecovery-codesredeem)
4. [GET /api/mfa/recovery-elevation-status](#4-get-apimfarecovery-elevation-status)
5. [GET /api/super-admin/user-email](#5-get-apisuper-adminuser-email)
6. [POST /api/users/set-active](#6-post-apiusersset-active)
7. [POST /api/security-log](#7-post-apisecurity-log)

---

## 1. POST /api/feedback-notify

**File:** `app/api/feedback-notify/route.ts`  
**Purpose:** Supabase database webhook receiver. Fires when a new row is inserted into the `feedback` table. Sends an email notification to the product owner via Resend and appends the record to a Google Sheet for tracking.

**Caller:** Supabase webhook (not called by client code directly)  
**Auth:** `x-webhook-secret` header — must match `SUPABASE_WEBHOOK_SECRET` env var  
**Rate limit:** 10 requests / hour / IP (key: `feedback-notify:<ip>`)

### Request

```
POST /api/feedback-notify
Content-Type: application/json
x-webhook-secret: <SUPABASE_WEBHOOK_SECRET>
```

**Body (Supabase webhook envelope):**

```json
{
  "record": {
    "id": "uuid",
    "type": "bug | support | feedback",
    "title": "string",
    "description": "string",
    "lab_id": "uuid",
    "user_id": "uuid",
    "created_at": "ISO 8601 timestamp",
    "status": "string"
  }
}
```

### Response

| Status | Body | Meaning |
|--------|------|---------|
| `200` | `{ "ok": true }` | Email sent, sheet appended |
| `401` | `{ "error": "Unauthorized" }` | Missing or invalid webhook secret |
| `429` | `{ "error": "Too many requests" }` | Rate limit exceeded |
| `500` | `{ "error": "Internal server error", "details": "..." }` | Resend or Sheets failure |

### Security notes

- The `x-webhook-secret` header is the sole authentication mechanism. This is intentional — Supabase webhooks do not carry a user JWT.
- The route uses a **service-role Supabase client** internally to look up `profiles.full_name`, `labs.name`, and `auth.users.email` for the submitter. These lookups are server-only and never returned to the caller.
- HTML is escaped in the email body (`escapeHtml()`) to prevent injection via user-supplied feedback content.
- The Google Sheets service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`) has write-only access to a single sheet; it is not a general-purpose admin credential.

### Side effects

1. Sends email to `yiyao3112@gmail.com` via Resend with feedback type, title, description, lab name, submitter name, **submitter email address**, and timestamp. The submitter email is included intentionally so the product owner can reply to the feedback.
2. Appends one row to the configured Google Sheet (`GOOGLE_SHEET_ID`, range `Log!A:G`) with columns: Date, Type, Title, Description, Lab Name, Submitted By, Status.

---

## 2. POST /api/mfa/enroll

**File:** `app/api/mfa/enroll/route.ts`  
**Purpose:** Server-side TOTP enrollment endpoint. This is the **only** permitted way to start 2FA enrollment — client-side calls to `supabase.auth.mfa.enroll()` are prohibited because the client SDK hides unverified ("ghost") factors, making cleanup impossible without the admin API.

**Caller:** `lib/mfa.ts` → `enrollTotp()` → called from `/mfa-setup` page  
**Auth:** `Authorization: Bearer <access_token>` (user's current Supabase session token)  
**Rate limit:** 10 requests / hour / IP (key: `mfa-enroll:<ip>`)

### Request

```
POST /api/mfa/enroll
Authorization: Bearer <access_token>
```

No request body.

### Response

**Success (`200`):**

```json
{
  "qrCodeUrl": "data:image/svg+xml;base64,...",
  "secret": "BASE32_SECRET",
  "factorId": "uuid"
}
```

| Status | Body | Meaning |
|--------|------|---------|
| `200` | See above | Enrollment started; QR ready to scan |
| `401` | `{ "error": "Not authenticated" }` | Missing/invalid/expired token |
| `429` | `{ "error": "Too many requests" }` | Rate limit exceeded |
| `500` | `{ "error": "..." }` | Supabase MFA enroll failed |

### Server-side flow

1. Validates `Authorization: Bearer` header and extracts `access_token`.
2. Calls `admin.auth.getUser(token)` to verify the token and derive `user_id`. **`user_id` is never accepted from the request body.**
3. Lists all MFA factors for the user via `admin.auth.admin.mfa.listFactors()` (admin API sees unverified factors; client SDK does not).
4. Deletes any factors with `status = 'unverified'` sequentially (ghost cleanup). **Verified factors are never touched.**
5. Calls `supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Buddy Inventory Management' })` using a user-scoped client (not the admin client) — this is required by Supabase's enroll API.
6. Returns `qrCodeUrl`, `secret`, and `factorId` to the browser.

### Why server-side enrollment matters

The client SDK's `listFactors()` silently hides `unverified` factors. If enrollment is called directly from the browser and a prior session created an unverified ghost factor, the new enrollment fails with "max factors reached." The admin API is required to see and clean up those ghosts. This is a known Supabase SDK limitation, not a bug in this application.

### Compliance note

`user_id` is derived server-side from the validated JWT — never from request body. This prevents one user from triggering enrollment on behalf of another.

---

## 3a. POST /api/mfa/recovery-codes/generate

**File:** `app/api/mfa/recovery-codes/generate/route.ts`  
**Purpose:** Generates a fresh batch of single-use recovery codes (10 per the current `generateRecoveryCodes()` spec) for a user who already has verified 2FA. Any previously generated codes for that user are deleted first — only the newest batch is valid.

**Caller:** `lib/mfa.ts` → `generateMfaRecoveryCodes()` — invoked from Profile Settings → Security tab (and during initial enrollment)  
**Auth:** `Authorization: Bearer <access_token>` (validated via `authenticateBearerRequest()` in `lib/mfa-api-auth.ts`)  
**Rate limit:** 10 requests / hour / IP (key: `mfa-recovery-gen:<ip>`)

### Request

```
POST /api/mfa/recovery-codes/generate
Authorization: Bearer <access_token>
```

No request body.

### Response

**Success (`200`):**

```json
{
  "codes": ["XXXX-XXXX", "XXXX-XXXX", "..."],
  "batchId": "uuid"
}
```

The plaintext codes are returned exactly once. Only bcrypt hashes (`code_hash`) are persisted to the `mfa_recovery_codes` table, along with a shared `batch_id`. The plaintext is never stored and cannot be retrieved again.

| Status | Body | Meaning |
|--------|------|---------|
| `200` | `{ "codes": [...], "batchId": "..." }` | New batch generated |
| `400` | `{ "error": "Two-factor authentication must be enabled before generating recovery codes." }` | User has no verified TOTP factor |
| `429` | `{ "error": "Too many requests" }` | Rate limit exceeded |
| `500` | `{ "error": "Could not regenerate recovery codes." }` / `{ "error": "Could not generate recovery codes." }` / `{ "error": "Internal server error" }` | DB delete, insert, or unexpected failure |

### Server-side flow

1. Validates the Bearer token via `authenticateBearerRequest()`; derives `user.id`.
2. Lists the user's MFA factors (admin API) and confirms at least one `totp` factor with `status = 'verified'`. If none, returns `400` — recovery codes are meaningless without an enrolled second factor.
3. Generates a batch of plaintext codes (`generateRecoveryCodes()` from `lib/recovery-codes.ts` — 10 per the CLAUDE.md spec), bcrypt-hashes each (`hashRecoveryCode()`), and tags them with a shared `batch_id`.
4. Deletes all existing `mfa_recovery_codes` rows for the user (invalidates the previous batch).
5. Inserts the new hashed rows.
6. Returns the plaintext codes plus `batchId`.

### Security notes

- Codes are only ever stored as bcrypt hashes. A database read cannot recover the plaintext.
- Regeneration is destructive by design: the old batch is deleted before the new one is inserted, so any previously downloaded code sheet becomes invalid immediately.
- Requires a verified TOTP factor first, preventing recovery codes from being used as a standalone (single-factor) bypass.

---

## 3b. POST /api/mfa/recovery-codes/redeem

**File:** `app/api/mfa/recovery-codes/redeem/route.ts`  
**Purpose:** Consumes one single-use recovery code when the user cannot access their authenticator app, then records a temporary session elevation so the user can reach protected routes and fix their 2FA.

**Caller:** `lib/mfa.ts` → `redeemMfaRecoveryCode()` — invoked from the `/mfa-challenge` page ("Use a recovery code")  
**Auth:** `Authorization: Bearer <access_token>` (validated via `authenticateBearerRequest()`; also derives `sessionId`)  
**Rate limit:** 20 requests / hour / IP (key: `mfa-recovery-redeem:<ip>`)

### Request

```
POST /api/mfa/recovery-codes/redeem
Authorization: Bearer <access_token>
Content-Type: application/json

{ "code": "XXXX-XXXX" }
```

### Response

**Success (`200`):**

```json
{
  "success": true,
  "remainingCount": 9
}
```

Elevation takes effect via the `mfa_recovery_elevations` DB row alone (see section 4); there is no token refresh and no `aal` change. The session remains at `aal1`.

| Status | Body | Meaning |
|--------|------|---------|
| `200` | `{ "success": true, "remainingCount": N }` | Code valid, consumed, elevation row recorded |
| `400` | `{ "error": "Invalid request body." }` / `{ "error": "Invalid recovery code." }` | Body unparseable, or normalized code is not 8 chars |
| `401` | `{ "error": "Invalid recovery code.", "remainingCount": N }` | No stored hash matched the submitted code |
| `429` | `{ "error": "Too many requests" }` | Rate limit exceeded |
| `500` | `{ "error": "Could not verify recovery code." }` / `{ "error": "Could not redeem recovery code." }` / `{ "error": "Recovery elevation could not be recorded (missing session_id)." }` / `{ "error": "Internal server error" }` | DB fetch, mark-used, elevation, or unexpected failure |

### Server-side flow

1. Validates the Bearer token; derives `user.id` and `sessionId`.
2. Parses the body and normalizes the code (`normalizeRecoveryCode()`); rejects with `400` if not exactly 8 characters.
3. Fetches all of the user's unused codes (`used_at IS NULL`) and bcrypt-verifies the submitted code against each hash (`verifyRecoveryCode()`).
4. **On no match:** writes a `security_logs` event (`event_type = "recovery_code_redeemed"`, `outcome = "failure"`) and returns `401` with `remainingCount`.
5. **On match:** marks that code's `used_at` (single-use enforcement, guarded by `.is("used_at", null)` to prevent double-spend).
6. Calls `grantRecoveryElevation()`: deletes any prior elevation row for the user and inserts a fresh `mfa_recovery_elevations` row keyed to `session_id`, with `expires_at = NOW() + 60 minutes`. This DB row — not any `aal` change — is what authorizes the session.
7. Writes a `security_logs` event (`event_type = "recovery_code_redeemed"`, `outcome = "success"`) and returns `success: true` with `remainingCount`.

### Failed-redeem and successful-redeem are both logged

Every redeem attempt writes to `security_logs` via `logSecurityEvent()` — both failures (`event_type = "recovery_code_redeemed", outcome = "failure"`) and successes (`event_type = "recovery_code_redeemed", outcome = "success"`). This is the audit evidence for brute-force attempts against the recovery path. Super_admin and org_admin redemptions are also persisted, written to `security_logs` with `lab_id = NULL` (non-lab-scoped roles do not silently drop; in effect since July 10, 2026).

### Architecture note — Recovery elevation model (DB-row gate, not JWT aal)

This route authorizes recovery login via the **live DB-row elevation model**. Redeeming a code inserts a row into `mfa_recovery_elevations` (60-min TTL). The session stays at `aal1` — it never reaches `aal2`. Both gates (`lib/mfa-gate.ts` and the dashboard gate in `app/dashboard/page.tsx`) authorize the session by checking that DB row live via `GET /api/mfa/recovery-elevation-status` (section 4). Native `aal2` is only ever produced by a genuine TOTP code entry, never by recovery codes. The `custom_access_token_hook` sets only `lab_id`, `org_id`, and `user_role` — it does not touch `aal` (Supabase reserves that claim).

Recovery logging writes directly to `security_logs` from the redeem route via `logSecurityEvent()` (access-control trail; not `activity_logs`).

---

## 4. GET /api/mfa/recovery-elevation-status

**File:** `app/api/mfa/recovery-elevation-status/route.ts`  
**Purpose:** Live gate check. Returns whether the current session holds a valid, unexpired recovery elevation. Called whenever a user is at `aal1` (password only, no TOTP this session) to decide whether a recently redeemed recovery code should let them pass.

**Caller:** `lib/mfa-gate.ts` → `checkRecoveryElevation()` — used by the dashboard gate (`checkSessionAndRole`) and privileged-route gates (`resolveMfaGateRedirect` on `/super-admin`, `/org-admin`)  
**Auth:** `Authorization: Bearer <access_token>` (validated via `authenticateBearerRequest()`; derives `sessionId`)  
**Rate limit:** None on this route.

### Request

```
GET /api/mfa/recovery-elevation-status
Authorization: Bearer <access_token>
```

No request body.

### Response

```json
{ "elevated": true }
```

or

```json
{ "elevated": false }
```

| Status | Body | Meaning |
|--------|------|---------|
| `200` | `{ "elevated": true }` | A valid, unexpired elevation row exists for this session |
| `200` | `{ "elevated": false }` | No session id, no valid row, or any internal error (fail-closed to not-elevated) |

This route always returns `200` for an authenticated caller (fail-closed to `{ "elevated": false }`, no `500`); missing or invalid bearer token → `401`. Every other path after auth (no `sessionId`, query error, no matching row, unexpected exception) resolves to `{ "elevated": false }`. There is no `expiresAt` field in the response.

### Server-side flow

1. Validates the Bearer token; derives `user.id` and `sessionId`.
2. If there is no `sessionId`, returns `{ "elevated": false }`.
3. Queries `mfa_recovery_elevations` (service-role/admin client) for a row matching `user_id` AND `session_id` AND `expires_at > NOW()`, via `.maybeSingle()`.
4. Returns `{ "elevated": !!data }`. On query error, logs and returns `{ "elevated": false }`.

### How it fits in the gate flow

```
aal2?  → pass (TOTP verified this session)
aal1?  → GET /api/mfa/recovery-elevation-status
           elevated: true  → pass (recovery window active)
           elevated: false → redirect to /mfa-challenge
```

The check is **live on every gate evaluation** — it is not cached in the browser. Because the query filters on `expires_at > NOW()`, the 60-minute TTL is honored precisely; an expired row simply stops matching. Expired rows are not deleted by this route — they linger inertly until the next redeem replaces them.

### Implementation note

The route uses the admin (service-role) client to read `mfa_recovery_elevations`, but `user_id` and `session_id` are both derived from the validated token — never from the request — so one user cannot probe another user's elevation state.

---

## 5. GET /api/super-admin/user-email

**File:** `app/api/super-admin/user-email/route.ts`  
**Purpose:** Returns a single user's email address from `auth.users` for super-admin UI surfaces that need to display or contact a user. Email is not stored on `profiles` (removed by design), so this route is the only app path that surfaces it.

**Caller:** Super-admin pages that need to display a user's email (PII lookup by `userId`)  
**Auth:** `Authorization: Bearer <access_token>` — caller must have `profiles.role = 'super_admin'`; all other roles receive `403`  
**Rate limit:** 20 requests / hour / IP (Upstash sliding window, key: `user-email:<ip>`)

**PII note:** The response contains a user's email address. Access is restricted to `super_admin` for that reason. Do not broaden the role gate without a separate privacy review.

### Request

```
GET /api/super-admin/user-email?userId=<uuid>
Authorization: Bearer <access_token>
```

| Query param | Required | Meaning |
|-------------|----------|---------|
| `userId` | Yes | Target `auth.users` id whose email to return |

### Response

**Success (`200`):**

```json
{
  "email": "user@example.com"
}
```

| Status | Body | Meaning |
|--------|------|---------|
| `200` | `{ "email": "..." }` | Email found (empty string if the auth user has no email) |
| `400` | `{ "error": "Missing userId" }` | Query param omitted |
| `401` | `{ "error": "Unauthorized" }` | Missing/invalid/expired Bearer token |
| `403` | `{ "error": "Forbidden" }` | Authenticated but not `super_admin` |
| `404` | `{ "error": "User not found" }` | No auth user for `userId` |
| `429` | `{ "error": "Too many requests" }` | Rate limit exceeded |

### Server-side flow

1. Applies Upstash rate limiting (20/hr) **before** auth.
2. Validates the Bearer token via `admin.auth.getUser(token)`.
3. Loads the caller's `profiles.role` and requires `super_admin`.
4. Reads `userId` from the query string; rejects with `400` if missing.
5. Looks up the target via `admin.auth.admin.getUserById(userId)` and returns `{ email }`.

### Security notes

- Rate limiting runs before authentication, so an unauthenticated caller hammering this endpoint can receive `429` without ever receiving `401`.
- The target email is never accepted from the client body — only looked up server-side by id.
- Technicians, managers, and org_admins cannot call this route.

---

## 6. POST /api/users/set-active

**File:** `app/api/users/set-active/route.ts`  
**Purpose:** Deactivates or reactivates a user account via the `set_user_active_status` Postgres RPC. Deactivation flips `profiles.is_active` to `false`, stamps `deactivated_at` / `deactivated_by`, and deletes the target's `active_sessions` row in the same transaction (the 30-second session poll then evicts any live session). Reactivation clears the metadata columns. The RPC has **service_role-only EXECUTE** — this route is the only permitted call path, guaranteeing every state change passes auth, rate limiting, and audit logging.

**Caller:** `lib/set-user-active.ts` → `setUserActiveStatus()` — invoked from the four member-list surfaces (dashboard Team Management, `/org-admin`, `/super-admin/labs/[id]`, `/super-admin/orgs/[id]` Members tab)  
**Auth:** `Authorization: Bearer <access_token>` — the acting user is resolved from the validated token, **never from the request body**  
**Rate limit:** 20 requests / hour / IP (Upstash sliding window, key: `set-active:<ip>`)

### Request

```
POST /api/users/set-active
Authorization: Bearer <access_token>
Content-Type: application/json

{ "targetUserId": "uuid", "active": false }
```

| Field | Type | Meaning |
|-------|------|---------|
| `targetUserId` | uuid string | Profile id of the account to change |
| `active` | boolean | `false` = deactivate, `true` = reactivate |

### Response

**Success (`200`):**

```json
{
  "success": true,
  "action": "deactivated",
  "targetUserId": "uuid",
  "targetFullName": "Jane Doe"
}
```

`action` is `"deactivated"` or `"reactivated"`.

**Failures** return `{ "error": "<human message>", "error_code": "<code>" }`. The `error_code` field is a **new additive convention** introduced by this route (older routes return `error` only) so the UI can map failures without string-matching the human message.

| Status | `error_code` | Meaning |
|--------|--------------|---------|
| `400` | — | Malformed body (`targetUserId` not a UUID, or `active` not a boolean) |
| `401` | — | Missing/invalid/expired Bearer token |
| `403` | `actor_not_found` / `actor_inactive` / `forbidden` / `super_admin_target` | Actor has no profile, is itself deactivated, fails the hierarchy check, or targeted a super_admin (super_admin is structurally non-deactivatable; the DB CHECK is the hard backstop) |
| `404` | `target_not_found` | No profile for `targetUserId` |
| `409` | `last_admin` / `already_in_state` | Target is the last active manager/org_admin in scope (non-super_admin actor), or the account is already in the requested state |
| `429` | — | Rate limit exceeded |
| `500` | `rpc_error` | RPC transport failure |

### Server-side flow

1. Applies Upstash rate limiting (20/hr) **before** auth.
2. Validates the Bearer token and derives the actor's `user.id` — never from the body.
3. Validates the body (`targetUserId` UUID, `active` boolean) → `400` on failure.
4. Calls `set_user_active_status(p_actor_id, p_target_id, p_active)` via the service-role client and maps the jsonb result to the status codes above.
5. **On success only** (audit-after-action): writes a `security_logs` event and returns the success JSON.

### Authorization model (enforced inside the RPC)

- **super_admin** actor: any target — and is **exempt from the last-admin guard** (deliberate offboarding override; the UI shows a warning instead of blocking).
- **org_admin** actor: targets in their org, matched via `target.org_id` OR the target's lab's `labs.org_id` (technicians in org labs have `profiles.org_id` NULL).
- **manager** actor: manager/technician targets in their own lab. Self-deactivation is allowed when the guard passes.
- **Last-admin guard:** deactivating the last active manager of a lab (or last active org_admin of an org) returns `last_admin` for non-super_admin actors. The peer count uses `FOR UPDATE` row locks, making concurrent mutual deactivations race-proof.

### Security-log side effect

On success only, the route writes `event_type = "user_deactivated"` or `"user_reactivated"` (`outcome = "success"`) to `security_logs`, attributed to the **actor** (name/initials/role via `resolveSecurityLogIdentity()`), with `lab_id` = the **target's** lab (nullable). Guard-blocked attempts are not logged (consistent with the documented failed-login exclusion). Log-write failure never fails the request.

### Rate-limit key convention

All rate-limited routes use a **route-specific prefixed key** (e.g. `set-active:<ip>`, `mfa-enroll:<ip>`) so per-IP buckets cannot collide across routes. As of July 15, 2026 there are no remaining bare-IP identifiers. The only unlimited route is `GET /api/mfa/recovery-elevation-status` (by design — called on every gate evaluation).

---

## 7. POST /api/security-log

**File:** `app/api/security-log/route.ts`  
**Purpose:** Client-triggered write path for access-control events that originate in the browser (login / logout). Persists a row to `security_logs` via the service-role helper. Recovery-code generate/redeem write `security_logs` directly from their routes and do **not** use this endpoint.

**Caller:** `lib/security-log.ts` → `recordSecurityEvent()` — used from login success, voluntary logout, and session-replaced logout paths  
**Auth:** `Authorization: Bearer <access_token>` (validated via `authenticateBearerRequest()`)  
**Rate limit:** 60 requests / hour / IP (Upstash sliding window, key: `security-log:<ip>`)

### Request

```
POST /api/security-log
Authorization: Bearer <access_token>
Content-Type: application/json

{ "eventType": "login", "outcome": "success", "details": "optional string" }
```

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `eventType` | string | Yes | Only `"login"` or `"logout"` accepted by this route |
| `outcome` | string | Yes | `"success"` or `"failure"`; `logout` requires `"success"` (DB pairing) |
| `details` | string | No | Free-text detail; truncated server-side (capped so identity fallback suffix still fits) |

### Response

**Success (`200`):**

```json
{ "ok": true }
```

| Status | Body | Meaning |
|--------|------|---------|
| `200` | `{ "ok": true }` | Event recorded (or log helper swallowed a write failure — write is non-fatal to the client flow) |
| `400` | `{ "error": "Invalid event type." }` / `{ "error": "Invalid outcome." }` / `{ "error": "Invalid outcome for event type." }` / `{ "error": "Invalid request body." }` | Body missing/malformed, disallowed type/outcome, or logout+failure |
| `401` | `{ "error": "..." }` | Missing/invalid/expired Bearer token |
| `429` | `{ "error": "Too many requests" }` | Rate limit exceeded |
| `500` | `{ "error": "Internal server error" }` | Unexpected route failure |

### Server-side flow

1. Applies Upstash rate limiting (60/hr) **before** auth.
2. Validates the Bearer token via `authenticateBearerRequest()`.
3. Parses and validates `eventType` / `outcome` against the client allowlist (`login`/`logout` only).
4. Resolves actor identity via `resolveSecurityLogIdentity()` (profile → JWT `user_role` → technician fallback).
5. Writes via `logSecurityEvent()` (service-role insert; failures logged server-side, do not throw to the client as a failed login/logout).

### Security notes

- Actor identity and `lab_id` come from the verified token / profile lookup — never from the body.
- This route cannot invent recovery or deactivation event types; those are server-only writes from their respective routes.
- Forced/system sign-outs (archived-lab gate, deactivated gate, missing-profile poll) deliberately do **not** call this route.

---

## Environment Variables Referenced

| Variable | Used By | Scope |
|----------|---------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | All routes | Client + Server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `/api/mfa/enroll` (user-scoped client) | Client + Server |
| `SUPABASE_SERVICE_ROLE_KEY` | All routes (admin client; MFA routes via `lib/mfa-api-auth.ts`) | Server only — never expose |
| `SUPABASE_WEBHOOK_SECRET` | `/api/feedback-notify` | Server only |
| `RESEND_API_KEY` | `/api/feedback-notify` | Server only |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `/api/feedback-notify` | Server only |
| `GOOGLE_PRIVATE_KEY` | `/api/feedback-notify` | Server only |
| `GOOGLE_SHEET_ID` | `/api/feedback-notify` | Server only |
| `UPSTASH_REDIS_REST_URL` | Rate-limited routes (all except recovery-elevation-status) | Server only |
| `UPSTASH_REDIS_REST_TOKEN` | Rate-limited routes (all except recovery-elevation-status) | Server only |

`NEXT_PUBLIC_` prefixed variables are safe to expose to the browser. All others must remain server-only and must never be assigned a `NEXT_PUBLIC_` prefix.

---

## Common Error Patterns

### 401 Unauthorized
All routes validate the caller's identity before any business logic runs. For webhook routes, this is the `x-webhook-secret` header. For user-facing routes, this is a `Bearer` token validated against Supabase's admin client (or, for `/api/super-admin/user-email`, against the admin client plus a `profiles.role = super_admin` check).

**Ordering vs rate limits:** On every rate-limited route, the Upstash check runs **before** auth. An unauthenticated (or invalid-token) caller who exceeds the limit receives `429` and may never see `401`. Only after the limiter allows the request does auth run and potentially return `401`/`403`. Exception: `GET /api/mfa/recovery-elevation-status` has no rate limiter by design (called on every gate evaluation), so auth is always the first gate on that route.

### 429 Too Many Requests
Rate-limited routes use Upstash Redis sliding-window limiting, with per-route limits: feedback-notify 10/hr, mfa/enroll 10/hr, recovery-codes/generate 10/hr, recovery-codes/redeem 20/hr, super-admin/user-email 20/hr, users/set-active 20/hr, security-log 60/hr. Every limited route uses a route-specific prefixed key (e.g. `feedback-notify:<ip>`) so buckets cannot collide. The recovery-elevation-status route has no rate limit. Response headers on limited routes include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.

### 500 Internal Server Error
Most routes catch unexpected errors and return an error JSON body (feedback-notify includes a `details` message string — never a stack trace). The recovery-elevation-status route is the exception: it never returns 500, instead failing closed to `{ "elevated": false }` on any error. All server errors are logged to Vercel's server-side log stream.
