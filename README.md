# CyberSafe

CyberSafe is a cybersecurity awareness website for students. It teaches five practical topics:

1. Phishing awareness
2. Password security
3. Online scams
4. Data privacy and personal-information protection
5. Responsible and ethical internet use

The project is an individual BSIT capstone built in phases. **Phase 1** delivered the runnable foundation: public site, Google sign-in with first-time setup, dashboards, account settings, and the security/authorisation baseline. **Phase 2** added real lesson progress and versioned quiz attempts with server-side grading, results, and history. **Phase 3** (this codebase) adds admin content management: lesson authoring with drafts and publishing, quiz authoring with immutable published versions, a live admin dashboard, and a read-only attempt review.

## Stack

| Layer     | Choice                                                        |
| --------- | ------------------------------------------------------------- |
| Runtime   | Node.js 20.11+ (tested on Node 24)                            |
| Server    | Express 5 + EJS server-rendered views                         |
| Database  | SQLite via `better-sqlite3`                                   |
| Auth      | Email + password (local accounts, scrypt hashes) **and** Google OpenID Connect (Authorization Code + PKCE, `jose` for ID-token verification) |
| Sessions  | Opaque server-side sessions in SQLite, `HttpOnly` cookie      |
| Frontend  | HTML, CSS, vanilla JavaScript – no framework, no build step   |

## Quick start

```bash
cd cybersafe
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run db:migrate
npm run dev               # http://localhost:3000
```

Optional sample content (five lessons, two quizzes, marked as sample material):

```bash
npm run db:seed
```

The sign-in page shows only production authentication options: the email/password form and, when Google credentials are configured, the **Continue with Google** button. No development controls or server-configuration text ever appear on it. With `AUTH_DEV_MODE=true` a hidden `POST /auth/dev-login` route exists for tests and automation only; it is refused when `NODE_ENV=production`, does not exist unless the flag is on, and never creates an admin. The real Google flow still sends first-time users through `/setup`.

### Test accounts (local only)

To create ready-made local accounts:

```bash
$env:AUTH_DEV_MODE='true'; npm run setup-test-accounts   # PowerShell
AUTH_DEV_MODE=true npm run setup-test-accounts           # bash
```

It seeds two accounts using the same code paths the app uses (`createPendingUser` → `completeSetup` → `setRole`, identical to `promote-admin.js`), so they are ordinary accounts, not backdoors:

| Email                  | Password                |
| ---------------------- | ----------------------- |
| `student@example.test` | `cybersafe-local-demo` |
| `admin@example.test`   | `cybersafe-local-demo` |

The script creates a student and an admin account for local testing. The password is shared by both accounts and is only for local use. The intended usernames are `student1` and `admin1`; if one is already taken by an existing local account the script appends a number instead of failing (`student1` → `student11`), so the exact username may vary on a database that already has users — the script prints whichever usernames it created. The script is idempotent (re-running it reports the accounts as already active and never overwrites an existing password), refuses to run unless `AUTH_DEV_MODE=true`, and never touches production. These are throwaway local accounts — do not reuse these email addresses or this password anywhere real.

## Configuring Google sign-in

1. Open <https://console.cloud.google.com/apis/credentials> and create an **OAuth client ID** of type *Web application*.
2. Add the authorized redirect URI: `http://localhost:3000/auth/google/callback` (must match `GOOGLE_REDIRECT_URI` exactly). Add the production HTTPS callback as a **separate** URI later.
3. Put the client ID and secret in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
4. Restart the server. The sign-in page stops showing the "not configured" notice and starts the Google flow.

How the flow is protected (`src/auth/oidc.js`, `src/routes/auth.routes.js`):

- `state` and `nonce` are random per attempt and stored server-side with a 10-minute expiry; the state row is deleted when used, so a replay fails.
- PKCE (`S256`) is used on every authorization request; the verifier never leaves the server.
- The ID token is verified server-side with `jose` against Google's JWKS: **signature, issuer, audience, expiry, and nonce** are all checked, plus `email_verified`.
- Accounts are matched by the stable Google subject (`sub`), never by email or username. A different Google account that reports the same email is refused instead of taking over the existing account.
- A first-time user gets a `pending_setup` account and is sent to `/setup`; a registered user is sent to `/dashboard` (or `/admin`).

OAuth credentials are not included in this repository. Without them, the integration structure and error handling are in place but a real Google login has **not** been exercised.

## Email and password sign-in

Google is optional: students can also create a local account with an email address and password.

