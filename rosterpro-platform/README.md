# RosterPro Enterprise — Build Log

This is an incremental, module-by-module conversion of the RosterPro HTML
prototype into a production-grade platform, as requested. Each module is
built completely and correctly before moving to the next — nothing below is
a placeholder or stub.

## Module 1 (this delivery): Foundation — repo structure, database, RBAC seed

### What's actually in this module

```
rosterpro-platform/
├── docker-compose.yml          # Postgres + Adminer + backend, one command to run locally
├── backend/
│   ├── package.json            # full dependency set for every module ahead (auth, email,
│   │                            #   WhatsApp, PDF/Excel, logging, rate limiting, testing)
│   ├── prisma/
│   │   ├── schema.prisma       # complete normalized schema — 30 models, 8 enums
│   │   └── seed.js             # seeds the 9 roles × permission matrix + base shift codes
│   └── src/                    # empty module folders ready for Module 2 (controllers,
│                                #   services, repositories, routes, middleware, validators,
│                                #   utils, jobs, config) — this is the MVC + repository +
│                                #   service layering the spec asked for; Module 2 fills it in
├── frontend/                   # Vite/React scaffold folders — filled in during the
│                                #   frontend module, after the API exists to call
└── infra/
    ├── docker/                 # Dockerfiles land here in the deployment module
    └── aws/                    # Terraform/CDK for EC2, RDS, S3, CloudFront, SES in the AWS module
```

### Database design decisions worth knowing about

- **30 models** covering every entity in the spec: Users, Stations, Airlines,
  Aircraft, Roster, Shift, Leave, Qualifications, License, Training,
  Authorizations, Tool Control, Calibration, Stores, Audit Findings, CAPA,
  Engineering Delays, Flight, Notifications, Attachments, Activity Logs —
  plus Role/Permission/RolePermission/UserRole for RBAC, RefreshToken for
  auth, and AuditTrail for change history.
- **Every business table** has `id` (UUID), `createdById`/`updatedById`,
  `createdAt`/`updatedAt`, `deletedAt` (soft delete), `version` (optimistic
  locking) — exactly as specified.
- **Change history is centralized**, not duplicated per table. Rather than
  adding "old value / new value / who / when / IP / reason" columns to all
  20 business tables, there's one `AuditTrail` table keyed by
  `(entityType, entityId)` that every service writes to on update. This is
  the standard enterprise pattern (same idea as an event log) — one place to
  query "show me everything that happened to shift assignment X," instead of
  twenty different history tables with inconsistent shapes.
- **RBAC is data, not code.** The 9 roles and their permissions
  (`role_permissions`) live in the database via `seed.js`, so an Airline
  Admin can be granted or restricted permissions later through an admin
  screen without a code deploy. I mapped a sensible default permission set
  per role based on real MRO/line-maintenance responsibilities (e.g. Store
  Keeper gets full store access but only read-only elsewhere; Read-Only
  Auditor gets `*:read` and nothing else) — worth reviewing and adjusting
  once you see it against your actual SOPs.

### How to run this module right now

```bash
cd rosterpro-platform
docker compose up -d postgres adminer     # starts Postgres on :5432, DB browser on :8080
cd backend
npm install                                # needs internet — I can't run this in my sandbox
cp .env.example .env                       # (created in Module 2, alongside the server)
npx prisma migrate dev --name init         # creates all 30 tables from schema.prisma
npx prisma db seed                         # loads roles, permissions, shift codes
```

I validated `schema.prisma` structurally (brace balance, all 30 model names
resolve, every relation has a matching back-reference) with a custom parser
in my sandbox, since I don't have internet access here to run
`npx prisma validate` directly — that command is worth running yourself as
the first step, before trusting anything downstream of it.

## Module 2 (this delivery): Backend core — auth, RBAC, error handling, logging

Note: while scoping this, I folded what I'd originally planned as "Module 3:
Auth features" into this module — forgot/reset password, email verification,
and MFA are all core parts of a login system, not a separate layer on top of
it, so it made more sense to build them together. The roadmap below is
renumbered accordingly.

### What's actually in this module

```
backend/src/
├── config/
│   ├── env.js            # validates required env vars at boot, fails fast if missing
│   ├── logger.js         # Winston — JSON logs in prod, readable in dev
│   └── prisma.js         # shared Prisma client singleton
├── utils/
│   ├── ApiError.js        # typed errors (400/401/403/404/409/429/500) the error handler understands
│   ├── asyncHandler.js     # wraps async route handlers so thrown errors reach Express
│   ├── jwt.js              # access token signing/verification + refresh token hashing
│   ├── password.js         # bcrypt hashing + password strength rule
│   └── auditTrail.js       # the ONE write path for change history — every service uses this
├── middleware/
│   ├── auth.js             # requireAuth — verifies the JWT, populates req.user
│   ├── rbac.js             # requirePermission("resource","action") — reads permissions from the token
│   ├── validate.js         # zod-schema request validation
│   ├── rateLimiter.js      # general API limit + a tight one on auth endpoints specifically
│   └── errorHandler.js     # central error handling, incl. translating Prisma errors to clean HTTP errors
├── validators/authValidators.js   # zod schemas: login, refresh, forgot/reset/change password, MFA, verify-email
├── repositories/           # Prisma queries only — no business logic
│   ├── userRepository.js
│   ├── refreshTokenRepository.js
│   └── userListRepository.js      # paginated list — the template for every Module 3 list endpoint
├── services/                # business logic — this is what's actually unit tested
│   ├── authService.js       # login, refresh (with rotation), logout, forgot/reset/change password,
│   │                        #   email verification, MFA setup/verify/disable
│   ├── mfaService.js        # TOTP via speakeasy, secret encrypted at rest (AES-256-GCM)
│   └── emailService.js      # nodemailer wrapper + verification/reset email templates
├── controllers/              # thin — parse request, call service, shape response
│   ├── authController.js
│   └── userController.js     # demo RBAC-protected list endpoint
├── routes/                   # authRoutes, userRoutes, index.js mounting both + /health
├── app.js                    # helmet (incl. CSP), CORS, compression, rate limiting, route mounting
└── server.js                 # listen + graceful shutdown on SIGTERM/SIGINT
tests/authService.test.js      # unit tests for every branch of the login/password/refresh logic
```

### Design decisions worth knowing about

