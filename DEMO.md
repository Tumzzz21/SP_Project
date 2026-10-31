# CyberSafe — 5-minute defense walkthrough

1. **Sign in** (30s): Open http://localhost:3001. Sign in as `admin1` (password `cybersafe-local-demo`) or `student1`. Show the login pitch and three bullets.
2. **Student dashboard** (60s): Show "Continue where you left off" card, 3 stat cards (modules completed, progress %, best quiz score), "Your modules" list with progress bars, "Your recent quizzes" with empty state.
3. **Take a module** (60s): Open a module, complete an item, return to dashboard — progress updates.
4. **Take a quiz** (60s): Start a quiz, answer A–D, submit, view results with explanations and score. Show quiz history.
5. **Admin dashboard** (60s): Sign in as admin, land on `/admin`. Show stat cards, "Needs attention", "Latest student attempts" with Review link, quick actions.
6. **Admin reports** (30s): Open `/admin/students`, search/sort, export CSV. Show `/admin/users` disable/enable/promote/demote with guards.
7. **Content management** (30s): Show `/admin/modules` create/publish, `/admin/quizzes` versioning (published = immutable, 409 on edit).
8. **Security** (30s): Mention CSRF, scrypt, session hashing, role guards, dev-login off by default.

## Demo accounts
- `admin@example.test` / `cybersafe-local-demo` (admin1)
- `student@example.test` / `cybersafe-local-demo` (student1)
- `aldrinlance19@gmail.com` (aldrin, student)

## Scripts
- `npm run db:migrate` — apply migrations
- `npm run seed:demo` — idempotent demo content + 5 students
- `npm run setup-test-accounts` — local demo accounts (needs AUTH_DEV_MODE=true)
- `npm test` — 125 tests
- `npm run lint` — ESLint

## Security notes
See README "Security notes" section. AUTH_DEV_MODE defaults to false.