- **Register** at `/register`: email, password (8–200 characters), confirmation. The account is created as a `student` in `pending_setup`, so the new student still chooses a username and display name on `/setup`. A unique internal subject (`local:<email>`) plus the existing database constraints prevent duplicate accounts, and the registration endpoint ignores any `role` field in the request.
- **Passwords are hashed with `scrypt`** (`node:crypto`, no third-party dependency) as `scrypt$N$r$p$salt$key` with a per-password random salt and a timing-safe comparison (`src/auth/passwords.js`). The database stores only this hash; plaintext passwords are never stored, logged, returned by an API, or echoed back into a form.
- **Login** (`POST /auth/login`) gives the same answer for an unknown email and a wrong password, and burns the same CPU time in both cases, so the form cannot be used to probe which emails are registered. Disabled accounts are refused and their sessions deleted, exactly like the Google flow.
- Sessions are server-side and identical whichever provider signed the user in. `email_verified` is `0` for local accounts (there is no provider asserting it).
- **Forgot Password?** (`/forgot-password`) is an honest placeholder: submitting it always shows "password reset emails are not configured on this site yet" — there is no fake token flow and no email enumeration. Wire a real mailer before enabling resets.
- **Administrator access? (Separate login)** links to `/admin-login`, a distinct sign-in view for the same credential check. It changes nothing about authorisation: the role always comes from the database, and there is still no route that can grant `admin`.

## Roles and the first admin

There are exactly two roles: `student` and `admin`.

- Public registration always creates a `student`. There is no route, form, or API that grants `admin`; posting `role=admin` to `/auth/register` is ignored and the account is still a student.
- To provision the first administrator, have that person sign in (with Google or with a password) and finish account setup, then run:

  ```bash
  npm run create-admin -- --email you@school.edu
  ```

  The script (`scripts/promote-admin.js`) only works on an existing, active account. It must be run on the server, never exposed through the web app.
- New sessions are created on sign-in; existing sessions pick up the new role on the next request.

## Project layout

```
cybersafe/
├─ src/
│  ├─ server.js              # entry point: config, db, oidc, listen, graceful shutdown
│  ├─ app.js                 # express wiring: security, sessions, csrf, routes, errors
│  ├─ config.js              # env parsing + validation, production safety checks
│  ├─ errors.js              # AppError types and status codes
│  ├─ validation.js          # username/display-name/email rules, safe redirects
│  ├─ flash.js               # one-shot flash messages inside the session
│  ├─ grading.js             # server-side quiz grading + answer-key validation
│  ├─ history.js             # quiz attempt history summary for dashboards
│  ├─ auth/oidc.js           # Google OpenID Connect client (PKCE, state, nonce, JWKS)
│  ├─ auth/session.js        # session create/load/destroy, cookie flags
│  ├─ auth/passwords.js      # scrypt password hashing/verification + timing-safe compare
│  ├─ auth/guards.js         # requireAuth / requireRole / requireCompleteProfile
│  ├─ db/                    # connection, migrations runner, data access (users, lessons, quizzes, attempts, sessions)
│  ├─ db/attempts.js          # attempt lifecycle: create, expire, finalize (transaction), history, admin review reads
│  ├─ db/migrations/          # 001_init.sql (schema), 002_attempt_integrity.sql (attempt triggers/indexes), 003_password_auth.sql
│  ├─ middleware/            # helmet+CSP, csrf, error + 404 handling
│  ├─ routes/                # pages, auth (Google + email/password), api, attempts (student flow), admin + admin-lessons / admin-quizzes / admin-attempts
│  ├─ content/               # category metadata, lesson renderer, seed data
│  └─ views/                 # EJS templates (landing, login, register, forgot-password, setup, dashboards, learn, quizzes, attempts, account, admin/*, errors)
│     └─ partials/icon.ejs   # reusable inline SVG stroke icons (shield, topic tracks, stats)
├─ public/                   # css, js (app.js, quiz.js, admin-quiz.js, auth.js), favicon – the only publicly served folder
├─ scripts/                  # migrate, seed, promote-admin (server-side only)
├─ tests/                    # focused tests for this phase
└─ data/                     # local SQLite file (git-ignored, created on first migrate)
```

## Database

The schema lives in `src/db/migrations/` and is applied by `npm run db:migrate` (also run automatically when the server starts). Migrations are recorded in `schema_migrations`, so adding `004_*.sql` later is enough. `003_password_auth.sql` added the nullable `users.password_hash` column (Google and development accounts keep `NULL`).