- **Access + refresh token split, with rotation.** Access tokens are short-
  lived (15 min default) JWTs carrying the user's permissions, so most
  requests never hit the database for an authorization check. Refresh
  tokens are opaque random strings stored **hashed** in the DB (so a DB leak
  doesn't hand out usable tokens) and **rotate on every use** — each refresh
  revokes the old token and issues a new pair, so a stolen refresh token
  stops working the moment the legitimate user refreshes again.
- **RBAC reads from the token, not the DB, by default** — fast, but means a
  permission change takes up to 15 minutes to apply to an already-logged-in
  user. `requirePermissionLive` (also in `middleware/rbac.js`) is the DB-
  backed alternative for anything sensitive enough that "instantly" matters
  more than "fast" — e.g. you'd want that on the endpoint that deactivates a
  user's account.
- **No user enumeration.** Login failure, unknown-email, and forgot-password
  on a non-existent address all return the same generic response — a
  standard security requirement for anything with real user accounts.
- **MFA secrets are encrypted at rest**, not stored plaintext, using a
  separate encryption key from the JWT secrets (so rotating one doesn't
  force rotating the other).
- **The audit trail is actually wired up** now (`utils/auditTrail.js`) —
  `logActivity` is called on login, password reset/change, and MFA
  enable/disable. `recordUpdate` (the field-level old/new-value diffing
  version) is written and ready, but doesn't have a caller yet — that
  happens in Module 3 when there are actual domain entities (roster edits,
  leave approvals) worth diffing.
- **Errors are typed, not stringly-checked.** Every service throws
  `ApiError.unauthorized(...)` / `.forbidden(...)` / etc., and the central
  handler in `middleware/errorHandler.js` also knows how to translate raw
  Prisma errors (unique constraint → 409, not-found → 404) so nothing ever
  leaks a Prisma stack trace to a client.
- **Unit tests use mocked repositories**, not a real database — this is
  what the repository/service split is *for*. `tests/authService.test.js`
  covers the full decision tree: wrong password, unverified email, MFA
  required/wrong/correct, password-reset token validity, refresh rotation.
  I syntax-checked every file in my sandbox; I couldn't run the actual test
  suite because it needs `npm install` (no internet in my sandbox) — that's
  the first thing to run once you pull this down.

### How to run this module

```bash
cd rosterpro-platform
docker compose up -d postgres
cd backend
npm install
cp .env.example .env
# Generate real secrets:
#   openssl rand -hex 32   → JWT_ACCESS_SECRET
#   openssl rand -hex 32   → JWT_REFRESH_SECRET  (must differ from the above)
#   openssl rand -hex 32   → MFA_ENCRYPTION_KEY
npx prisma migrate dev --name init
npx prisma db seed
npm test              # runs tests/authService.test.js
npm run dev           # http://localhost:4000/api/health should return { ok: true }
```

There's no user-creation endpoint yet (that's part of Module 3's user-
management API) — to log in and test manually, insert a user directly via
Adminer (`http://localhost:8080`) with a bcrypt-hashed password and
`isEmailVerified = true`, and give them a role via `user_roles`.

## Module 3 (this delivery): Roster, Shift & Leave APIs

The two domains that are actually the heart of "roster management" — built
completely, rather than spreading effort thin across all twelve entities at
once. The remaining domains (qualifications, licenses, training, tools,
stores, audit findings/CAPA, flights) follow the exact same pattern and are
Module 3b, next.

### What's in this module

```
backend/src/
├── validators/
│   ├── rosterValidators.js   # shift upsert, bulk upsert, publish, grid query
│   └── leaveValidators.js    # request/decide/list, with fromDate<=toDate check
├── repositories/
│   ├── rosterRepository.js   # roster + shift_assignment queries, bulk upsert via transaction
│   └── leaveRepository.js    # leave CRUD, overlap detection, year-scoped approved-leave lookup
├── services/
│   ├── rosterService.js      # get-or-create roster, shift upsert (single + bulk), publish
│   └── leaveService.js       # request/approve/reject/cancel, leave-balance calculation
├── controllers/rosterController.js, leaveController.js
└── routes/rosterRoutes.js, leaveRoutes.js
tests/rosterService.test.js, leaveService.test.js
```

### Endpoints added

```
GET   /api/roster/shift-definitions
GET   /api/roster?stationId=&monthKey=            # full staff × day grid
PATCH /api/roster/shift?stationId=&monthKey=       # one cell — { userId, shiftDate, shiftCode, note?, reason? }
POST  /api/roster/shift/bulk?stationId=&monthKey=  # many cells at once (e.g. applying a generated roster)
POST  /api/roster/publish                          # { rosterId }

GET   /api/leave?userId=&status=&from=&to=&page=&pageSize=
GET   /api/leave/balance/:userId?year=2026
POST  /api/leave                                    # { leaveType, fromDate, toDate, reason?, userId? }
POST  /api/leave/:id/decide                          # { decision: APPROVED|REJECTED, reason? }
POST  /api/leave/:id/cancel
```

### Decisions worth knowing about

- **Field-level audit trail is now actually recorded**, not just wired and
  waiting — every single-cell shift edit (`PATCH /roster/shift`) diffs the
  old shift code against the new one and writes an `AuditTrail` row via
  `recordUpdate`, but **only when the value actually changed** — saving the
  same shift code twice doesn't spam the history. Publishing a roster and
  every leave decision write audit rows the same way.
- **Bulk shift updates deliberately skip per-cell diffing.** Applying a
  generated roster (or a whole pattern) can touch hundreds of cells at once;
  writing individual "field X changed" rows for that isn't useful history —
  it's noise. Bulk operations get one `ActivityLog` entry ("Bulk roster
  update: 341 shifts"); manual single-cell edits get the full old→new audit
  trail. This mirrors how a real ops team would want to *read* that history
  back later.
- **A published roster is locked** — both the single and bulk shift
  endpoints reject edits once `isPublished` is true, forcing an explicit
  unpublish (an admin action, not built yet — flagged for Module 3b) rather
  than silently allowing drift between what was "published" and what's
  actually in the database.
- **Leave overlap detection** blocks a new request if it overlaps any
  existing pending/approved leave for the same person — prevents accidental
  double-booking without needing a human to catch it in review.
- **Leave balance is computed, not stored** — entitlement minus approved
  days taken this calendar year, correctly clipping a leave that spans a
  year boundary (verified: a Dec 29 → Jan 2 leave counts only 2 days against
  the new year, not all 5). The entitlement table
  (`leaveRepository.DEFAULT_ENTITLEMENT`) is a flat default — a proper
  per-category/per-airline policy table is worth building once you have a
  second airline on the platform with different entitlement rules.
- **RBAC scoping goes beyond "can you call this endpoint"** — see
  `leaveController.request`: the validator allows a manager to file leave on
  someone else's behalf, but the controller explicitly checks the caller's
  role before allowing `userId` to differ from their own — the same pattern
  `userController.list` from Module 2 established for read-scoping applies
  here to a write.

### Testing

Because I can't `npm install` in this sandbox (no internet), I couldn't run
the real Jest suite (`tests/rosterService.test.js`, `tests/leaveService.test.js`)
directly. To get real confidence beyond a syntax check, I built a throwaway
manual mock harness (same technique Jest uses — injecting fake repository
modules before requiring the service) and ran the actual business logic
against it: **23 assertions, all passing**, including the tricky one —
correctly clipping a leave that spans a Dec 31/Jan 1 boundary to only the
days that fall in the requested year. That harness isn't part of this
delivery (it was scaffolding for my own verification); the real Jest tests
are what's shipped, and `npm test` should reproduce the same results once
you `npm install`.

## Module 3b (this delivery): Remaining domain APIs

Everything else from the entity list: qualifications, licenses, training,
authorizations, tools/calibration, stores, audit findings/CAPA, and
flights/engineering delays — plus the roster-unpublish admin action flagged
as a gap at the end of Module 3.

### What's in this module

```
backend/src/
├── validators/     complianceValidators.js, toolValidators.js, storeValidators.js,
│                    qualityValidators.js, flightValidators.js
├── repositories/    complianceRepository.js (quals+licenses+training+authorizations),
│                    toolRepository.js, storeRepository.js, qualityRepository.js, flightRepository.js
├── services/        complianceService.js, toolService.js, storeService.js,
│                    qualityService.js, flightService.js
├── controllers/     complianceController.js, toolController.js, storeController.js,
│                    qualityController.js, flightController.js
└── routes/          complianceRoutes.js, toolRoutes.js, storeRoutes.js,
                     qualityRoutes.js, flightRoutes.js
tests/               complianceService.test.js, toolService.test.js, storeService.test.js,
                     + unpublish tests added to rosterService.test.js
```

### Endpoints added

```
# Compliance (qualifications, licenses, training, authorizations)
GET   /api/compliance/summary/:userId                  # combined view, drives roster-generation blocking
GET   /api/compliance/qualifications/expiring?days=30
GET   /api/compliance/qualifications/:userId
POST  /api/compliance/qualifications
PATCH /api/compliance/qualifications/:id
DELETE /api/compliance/qualifications/:id
GET   /api/compliance/licenses/expiring?days=30
GET   /api/compliance/licenses/:userId
POST  /api/compliance/licenses
PATCH /api/compliance/licenses/:id
GET   /api/compliance/trainings/:userId
POST  /api/compliance/trainings
GET   /api/compliance/authorizations/:userId
POST  /api/compliance/authorizations

# Tool control
GET   /api/tools/due-for-calibration?days=30
GET   /api/tools/station/:stationId
POST  /api/tools
POST  /api/tools/:id/calibrate
POST  /api/tools/:id/issue
POST  /api/tools/return                                 # { issueId }

# Stores
GET   /api/stores/station/:stationId
GET   /api/stores/station/:stationId/low-stock
GET   /api/stores/:id/movements
POST  /api/stores
POST  /api/stores/:id/movement                          # { direction: IN|OUT, quantity, reference?, note? }

# Quality (audit findings + CAPA)
GET   /api/quality/overdue
GET   /api/quality/findings/station/:stationId?status=
POST  /api/quality/findings
PATCH /api/quality/findings/:id
GET   /api/quality/capas/owner/:ownerId?status=
POST  /api/quality/capas
POST  /api/quality/capas/:id/close

# Flights
GET   /api/flights/station/:stationId?from=&to=
GET   /api/flights/station/:stationId/delays?from=&to=
POST  /api/flights
PATCH /api/flights/:id/status
POST  /api/flights/delays

# Roster (addition)
POST  /api/roster/unpublish                              # { rosterId, reason }  — requires roster:unpublish
```

### Decisions worth knowing about

- **Qualification/license/authorization status is derived on every read,
  not trusted from a stored column.** A qualification saved as `VALID` a
  month ago should show `EXPIRING` today even if nobody has touched the
  record since — `complianceService.deriveStatus()` recomputes from the
  expiry date every time, and the tests specifically check that a
  deliberately stale stored value gets overridden on read. `Qualification`
  still *stores* a status column (matching the schema), written at
  create/update time — the persisted value is a snapshot for reporting
  convenience, the derived value on read is what's actually trustworthy.
- **`getComplianceSummary` is the roster-generation blocking check** — it
  mirrors the prototype's `isStaffBlocked`, now backed by real per-record
  expiry dates across qualifications and licenses instead of a flat array.
  This is what Module 6 (frontend) will call before letting the roster
  generator assign someone a shift.
- **Tool issue/return prevents double-issue and blocks unsafe tools.** A
  tool can't be issued while it already has an open issue record (no
  "lending the same torque wrench to two people"), and can't be issued at
  all if its status is `OVERDUE` or `QUARANTINED` — verified in
  `toolService.test.js`.
- **Store quantity changes and their movement record are one atomic
  transaction** (`storeRepository.adjustQuantity`), so a crash between
  updating the count and logging the movement can never happen — they
  either both commit or neither does. Issuing more than what's on hand is
  rejected with a clear 400, not a negative stock count.
- **Low-stock alerts fire automatically** the moment a movement drops
  quantity below `minStockLevel` — logged via `ActivityLog` now, this is
  exactly the kind of event Module 4's notification system will pick up and
  email to the store keeper.
- **CAPA/finding status cascades sensibly**: opening a CAPA against an
  `OPEN` finding moves the finding to `IN_PROGRESS`; closing the last open
  CAPA against a finding automatically closes the finding too — matching
  how a real quality team works (a finding isn't "done" until every
  corrective action against it is).
- **Roster unpublish is deliberately harder to do than publish** — it's a
  separate permission (`roster:unpublish`, not reused from `roster:publish`)
  and **requires a non-empty reason**, because reopening a roster staff may
  already be relying on for their next shift is a bigger deal than
  publishing one. Verified in the updated `rosterService.test.js`.

### Testing

Same approach as Module 3: I can't `npm install` in this sandbox, so I built
a throwaway manual mock harness (not part of the delivery) and actually ran
the new business logic against it — **16 assertions, all passing**,
including the double-issue/double-return prevention, the insufficient-stock
rejection, the low-stock alert firing exactly when it should (and *not*
firing when stock is healthy), and the stale-status re-derivation. The real
Jest tests shipped in `tests/` mirror that same coverage; `npm test` should
reproduce it once you `npm install`.

## Module 4 (this delivery): Notifications — email + WhatsApp