Tables:

| Table                   | Purpose |
| ----------------------- | ------- |
| `users`                 | internal id, `google_sub` (unique), email, unique username, display name, role, status, optional scrypt `password_hash`, timestamps |
| `sessions`              | opaque token hash, user, expiry, user agent, IP |
| `oauth_states`          | short-lived `state`/`nonce`/PKCE verifier rows |
| `lessons`               | title, slug, category, summary, content, status, timestamps |
| `lesson_progress`       | student + lesson completion state (unique per pair) |
| `quizzes`               | one row per **version**: slug + `version` (unique pair), title, description, status (`draft`/`published`/`archived`), passing score |
| `quiz_questions`        | question prompt + explanation per version, position |
| `quiz_options`          | options per question, server-side `is_correct` |
| `quiz_attempts`         | student, exact quiz version (`quiz_id`), score, status, timestamps |
| `attempt_answers`       | selected option + correctness, linked to attempt and question |

Design notes:

- Foreign keys are enforced (`PRAGMA foreign_keys = ON`), timestamps are ISO-8601 UTC strings, and statuses/roles are constrained with `CHECK` clauses.
- Quiz content rows are immutable once their version is published (`triggers` block `UPDATE`/`DELETE` on questions and options). A content change creates a new version, so old attempts keep the exact question wording and answer key they were graded against.
- `quiz_attempts.quiz_id` always points at the exact version taken; `attempt_answers` reference the option row from that same version, and a database trigger refuses changes to `score_points`/`max_points` or answers once the attempt is `submitted`.
- Public lesson and quiz responses are built by explicit `SELECT`s that never include `is_correct` or `explanation`; see `src/db/quizzes.js`.

### Moving off SQLite

All SQL goes through `src/db/*.js`. To host on a platform whose filesystem is ephemeral, replace those modules with a client for a managed Postgres/MySQL database and translate `001_init.sql`; the rest of the app (routes, views, auth) does not know which engine is in use. SQLite is only appropriate where the disk is persistent.

### Supabase (PostgreSQL) schema file

`supabase/schema.sql` is a ready-to-paste PostgreSQL translation of `001_init.sql` + `002_attempt_integrity.sql`: `bigint` identity keys, the same `CHECK` constraints, partial/expression unique indexes, `RESTRICT`/`CASCADE` rules, and all seven immutability guards rewritten as PL/pgSQL trigger functions with the original error messages. It also records both migration ids in `schema_migrations`.

Use it from the Supabase Dashboard → **SQL Editor** → paste → Run. Two honest caveats:

- It has been reviewed against the SQLite source but **not executed** against a live PostgreSQL instance yet (no `psql`/Docker in this environment).
- The application still speaks SQLite only. Pasting the file creates an inert, correctly-shaped database; nothing in `src/` connects to Supabase until the PostgreSQL port of the data layer is done.

## Student features (Phase 2)

- **Lesson progress** - `/learn` lists published lessons and shows real completed/total counts. A student marks a lesson complete (or undoes it) from the lesson page; the action is a CSRF-protected `POST` and progress is stored in `lesson_progress`, unique per `(user_id, lesson_id)`. The dashboard and Learning Center calculate progress from those rows. Completion records that the lesson was read; it is not a mastery test.
- **Quiz attempts** - starting a quiz creates `quiz_attempts` pinned to the current published version and copies the question count into `max_points`. An open attempt is resumed rather than duplicated. Attempts expire after 24 hours (`ATTEMPT_TTL_HOURS`); expired attempts are kept in history, marked `expired`, and never graded.
- **Server-side grading** - `src/grading.js` reads `q_<questionId>=<optionId>` fields, checks every id against the pinned version, awards one point per correct option, treats a blank answer as incorrect, and rounds the percentage to a whole number. A quiz with zero questions or a question without exactly one correct option is refused, not guessed at.
- **Transactional finalisation** - `attemptsDb.finalize` writes the attempt score, all `attempt_answers` rows (including blanks), and the `submitted` status in one `better-sqlite3` transaction. If any write fails, nothing is saved and the attempt stays open.
- **Results and history** - `/attempts/:id` shows the score, each selected answer, the correct answer, and the explanation only after submission. `/quizzes/history` lists every attempt with quiz title, version, date, score, percentage, and status, marking the latest and best completed results. Attempts are scoped to the signed-in student; other students and admins get 404/403.
- **Access rules** - students only. Admins can preview the published quiz questions (without answers) on `/quizzes/:slug`, but cannot start or submit student attempts.