This is what turns the audit-trail hooks left as comments throughout
Modules 3 and 3b into actual delivered emails and WhatsApp messages —
directly answering the original ask: daily shift reminders (#2) and
shift-change alerts via WhatsApp/email (#3).

### What's in this module

```
backend/src/
├── repositories/notificationRepository.js   # durable record of every notification attempt
├── services/
│   ├── whatsappService.js      # Twilio wrapper
│   └── notificationService.js  # the single dispatcher every domain service calls through
├── controllers/notificationController.js, routes/notificationRoutes.js
│                                # GET /api/notifications/me and /:userId — see your own
│                                #   delivery history, or (with permission) someone else's
└── jobs/scheduledJobs.js       # 4 cron jobs, started from server.js
tests/notificationService.test.js  # + new tests added to rosterService.test.js, leaveService.test.js
```

### How it's wired into the domains you already have

| Trigger | Where | Channels |
|---|---|---|
| A shift is edited (and the value actually changed) | `rosterService.upsertShift` | Email **and** WhatsApp |
| Roster published | `rosterService.publishRoster` | Email, to every active staff member at the station |
| Roster unpublished | `rosterService.unpublishRoster` | Email, same audience — framed more urgently |
| Leave approved/rejected | `leaveService.decideLeave` | Email, to the leave owner |
| Stock drops below minimum | `storeService.recordMovement` | Email, to Station Managers + Store Keepers at that station |
| Qualification/license expiring (daily job) | `jobs/scheduledJobs.js` @ 06:00 | Email, to the staff member |
| Tool calibration due (daily job) | `jobs/scheduledJobs.js` @ 06:00 | Email, to Station Managers/LMM/Store Keepers |
| Overdue CAPA / audit finding (daily job) | `jobs/scheduledJobs.js` @ 06:00 | Email, to the CAPA owner / finding raiser |
| **Your shift tomorrow** (daily job) | `jobs/scheduledJobs.js` @ 18:00 | Email, deduplicated so it never double-sends |

### Design decisions worth knowing about

- **One dispatcher, one durable record, per attempt.** Every single
  notification — regardless of which domain service triggered it — goes
  through `notificationService.dispatch()`, which writes a `Notification`
  row *before* attempting delivery (so there's a record even if the process
  crashes mid-send), then marks it `SENT` or `FAILED` with the actual error
  message. Nothing gets silently lost; `GET /api/notifications/me` is a real
  delivery log, not a guess.
- **A notification failure can never break the business operation that
  triggered it.** `dispatch()` never throws — tested explicitly. Approving
  someone's leave must succeed even if their email bounces; the roster
  publish must go through even if Twilio is down. Every domain-service hook
  is fire-and-forget with its own error handling, not something the
  triggering request waits on or can fail because of.
- **Found and fixed a real bug while verifying this**: `leaveService`'s
  original notification call built its email content by directly accessing
  `leave.fromDate.toISOString()` as part of the function-call arguments —
  if that ever evaluated on a malformed record, it would throw
  *synchronously*, before the `.catch()` on the returned promise could ever
  catch anything, taking the whole leave-approval request down with it. In
  practice `leave` always comes from a real Prisma query where those fields
  are non-nullable, so this couldn't happen with real data — but I wrapped
  it in a proper `try/catch` async helper anyway (matching the pattern
  already used in `rosterService`), so a malformed record can never take
  down the approval itself, only the notification. Caught this specifically
  by testing with a deliberately malformed mock record, not by reading the
  code — worth remembering when you extend this pattern to new hooks later.
- **The daily shift reminder only fires for published rosters.** Deliberately
  excludes shifts on a draft roster — nobody should get a "your shift
  tomorrow" email for something that might still change before publish.
- **The daily reminder is deduplicated per user per day** — if the job ever
  re-runs (server restart mid-run, manual re-trigger), nobody gets the same
  reminder twice. Verified in tests.
- **Low-stock and tool-calibration alerts resolve recipients by role at the
  station**, not a hardcoded contact — `userRepo.findContactsByRoleAtStation`
  finds every active Station Manager/Store Keeper/LMM at the relevant
  station, so the right people get notified automatically as staffing
  changes, with no config to keep in sync.
- **WhatsApp requires real setup before it does anything** — with no Twilio
  credentials configured, `whatsappService.send()` logs the message instead
  of sending it (same graceful-degradation pattern as email), so the app
  runs fine in dev without either configured. See `.env.example` for the
  Twilio Sandbox setup steps; production WhatsApp needs Meta business
  verification, same as noted for the standalone MVP backend earlier.

### Testing

Same approach as every module so far — no internet in this sandbox to
`npm install` and run the real suite, so I built a throwaway manual mock
harness and ran the actual logic: **25 assertions across three harness
runs, all passing**, including the specific test that caught the
synchronous-throw bug described above (a malformed leave record no longer
crashes `decideLeave`). The real Jest tests shipped in `tests/` cover the
same ground; `npm test` should reproduce it once you `npm install`.

## Module 5 (this delivery): Reports & Dashboard

Excel/PDF/CSV report generation with email delivery, plus the six-widget
compliance/coverage dashboard — both pulling entirely from data built in
Modules 3–3b, no new domain concepts introduced.

### What's in this module

```
backend/src/
├── utils/csv.js                    # dependency-free CSV writer (RFC 4180 quoting + BOM)
├── services/
│   ├── reportDataService.js        # fetches + shapes report data — format-independent
│   ├── reportRenderService.js      # shaped data → Excel/PDF/CSV buffer (ExcelJS/PDFKit)
│   ├── reportService.js            # orchestrates: registry of report types, download, email
│   └── dashboardService.js         # the 6 widgets
├── controllers/  reportController.js, dashboardController.js
└── routes/       reportRoutes.js, dashboardRoutes.js
tests/  reportDataService.test.js, csv.test.js, dashboardService.test.js
```

### Endpoints added

```
GET  /api/reports/download?type=roster|compliance|leave&format=excel|pdf|csv&stationId=&monthKey=&year=
POST /api/reports/email     # same params + { toEmail } — generates and emails as an attachment

GET  /api/dashboard/:stationId/summary?monthKey=&year=&from=&to=   # all 6 widgets in one call
GET  /api/dashboard/:stationId/qualification-expiry?days=30
GET  /api/dashboard/:stationId/leave-balance?year=
GET  /api/dashboard/:stationId/roster-coverage?monthKey=
GET  /api/dashboard/:stationId/flight-coverage?from=&to=
GET  /api/dashboard/:stationId/dgca-compliance
GET  /api/dashboard/:stationId/staff-workload?monthKey=
```

### Design decisions worth knowing about

- **Data shaping and format rendering are two separate layers.** Every
  report is fetched and shaped into a plain `{ header, rows }` structure
  once (`reportDataService`), then handed to whichever renderer the caller
  asked for (`reportRenderService`). This is why adding a 4th format later
  (say, HTML for in-browser preview) touches one file, not three — and why
  the data-shaping logic (date math, sort order, status derivation) is
  fully unit-testable without ExcelJS or PDFKit involved at all.
- **New report types are one registry entry, not new plumbing.**
  `reportService.REPORT_TYPES` maps a type name to a title + fetch
  function; the controller, routes, and all three renderers are completely
  generic across every report type. Adding a 4th report (say, a tool
  calibration log) means adding one object to that registry.
- **PDF tables are hand-rolled** — PDFKit has no built-in table widget (unlike
  the frontend's jsPDF+autotable). The renderer paginates automatically,
  repeats the header on every new page, and picks landscape vs portrait
  based on column count — deliberately simple (fixed-width columns, no cell
  merging) since this is meant to produce a printable list/audit report,
  not a pixel-perfect layout.
- **The compliance report sorts EXPIRED records to the top** regardless of
  staff name — the point of printing this report is triage, so the most
  urgent rows should never be buried alphabetically. Verified in tests with
  a deliberately adversarial ordering (the expired record belongs to a
  staff member who'd otherwise sort last).
- **Roster coverage re-checks the actual published rule**, not just whether
  the generator tried to follow it — it independently recomputes "does
  every shift have ≥1 B1, does every night shift have ≥1 B2" straight from
  the shift assignment records, so it catches manual edits made after
  generation that broke the rule, not just generator bugs.
- **Staff workload flags overload relative to the group's own average**
  (>130% of the mean duty+night days that month), not a hardcoded policy
  number — it adapts automatically to short months, part-time rosters, or
  different staffing levels without a config value to keep updated.
- **Flight coverage counts unique delayed flights, not delay records** — a
  flight with two logged engineering delays should count once toward
  "delayed flights," not twice; verified explicitly in tests since it's an
  easy off-by-one to get wrong with a naive `delays.length`.
- **Emailing a report reuses the same durable-attempt pattern as Module 4** —
  `emailService.sendReport()` builds on the same `send()` primitive, and
  every emailed report is logged to `ActivityLog`.

### Testing

Same approach as every module: no internet in this sandbox to run the real
suite, so I verified the actual logic with a throwaway manual mock harness
— **32 assertions across three runs, all passing**, including the two I'd
call genuinely load-bearing: the roster-coverage rule correctly
distinguishing "no B1 at all" from "B1 present but no B2 at night" (these
are different violations with different fixes), and flight coverage
correctly de-duplicating by flight rather than counting delay records. The
CSV utility needed no mocking at all and ran for real, byte-for-byte. The
shipped Jest tests in `tests/` mirror this same coverage.

## Roadmap — what's next, in order

1. ~~**Module 1: Foundation**~~ — done.
2. ~~**Module 2: Backend core + auth**~~ — done.
3. ~~**Module 3: Roster, Shift & Leave APIs**~~ — done.
4. ~~**Module 3b: Remaining domain APIs**~~ — done.
5. ~~**Module 4: Notifications**~~ — done.
6. ~~**Module 5: Reports & Dashboard**~~ — done (this delivery).
7. **Module 6: Frontend** — React + Vite + Tailwind, reusing your existing
   HTML/CSS pixel-for-pixel, wired to this API (auth, roster grid,
   dashboard widgets, report download buttons).
8. **Module 7: Deployment** — Dockerfiles, GitHub Actions CI/CD, AWS guide,
   backup/DR.

## Module 6 Pass 1 (this delivery): Frontend shell, auth, and the Roster screen

React + Vite + Tailwind, wired to the real API for the first time. As
planned, split into two passes — this one covers the shell (login, sidebar,
routing, RBAC-aware navigation) plus the two screens that exercise the most
of the stack end-to-end: the Dashboard and the Shift Roster grid.

### What's in this pass

```
frontend/
├── package.json, vite.config.js, tailwind.config.js, postcss.config.js
├── index.html
└── src/
    ├── styles/rosterpro.css      # the prototype's COMPLETE original CSS, extracted verbatim
    ├── index.css                 # Tailwind directives + imports rosterpro.css
    ├── api/
    │   ├── client.js             # JWT handling, automatic refresh-token rotation
    │   ├── auth.js, roster.js, dashboard.js, staff.js, reports.js
    ├── store/
    │   ├── AuthContext.jsx       # session state + hasPermission()/hasRole() RBAC checks
    │   └── PageHeaderContext.jsx # lets each page set the topbar without breaking its layout
    ├── components/
    │   ├── common/ProtectedRoute.jsx
    │   ├── layout/Sidebar.jsx, TopBar.jsx, AppLayout.jsx
    │   └── roster/ShiftEditModal.jsx
    └── pages/ LoginPage.jsx, DashboardPage.jsx, RosterPage.jsx, StaffPage.jsx
```

### The UI is pixel-for-pixel the original — with two necessary, disclosed exceptions

Per your instruction not to redesign anything, `rosterpro.css` is the
prototype's stylesheet extracted **verbatim** — every color variable,
component class, spacing value, and the dark theme are untouched. I
cross-checked every `className` used across all 19 React files against that
stylesheet programmatically; nothing references a class that doesn't exist
in it. Two things did have to change, both forced by moving to a real
backend rather than any visual preference:

1. **Login asks for email, not username.** The backend's `User` model
   (Module 1's schema) authenticates by email — there's no username field.
   Same layout, same `l-input`/`l-label` classes, just a different field.
2. **"Continue as View-Only" is gone.** In the prototype this was a
   shortcut into a hardcoded demo account. With real RBAC, "view only" is
   now just what a `READ_ONLY_AUDITOR` account's permissions naturally
   produce (buttons that require a permission simply don't render) — there's
   no separate anonymous-viewer path to preserve, since every real user
   needs a real account either way.

### Design decisions worth knowing about

- **TopBar had to become a shared context, not a per-page component.** The
  prototype's CSS requires `.topbar` to be a fixed-height flex sibling of
  `.content` (`.main` is a flex column: topbar `flex-shrink:0` above content
  `flex:1; overflow-y:auto`). If each page rendered its own topbar inside
  the routed content, it would scroll away with the page instead of staying
  fixed, breaking the original layout. `PageHeaderContext` lets each page
  *describe* its title/subtitle/actions via `usePageHeader()`, while
  `AppLayout` renders the actual `<TopBar>` in the correct DOM position.
  This was caught by reading the CSS carefully, not by trial and error.
- **RBAC in the frontend reads the same JWT the backend already issues.**
  The access token carries the user's permission list (Module 2's
  `signAccessToken`); `AuthContext` decodes it client-side, so
  `hasPermission("roster","publish")` in a component and
  `requirePermission("roster","publish")` on the backend route are checking
  the exact same source of truth — no separate "what can I do" endpoint to
  keep in sync, no risk of the UI and API disagreeing about who can do what.
- **The API client handles token refresh transparently and safely under
  concurrency.** Any call that 401s automatically retries once after a
  silent refresh — callers never see this. The one subtlety: if five
  requests all 401 at the exact moment the access token expires, they share
  a single in-flight refresh call rather than each independently calling
  `/api/auth/refresh`. That matters because Module 2's refresh endpoint
  **rotates** the refresh token on every use — five independent refresh
  calls would race and revoke each other's new tokens, silently logging the
  user out. `client.js` guards against this with one shared promise.
- **Report downloads work as real file downloads**, not a JSON blob —
  `api.download()` reads the filename the backend sets in
  `Content-Disposition` (Module 5) and triggers a real browser download via
  a temporary object URL, same UX as the original prototype's export
  buttons.
- **Token storage is localStorage, flagged as a tradeoff, not a silent
  choice.** This means a reload doesn't force re-login, but it's readable
  by any JS on the page (XSS risk) in a way an httpOnly cookie wouldn't be.
  Fixing this later means the backend setting/reading cookies instead of
  returning JSON tokens — a real (if fairly contained) change to Module 2's
  auth endpoints, which is why I didn't just silently pick the weaker
  option without saying so.

### Verification

I don't have Node's package registry available in this sandbox (same
constraint as every backend module), so I couldn't run `npm install` and
build/serve the app for real. What I could and did do: wrote a small script
using the `typescript` compiler package (available locally) to
syntax-check every `.jsx`/`.js` file via `ts.transpileModule` — **19 files,
zero syntax errors** — then a second script verifying every relative
`import` path actually resolves to a real file — **zero unresolved
imports** — and a third cross-checking every `className` used in JSX
against what's actually defined in `rosterpro.css` — **zero undefined
classes referenced**. That's real verification of structure and wiring,
short of an actual running build; running `npm install && npm run dev` is
the natural next check once you pull this down.

## Roadmap — what's next, in order

1. ~~**Module 1: Foundation**~~ — done.
2. ~~**Module 2: Backend core + auth**~~ — done.
3. ~~**Module 3: Roster, Shift & Leave APIs**~~ — done.
4. ~~**Module 3b: Remaining domain APIs**~~ — done.
5. ~~**Module 4: Notifications**~~ — done.
6. ~~**Module 5: Reports & Dashboard**~~ — done.
7. ~~**Module 6 Pass 1: Frontend shell, auth, Dashboard, Roster**~~ — done
   (this delivery).
8. **Module 6 Pass 2: Remaining screens** — Rolling 7-Day, Daily Coverage,
   Auto-Roster generator UI, Qualifications, Change History, Past Rosters,
   Compliance Rules, Leave requests, plus the report-download/email panel
   and a station switcher for multi-station accounts.
9. **Module 7: Deployment** — Dockerfiles, GitHub Actions CI/CD, AWS guide,
   backup/DR.

## Module 6 Pass 2 (this delivery): Leave, Qualifications, Reports

Three more screens, chosen for having the clearest API mappings and the
highest day-to-day value: staff requesting/managers approving leave,
viewing and adding compliance records, and downloading/emailing reports.
The Auto-Roster generator UI (the single most complex screen in the
original prototype — workload builder, shift patterns, staff allocation,
generate/apply flow) is deliberately deferred to Pass 3, along with the
remaining read-only views, rather than rushed here.

### What's in this pass

```
frontend/src/
├── api/  compliance.js, leave.js
├── components/
│   ├── compliance/AddRecordModal.jsx   # one modal, four record types (qual/license/training/authorization)
│   └── leave/RequestLeaveModal.jsx
└── pages/  LeavePage.jsx, QualificationsPage.jsx, ReportsPage.jsx
```

Sidebar and routing updated accordingly — each new nav item is gated by
the same permission the backend route requires (`leave:read`,
`qualification:read`, `reports:export`), so a Technician's sidebar simply
doesn't show "Reports" rather than showing it and then 403ing.

### Design decisions worth knowing about

- **One modal, four record types.** `AddRecordModal` isn't four separate
  components — it's a small registry (`RECORD_TYPES`) mapping a record
  type to its fields and its create function, with the form rendering
  generically off that. Adding a 5th compliance record type later is one
  registry entry, the same pattern `reportService`'s `REPORT_TYPES`
  established on the backend in Module 5.
- **Leave approval enforces the same rule the backend already enforces —
  redundantly, on purpose.** A Technician can't see Approve/Reject buttons
  (gated by `hasPermission("leave","approve")`), but even if they somehow
  triggered the action, the backend's `requirePermission` middleware would
  reject it independently. This is the same "defense in depth, not
  defense instead of" principle the backend's RBAC follows — the frontend
  check is for UX (don't show a button that will fail), never the actual
  security boundary.
- **The balance widget on the Leave page fails silently if it errors**,
  while the leave list itself surfaces errors properly — a deliberate
  asymmetry. A missing balance is a degraded-but-usable page; a broken
  leave list is not. Worth noticing this pattern since it'll come up again:
  not every failed fetch deserves the same treatment.
- **Report downloads and emails share one params object**, built once from
  the selected type/format/month/year, rather than duplicating the
  station/monthKey/year logic between the download button and the email
  button — the same shape Module 5's backend registry expects.

### Verification

Same method as Pass 1: no `npm install` available in this sandbox, so I
syntax-checked all 26 `.jsx`/`.js` files with the TypeScript compiler
(**zero errors**), verified all relative imports resolve (**zero
unresolved**), and cross-checked every `className` against the stylesheet
(**zero undefined classes**, 63 unique classes now in use across the app).
I also specifically cross-checked every permission string referenced in
the frontend (`hasPermission` calls and route-gating) against what's
actually seeded in the backend's `seed.js` — this catches the class of bug
where a typo'd permission string would silently hide a button or block a
page for every single user, since the frontend and backend would simply
never agree on what that string means. Zero mismatches found.

## Roadmap — what's next, in order

1. ~~**Module 1: Foundation**~~ — done.
2. ~~**Module 2: Backend core + auth**~~ — done.
3. ~~**Module 3: Roster, Shift & Leave APIs**~~ — done.
4. ~~**Module 3b: Remaining domain APIs**~~ — done.
5. ~~**Module 4: Notifications**~~ — done.
6. ~~**Module 5: Reports & Dashboard**~~ — done.
7. ~~**Module 6 Pass 1: Frontend shell, auth, Dashboard, Roster**~~ — done.
8. ~~**Module 6 Pass 2: Leave, Qualifications, Reports**~~ — done (this
   delivery).
9. **Module 6 Pass 3: Remaining screens** — the Auto-Roster generator UI
   (workload input, shift patterns, staff allocation, generate/apply),
   Rolling 7-Day and Daily Coverage views, Change History/audit trail
   viewer, Past Rosters archive, Compliance Rules admin page, Tool
   Control, Stores, Quality (Audit Findings/CAPA), Flight tracking, and a
   station switcher for multi-station accounts.
10. **Module 7: Deployment** — Dockerfiles, GitHub Actions CI/CD, AWS guide,
    backup/DR.

## Module 6 Pass 3 (this delivery): the Auto-Roster generator, for real

Before writing any frontend for this, I checked whether the backend
actually had a generation algorithm yet — it didn't. The original prototype
generated rosters entirely client-side (a rotation cycle plus a coverage
patch-up pass, all in browser JS); none of that logic had been ported to
the server across Modules 1–6b. Since this was explicitly the centerpiece
of your original request, building it properly took priority over the
remaining read-only screens (Rolling 7-Day, Change History, Tool Control,
Stores, Quality, Flights), which move to Pass 4.

### What's in this pass

```
backend/src/
├── utils/rosterGenerationAlgorithm.js   # pure scheduling logic, zero DB access
├── services/rosterGenerationService.js  # fetches staff/leave/compliance, runs the
│                                          #   algorithm, persists via the existing
│                                          #   bulk-upsert path
tests/  rosterGenerationAlgorithm.test.js, rosterGenerationService.test.js

frontend/src/
├── api/roster.js                        # + generateRoster()
├── components/roster/GenerationResultPanel.jsx
└── pages/RosterPage.jsx                 # + Generate button (draft rosters only)
```

### The algorithm, and two real bugs I found and fixed while verifying it

Rotation: each staff member gets an 8-day cycle (M,M,A,A,N,N,O,O), offset
by their position in the roster so the whole station isn't in the same
phase at once. Blocked staff (expired quals/license) get all-OFF. Approved
leave overrides the rotation. Then two safety/coverage passes run — and
this is where testing earned its keep:

1. **The coverage pass could silently undo the rest-gap rule.** My first
   version ran the rest-gap check (no Night immediately followed by
   Morning) *before* the coverage pass — but the coverage pass, hunting for
   anyone to fill a gap, could reassign that exact person right back onto
   the Morning shift it had just protected them from, if they were the only
   available candidate. I caught this with an adversarial test (a single
   B1 staff member, so the coverage pass is under maximum pressure to reuse
   them) — the rotation output was `...N,N,M,M,M` where it should never
   contain `N,M` adjacent. Fixed by making the coverage pass exclude anyone
   whose previous day was Night from Morning-shift candidacy — the rest
   rule now always wins, and an unfillable gap becomes a reported
   violation instead of an unsafely double-booked, fatigued engineer. This
   is the one piece of business logic in this whole build I'd call
   safety-critical, so I'm glad it got caught by a test rather than left
   for a real roster to surface it.
2. **My own test fixtures were unrealistic, and the algorithm was right to
   fail them.** I initially tested with 2 B1 staff covering 3 daily shifts
   (M/A/N) for 30 straight days — that's physically impossible without
   either violating rest rules or leaving gaps, and the algorithm correctly
   reported dozens of violations. That's not a bug; that's the generator
   being honest about an understaffed scenario instead of quietly
   fabricating an unsafe schedule. I fixed the test fixtures to use
   realistic ratios instead of "fixing" the algorithm to hide the problem —
   worth remembering that a failing test sometimes means the test's
   assumptions were wrong, not the code.

### Design decisions worth knowing about

- **A generated roster is structurally identical to a hand-edited one** —
  same `rosterId`, same `ShiftAssignment` rows, created through the exact
  repository function (`bulkUpsertAssignments`) manual bulk edits already
  used. There's no separate "generated roster" concept to keep in sync;
  it's just data.
- **Generation is blocked on a published roster** (same rule as manual
  bulk edits) — regenerate requires an explicit unpublish first, so a
  roster staff are already relying on can't be silently rewritten.
- **Missing shift-code definitions fail loudly, not silently** — if the
  station's `ShiftDefinition` table doesn't have M/A/N/O/L seeded, the
  service refuses to generate rather than producing a roster full of
  broken foreign keys.
- **The frontend shows every violation, with the actual reason** ("Day 14,
  Night shift — missing B2"), not just a pass/fail count — a station
  manager needs to know exactly which day and category needs a manual fix
  before publishing, not just that something's wrong somewhere.

### Testing

The algorithm itself needed no mocking — it's pure — so I ran it for real,
directly, in this sandbox: **12 scenarios covering coverage adequacy,
honest violation reporting under genuine understaffing, the rest-gap fix
under adversarial pressure, blocking, and leave overrides — all passing**,
plus 3 more for the leave-date-range-to-day-set conversion (including both
directions of month-boundary clipping). The DB-touching service wrapper
still needs the usual sandbox caveat (no `npm install` here to run it for
real), but the part that actually decides who works when — the part that
matters for safety — was verified directly, not mocked around.

## Roadmap — what's next, in order

1. ~~**Module 1: Foundation**~~ — done.
2. ~~**Module 2: Backend core + auth**~~ — done.
3. ~~**Module 3: Roster, Shift & Leave APIs**~~ — done.
4. ~~**Module 3b: Remaining domain APIs**~~ — done.
5. ~~**Module 4: Notifications**~~ — done.
6. ~~**Module 5: Reports & Dashboard**~~ — done.
7. ~~**Module 6 Pass 1: Frontend shell, auth, Dashboard, Roster**~~ — done.
8. ~~**Module 6 Pass 2: Leave, Qualifications, Reports**~~ — done.
9. ~~**Module 6 Pass 3: Auto-Roster generator**~~ — done (this delivery).
10. **Module 6 Pass 4: Remaining screens** — Rolling 7-Day, Daily Coverage,
    Change History/audit trail viewer, Past Rosters archive, Compliance
    Rules admin, Tool Control, Stores, Quality (Audit Findings/CAPA),
    Flight tracking, and a station switcher for multi-station accounts.
11. **Module 7: Deployment** — Dockerfiles, GitHub Actions CI/CD, AWS guide,
    backup/DR.

## Module 6 Pass 4 (this delivery): Change History, Tool Control, Stores, Quality

### A gap found before writing any frontend code

Same discipline as Pass 3: before building a Change History screen, I
checked whether the backend actually exposed the audit data anywhere.
It didn't — `AuditTrail` and `ActivityLog` have been written to
extensively since Module 2 (every login, every shift edit, every leave
decision, every roster publish), but nothing ever read them back out via
an API. That's a real gap for a system whose entire selling point around
"audit trail" was compliance and traceability — a change history nobody
can see isn't compliance, it's just a database table. Fixed with a proper
`audit` route (repository → controller → routes) before touching React.

### What's in this pass

```
backend/src/
├── repositories/auditRepository.js   # paginated, filterable reads over AuditTrail + ActivityLog
├── controllers/auditController.js, routes/auditRoutes.js
└── validators/auditValidators.js

frontend/src/
├── api/  tools.js, stores.js, quality.js, audit.js
└── pages/  ToolControlPage.jsx, StoresPage.jsx, QualityPage.jsx, ChangeHistoryPage.jsx
```

New endpoints:
```
GET /api/audit/activity?userId=&from=&to=&page=&pageSize=       # "what happened" feed
GET /api/audit/trail?entityType=&changedById=&from=&to=          # field-level change history, filterable
GET /api/audit/trail/:entityType/:entityId                       # full history for one specific record
```

### Design decisions worth knowing about

- **Two different granularities, on purpose — not merged into one feed.**
  `ActivityLog` ("Roster published", "Staff added") is what a person
  scanning "what happened today" wants; `AuditTrail` ("shiftDefId changed
  from X to Y, by Rakesh, at 14:32, reason: swap request") is what an
  auditor needs when investigating a specific record. Module 1's schema
  already separated these for exactly this reason; this pass is the first
  time either becomes visible outside the database.
- **Tool issue/return checks the SAME state the backend already enforces**
  — the frontend hides "Issue" once a tool has an open issue record and
  hides "Return" until one exists, but (same principle as every other RBAC
  check in this app) the backend's own conflict checks are what actually
  prevent a double-issue if the UI state were ever stale.
- **Stores movements ask for quantity via a native `prompt()`**, not a
  modal — a deliberate shortcut for this pass given how much ground it
  covers; worth upgrading to a proper form if store-keepers end up using
  this heavily, but functionally identical to what a modal would do.
- **Raising an audit finding and opening a CAPA also use `prompt()`** for
  the same reason — these are lower-frequency actions (an auditor doesn't
  raise findings dozens of times a day) where the UX cost of a sequence of
  prompts is genuinely low, unlike something used constantly like shift
  edits (which got a real modal in Pass 1).

### Verification

Same method as every pass: 35 frontend files syntax-checked (zero errors),
all imports resolve (zero broken), all 63 CSS classes in use verified
against the stylesheet (zero undefined) — and the permission cross-check
now covers 19 distinct `resource:action` references against the seeded
backend list, zero mismatches. Backend: all files (including the new audit
module) syntax-checked cleanly.

## Roadmap — what's next, in order

1. ~~**Module 1: Foundation**~~ — done.
2. ~~**Module 2: Backend core + auth**~~ — done.
3. ~~**Module 3: Roster, Shift & Leave APIs**~~ — done.
4. ~~**Module 3b: Remaining domain APIs**~~ — done.
5. ~~**Module 4: Notifications**~~ — done.
6. ~~**Module 5: Reports & Dashboard**~~ — done.
7. ~~**Module 6 Pass 1: Frontend shell, auth, Dashboard, Roster**~~ — done.
8. ~~**Module 6 Pass 2: Leave, Qualifications, Reports**~~ — done.
9. ~~**Module 6 Pass 3: Auto-Roster generator**~~ — done.
10. ~~**Module 6 Pass 4: Change History, Tool Control, Stores, Quality**~~ —
    done (this delivery).
11. **Module 6 Pass 5: final screens** — Rolling 7-Day, Daily Coverage,
    Past Rosters archive, Compliance Rules admin, Flight tracking, and a
    real station switcher (currently a single hardcoded
    `VITE_DEFAULT_STATION_ID` throughout — fine for the single-station AMD
    deployment this whole build has targeted, but flagged every time it's
    come up as the thing to fix before a multi-station rollout).
12. **Module 7: Deployment** — Dockerfiles, GitHub Actions CI/CD, AWS guide,
    backup/DR.

## Module 6 Pass 5 (this delivery): final screens, and the station switcher

This closes out Module 6. Two more real gaps found and fixed before
writing frontend code (same discipline as Passes 3 and 4), plus the last
five screens.

### Two more gaps found and fixed

- **No endpoint listed stations at all.** The station switcher this pass
  needed to build couldn't have worked without one — `GET /api/stations`
  didn't exist anywhere. Added a proper repository → controller → route,
  scoped the same way user listing already is (SUPER_ADMIN sees
  everything, everyone else sees their own airline).
- **No endpoint listed a station's past rosters.** Only
  "find the roster for this specific station+month" existed; nothing
  answered "show me every roster this station has ever had," which the
  Past Rosters archive needed. Added `listRostersForStation`.

### The station switcher — and removing six hardcoded IDs

Every page since Pass 1 that needed "which station am I looking at"
answered it with a hardcoded `VITE_DEFAULT_STATION_ID` env var, flagged as
a known gap each time. This pass replaces all six occurrences
(`DashboardPage`, `RosterPage`, `StoresPage`, `QualityPage`,
`ToolControlPage`, `ReportsPage`) with a proper `StationContext`:

- Most roles (Station Manager, LMM, Shift Engineer, AME, Technician, Store
  Keeper) are scoped to exactly one station — their JWT already carries
  `stationId`, so `StationContext` reads it straight off the token. No API
  call, nothing to switch, nothing that can drift out of sync.
- Only airline-level roles (Super Admin, Airline Admin) aren't scoped to a
  single station — for them, and only them, the context fetches the
  station list and shows a switcher in the sidebar. This isn't a coincidence:
  those are also the only roles with the `station:read` permission the
  endpoint requires, so the switcher never calls an endpoint a signed-in
  user can't reach.
- The choice persists in `localStorage` so an Airline Admin's selected
  station survives a page reload.

### The remaining four screens

```
frontend/src/
├── api/  flights.js
├── pages/  FlightsPage.jsx, CoveragePage.jsx, PastRostersPage.jsx, ComplianceRulesPage.jsx
```

- **Flights** — today's flight schedule with engineering delay logging,
  wired to the flight/engineering-delay endpoints that have existed since
  Module 3b but never had a frontend.
- **Coverage** (combines the prototype's separate "Rolling 7-Day" and
  "Daily Coverage" screens) — both were reading the same underlying
  question (who's on which shift, which days) at different zoom levels, so
  one page with a Daily/7-Day toggle replaces two. Flags a shift visually
  the moment it's missing its required B1 (or B2 at Night), the same rule
  from the roster generator and dashboard, now visible at roll-call
  granularity.
- **Past Rosters** — the archive, with a working "View →" link that
  deep-links into the Roster page at that specific month (added
  `useSearchParams` support to `RosterPage` so the link isn't a dead
  promise).
- **Compliance Rules** — deliberately static/informational, not backed by
  a database table. A `ShiftPattern`-style "rules" model would be real
  added complexity for rules that come from DGCA regulation and don't
  change often; instead this page documents exactly which rule is enforced
  where in the code, so it can't silently drift out of sync with reality
  the way a hand-maintained policy doc could.

### Verification

Same standard as every pass: 42 frontend files syntax-checked (zero
errors), all imports resolve (zero broken), all 63 CSS classes verified
against the stylesheet (zero undefined), and the permission cross-check
now covers 22 distinct `resource:action` references against the seeded
backend — zero mismatches, including the two new ones this pass added
(`flight:read`, `station:read`).

## Module 6 is complete. Every screen from the original prototype now has
a real, working React implementation wired to a real backend — including
two backend gaps (roster generation, audit trail visibility) that turned
out not to exist yet and got built properly rather than faked in the UI.

## Roadmap — what's next, in order

1. ~~**Module 1: Foundation**~~ — done.
2. ~~**Module 2: Backend core + auth**~~ — done.
3. ~~**Module 3: Roster, Shift & Leave APIs**~~ — done.
4. ~~**Module 3b: Remaining domain APIs**~~ — done.
5. ~~**Module 4: Notifications**~~ — done.
6. ~~**Module 5: Reports & Dashboard**~~ — done.
7. ~~**Module 6: Frontend**~~ (Passes 1–5) — done.
8. **Module 7: Deployment** — Dockerfiles (frontend + backend), GitHub
   Actions CI/CD, the AWS deployment guide (EC2/RDS/S3/CloudFront/SES/
   CloudWatch), and the backup/disaster-recovery process. The last item on
   the original roadmap.

## Module 7 (this delivery, final): Deployment

Docker for both frontend and backend, GitHub Actions CI/CD, a full AWS
deployment guide, and backup/disaster recovery. This closes out every item
on the original roadmap.

### What's in this module

```
frontend/Dockerfile, frontend/nginx.conf, frontend/.dockerignore
backend/.dockerignore                        # backend/Dockerfile already existed since Module 2
docker-compose.prod.yml                       # production topology (vs the dev one from Module 1)
.env.production.example
.github/workflows/ci.yml                      # test + build on every push/PR
.github/workflows/deploy.yml                  # build + push Docker images on merge to main
infra/aws/DEPLOYMENT_GUIDE.md                 # full EC2 + RDS + S3 + CloudFront + SES + CloudWatch walkthrough
infra/aws/backup.sh                           # automated pg_dump → S3, for the self-managed-Postgres path
```

### Two legitimate deployment paths, not blended together

I deliberately documented **two different architectures** rather than
picking one and hiding the tradeoff:

1. **`docker-compose.prod.yml`** — one server, Postgres + backend +
   frontend all as containers (frontend served by nginx). Simplest to
   stand up, cheapest, fine for one station's traffic. This is what you'd
   run if you just want RosterPro live quickly.
2. **The AWS guide** — RDS instead of a Postgres container (managed
   backups, Multi-AZ failover), S3+CloudFront instead of the frontend
   container (a CDN, not a single server, serving your static files), SES
   for email, CloudWatch for logs/alarms. More pieces, but each piece is
   individually more resilient and it's the path that scales past one
   station without a re-architecture.

Mixing them (e.g. RDS with the frontend nginx container, or the Postgres
container with CloudFront) is possible but not documented — pick a lane,
since the backup/restore story genuinely differs between them (RDS
snapshots vs `backup.sh`'s `pg_dump`), and I'd rather be explicit about
that than paper over it.

### Design decisions worth knowing about

- **`docker-compose.prod.yml` is a distinct file from the root
  `docker-compose.yml`, not a profile/override of it** — the dev compose
  file bind-mounts source code into the containers for hot-reload; doing
  that in production would mean a stale local checkout silently overriding
  what's actually in the built image. Different enough concerns that
  merging them with override flags would be more confusing than two
  clearly-named files.
- **Migrations never run automatically on container boot**, in either
  compose file or the AWS guide — they're an explicit
  `docker exec ... npx prisma migrate deploy` step, run once, by a human
  (or a CD step) who knows it's happening. Auto-migrating on every
  container start is convenient in dev and dangerous the moment you have
  more than one backend instance starting concurrently (a real risk on
  RDS + auto-scaling, effectively impossible to hit with one EC2 box, but
  the habit of never doing it is worth keeping regardless).
- **CI runs as a required first step inside CD**, not duplicated —
  `deploy.yml` calls `ci.yml` as a reusable workflow
  (`uses: ./.github/workflows/ci.yml`) rather than re-declaring the same
  test steps, so there's exactly one place that defines "passing" and
  images only ever get built from a commit that passed it.
- **The GitHub Actions image-publish step never assumes a deployment
  target.** It stops at "image is built and pushed to GHCR" — the actual
  "now go live" step (SSH + `docker compose pull && up`, or ECS, or
  whatever) is deliberately left as a commented-out example rather than a
  guess, because that choice genuinely varies by team and getting it wrong
  silently is worse than leaving it explicit homework.
- **The backup script refuses to run without `S3_BUCKET` set** — a backup
  script that silently produces a purely local dump (which then vanishes
  in the retention-pruning step days later, since the "durable" S3 copy
  never actually existed) is worse than no backup script, because it
  creates false confidence. It fails loudly instead.

### Verification

Docker itself isn't runnable in this sandbox (no Docker daemon available),
so I couldn't build the images or run the compose files for real. What I
did verify: both `Dockerfile`s were checked for structural correctness
(build context boundaries — the frontend Dockerfile initially tried to
`COPY` a file from outside its build context, which Docker would have
rejected outright; caught and fixed before delivery, not after). All YAML
(`ci.yml`, `deploy.yml`, both compose files) was parsed with a real YAML
parser to catch syntax errors — all four parse cleanly. Every npm script
referenced anywhere in the deployment docs or CI config
(`npm run build`, `npm test`, `prisma migrate deploy`, `prisma db seed`)
was cross-checked against what's actually defined in both `package.json`
files — all present, none invented.

---

## The build is complete

Every module from the original architecture request has been delivered:
normalized PostgreSQL schema with full audit trails, JWT auth with MFA and
RBAC, the complete domain API surface (roster, leave, qualifications,
tools, stores, quality, flights), email + WhatsApp notifications, Excel/
PDF/CSV reporting with a compliance dashboard, a React frontend that
reuses your original UI pixel-for-pixel, and now a documented path to
production on AWS with CI/CD and disaster recovery.

A last honest note, consistent with every module above: nothing in this
sandbox lets me run `npm install`, start a real database, or run Docker —
every claim of correctness in this build comes from real, disclosed
verification (syntax checkers, isolated logic execution, cross-referenced
schemas and permission strings) rather than an actual end-to-end run. That
isn't a formality — `npm install && docker compose up` in each module's
README is a genuine, necessary next step, not a rubber stamp, and it's
the right place to catch anything a static check couldn't.