## Admin features (Phase 3)

Every admin page and write endpoint sits behind `requireActive` + `requireAdmin` (`src/routes/admin.js` mounts the sub-routers behind that guard); students get 403 and signed-out visitors get redirected to `/login`. There is still no public route that can grant the admin role.

- **Lesson management** (`src/routes/admin-lessons.js`) - `/admin/lessons` lists every lesson with search (`?q=`) and status filter. Create and edit title, slug, category, summary, content, and reading time with field-level validation (slug pattern, unique slug, 3-120 title, 10-200 summary, reading time 1-60). Status transitions are publish / unpublish (back to draft) / archive through a validated `POST /admin/lessons/:id/status`. Lessons are never hard-deleted, so student progress survives editing and archiving. Preview (`/admin/lessons/:id/preview`) renders the exact escaped HTML students would see.
- **Quiz authoring with immutable versions** (`src/routes/admin-quizzes.js`) - `/admin/quizzes` lists every version. A new quiz starts as a `draft` version 1. While a version is draft you can edit metadata (slug fixed after creation) and manage questions: add, edit, reorder (move up/down), and remove questions and options through `src/validation.js:parseQuestionForm`, with exactly one correct option required per question plus an optional explanation. Publishing validates the whole answer key first (`validateAnswerKey`: at least one question, two options each, exactly one correct) and is refused otherwise. Published and archived versions are frozen - the edit form turns read-only and the database triggers reject in-place `UPDATE`/`DELETE`, so `POST .../questions` on a published version returns 409. **Create new version** copies the version (questions and options included) as the next `draft`; publishing it supersedes the old one for new attempts while historical attempts keep their original version, prompts, and answers. Admin preview uses the student-facing shape (no answer key).
- **Attempt review** (`src/routes/admin-attempts.js`) - `/admin/attempts` lists the 50 most recent attempts with student, quiz version, score, and timestamp; `/admin/attempts/:id` is a read-only record showing selected vs. correct answers and explanations. There are deliberately **no write endpoints** - scores cannot be altered from the web app, and submitted rows are immutable at the database level too.
- **Dashboard** - `/admin` reports live counts from the database: active/pending/disabled students, published lesson and quiz-version counts, quiz participation (distinct submitters, submitted attempts, rounded average score percentage, computed from `quiz_attempts`), recent accounts, recent attempts, and the published-lesson list.

## Interface design (dashboard redesign)

- **Two identities, one design system** - the public pages (landing, sign-in, register) keep the clean light theme, while every signed-in app page (`body.page-app`: dashboard, Learning Center, Quizzes, Account, Admin) runs on a dark cybersecurity identity: `#0f172a` background, `#1e293b` cards, cyan (`#22d3ee`) and green (`#34d399`) accents, and soft radial glows. Every dark rule is scoped to `body.page-app` in `public/css/styles.css`, so the light pages are untouched.
- **Glass header** - the signed-in navbar becomes a translucent, blurred bar (`backdrop-filter: blur(16px)`) with a glowing shield mark and a circular user avatar (initials + online dot) next to the sign-out button. The avatar is a global component and also appears on light pages.
- **Account dropdown** - the avatar is a button that opens a dropdown under it: display name and email in a muted header, a divider, **Account Settings** (links to `/account`) and **Sign Out** with a sign-out icon that turns red on hover. Clicking anywhere outside or pressing `Escape` closes it. The separate "Sign out" link in the top bar and the "Sign out of this session" button on the Account page were removed, so signing out happens in one place.
- **Stat cards** - the four progress cards (lessons completed, lesson progress, quizzes completed, best quiz score) each get an inline SVG icon in a tinted chip, a per-card accent colour (green / cyan / blue / amber), bold accent numbers, and a lift-and-glow hover. The progress bar is a cyan-to-green gradient with a glow.
- **Continue hero** - the "Continue next" strip is now a gradient hero banner with a category tag pill, a read-time indicator, a large glowing shield, and a primary CTA with an animated arrow.
- **Topic tracks** - the right-hand panel lists the five learning tracks with their own icons and a status badge: `1/1 completed` when the track is finished, `1/3` while in progress, `Open` when untouched, and `No lessons yet` for a track without published lessons.
- **Secure empty state** - the "No quiz attempts yet" panel uses a dashed cyan border and a shield-and-magnifier illustration instead of a plain box.
- **Icons** - `src/views/partials/icon.ejs` renders the inline stroke icons (`phishing`, `passwords`, `scams`, `privacy`, `ethics`, `shield`, `trophy`, ...) that the views reuse; they are plain SVG, so the strict CSP is unaffected.

## Commands

| Command                  | What it does |
| ------------------------ | ------------ |
| `npm run dev`            | start with file watching |
| `npm start`              | start normally |
| `npm run db:migrate`     | apply pending migrations |
| `npm run db:seed`        | insert sample lessons/quizzes if missing (idempotent) |
| `npm run create-admin -- --email <address>` | promote an existing active account |
| `npm run setup-test-accounts` | create the local demo accounts (needs `AUTH_DEV_MODE=true`) |
| `npm test`               | run the focused test suite in `tests/` |

## Security baseline

- Helmet with a strict Content-Security-Policy (`script-src 'self'`, no inline scripts), `frame-ancestors 'none'`, `nosniff`, referrer policy; `upgrade-insecure-requests` only in production.
- Session cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` by default in production, 12-hour server-side expiry (`SESSION_TTL_HOURS`). The database stores only a SHA-256 hash of the token.
- CSRF: double-submit token bound to the session, required on every `POST`/`PUT`/`PATCH`/`DELETE` (including logout); rejected requests get a 403 page or JSON error.
- Server-side authorisation middleware for every protected page and API: `requireAuth`, `requireRole('admin')`, `requireCompleteProfile`. `pending_setup` accounts can only reach `/setup` and logout.
- Disabled accounts are rejected on each request and their sessions are deleted.
- Parameterised SQL everywhere; EJS escapes by default and the lesson renderer escapes first, then re-applies a small formatting whitelist.
- Rate limiting on `/auth/*` and `/api/*` (configurable window and max).
- Configuration is validated at startup: production refuses insecure cookies, dev auth, or placeholder Google credentials.
- Errors never include stack traces to clients; request ids are logged and returned for support. Authentication tokens and session secrets are never logged.

These controls are a baseline, not a guarantee of production security. A real deployment still needs HTTPS, secret management, backups, dependency updates, and a review of the hosting provider.

## Testing

Focused tests for this phase (Node's built-in runner + Supertest, temporary databases):

```bash
npm test
```

Covered: schema constraints, migration idempotency, and immutable quiz versions; config validation and secret hygiene; OAuth start/callback failure paths (not configured, unknown/expired state, failed token verification, disabled account, email-hijack attempt); first-time setup vs returning-user routing; role enforcement and the absence of public admin registration; CSRF, session expiry, logout; page/API responses, escaping, and absence of answer keys in public JSON. Phase 2 adds focused tests for lesson completion (repeat requests, per-student isolation, unpublished access, undo, admin rejection, empty states) and quiz attempts (version pinning, grading, invalid ids, duplicate submission, transaction rollback, cross-student access, answer-key secrecy, expiry, history, misconfigured quizzes). Phase 3 adds `tests/admin.test.js`: student/guest/disabled rejection of every admin endpoint, lesson CRUD with slug conflicts, validation, escaping, and progress preservation, quiz draft editing, publish validation, published-version immutability (HTTP 409 and DB triggers), new-version creation with old attempts pinned to their version, answer-key secrecy, read-only attempt review, and dashboard statistics. Email/password sign-in adds `tests/password-auth.test.js`.

Phase 3 focused runs (from `cybersafe/`):

```bash
node --test tests/admin.test.js
node --test tests/roles.test.js tests/routes.test.js tests/quiz.test.js
node --test tests/attempts.test.js tests/auth.test.js
```

Password sign-in adds `tests/password-auth.test.js` (registration creates a hashed pending student, duplicate email, validation, real sessions and routing, identical wrong-password/unknown-email answers, disabled accounts, Google-only accounts refused by password, honest forgot-password notice, the login-card elements, separate admin sign-in entry, `role=admin` ignored, and no password material in any page/API response):

```bash
node --test tests/password-auth.test.js
node --test tests/roles.test.js tests/auth.test.js tests/setup.test.js tests/db.test.js tests/routes.test.js
```

Google's live endpoints are **not** contacted; the OIDC client is stubbed in tests. Real OAuth behaviour must be confirmed manually once credentials exist.

The dashboard redesign adds `tests/dashboard-ui.test.js` (dark app shell, four icon stat cards, continue hero with pill/read time/CTA, five topic tracks with icons and completion badges, nav avatar initials, secure empty state, and no development artefacts). The account dropdown adds `tests/nav-user.test.js` (avatar trigger attributes, user info header, divider, Account Settings link, Sign Out control, no standalone sign-out in the top bar, clean Account page, and a working logout through the session route):

```bash
node --test tests/dashboard-ui.test.js tests/nav-user.test.js
node --test tests/progress.test.js tests/attempts.test.js tests/setup.test.js tests/routes.test.js
node --test tests/password-auth.test.js tests/roles.test.js tests/admin.test.js tests/quiz.test.js
```

## Manual verification (local, no Google account needed)

1. `npm run db:migrate` then `npm run db:seed`.
2. Open `/login` and sign in with a local demo account (`npm run setup-test-accounts` first), or register a fresh student at `/register`.
3. Open **Learning Center**, mark a lesson complete, then undo it. Check that `/dashboard` and `/learn` counts change and stay after a reload.
4. Back on **Quizzes**, start the seeded quiz, answer some questions, submit, and check the score, review, and explanations. Repeat it and confirm both attempts appear on `/quizzes/history` with latest/best labels.
5. Sign in as an admin (`npm run create-admin -- --email <your-account>`).
6. On **Admin dashboard**, check the live counts. Create a lesson under **Manage lessons**, confirm it is hidden from `/learn` while draft, publish it, open it as the student, then unpublish and archive it - student progress must survive all of it.
7. Under **Manage quizzes**, create a quiz, add a question with exactly one correct option, try publishing before questions are valid (it must be refused), then publish. Take it as the student. Back on the quiz, use **Create new version**, edit the copy, publish it, and confirm the student sees the new questions while the earlier attempt in history still shows its original version.
8. Open **Attempt review** and check a submitted attempt shows selected vs. correct answers and the explanation. Confirm there is no control to change a score, and that a signed-out browser or a student account cannot open any `/admin` URL.
9. **Email/password sign-in**: open `/register`, create an account (try a short password and a mismatched confirmation first — both must be refused with field errors), finish `/setup`, sign out, then sign back in from `/login` with the eye toggle, `Forgot Password?`, and the `Administrator access? (Separate login)` link to `/admin-login`. A wrong password must show the generic error and keep you signed out.

## Deployment notes (future)

- Serve over HTTPS only. Set `NODE_ENV=production`, `SESSION_COOKIE_SECURE=true`, `TRUST_PROXY=true` behind a trusted proxy, and a strong `SESSION_TTL_HOURS`.
- Register a production redirect URI (e.g. `https://your-domain/auth/google/callback`) in Google Cloud Console; local and production URIs are separate entries.
- Keep `.env` out of the web root and out of source control; the file is already in `.gitignore`.
- Ensure the database file lives on persistent storage, or migrate to a managed database as described above.
- Phase 1 does not deploy anything and does not modify external services.

## Current limitations (after Phase 3)

- No Google credentials are shipped, so the live OAuth round trip is unverified until you configure them.
- Attempt expiry is enforced when an attempt is opened, resumed, or submitted, not by a background job. An unattempted expired row is marked `expired` on its next access.
- History shows the latest and best results only as labels; there are no leaderboards, certificates, or passing thresholds.
- Dashboard statistics come from real rows, but there is no analytics beyond counts and average score.
- Admin content management covers lessons and quizzes only: no bulk import, no media uploads, no per-lesson prerequisites or ordering, and archiving (not deletion) is the only way to retire content. A quiz slug can hold several versions but cannot be renamed after creation.
- There is no email notification, avatar upload, leaderboard, certificate, chat, or AI feature – out of scope by design.


## Security notes

- AUTH_DEV_MODE defaults to false. The hidden /auth/dev-login route is disabled unless explicitly enabled (development only; refused in production).
- Passwords are hashed with scrypt (src/auth/passwords.js); sessions are opaque tokens stored as SHA-256 hashes in SQLite with HttpOnly, SameSite=Lax cookies.
- CSRF uses a double-submit token bound to the session; required on all state-changing requests.
- File uploads (avatars, module files) are validated by MIME type and magic bytes, size-limited, and stored under randomized names.
- npm audit reports 4 moderate vulnerabilities via ejs -> jake -> filelist -> minimatch (DoS via glob). ejs is used for server-side rendering only; the vulnerable jake/filelist/minimatch are dev-tooling of ejs, not on the request path. Full fix requires npm audit fix --force (downgrades ejs, breaking). Deferred.
- .env, data/, node_modules/ are gitignored. Never commit secrets.

