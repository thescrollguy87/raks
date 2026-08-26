# START HERE — RosterPro handoff to Claude Code

## What's in this folder

Two things, built at different stages of the same project — **use them
together, don't pick one over the other**:

1. **`rosterpro-platform/`** — a real, working backend + database + React
   frontend for RosterPro. Node.js/Express API, PostgreSQL via Prisma, JWT
   auth with role-based permissions, and — importantly — **multi-station
   support is already designed into the database and the API**: `Airline`
   and `Station` models, roles like `STATION_MANAGER` (scoped to one
   station) vs `AIRLINE_ADMIN`/`SUPER_ADMIN` (see all stations), and a
   station-switcher component already in the frontend. This has never been
   run for real — it was built by an AI assistant (Claude, in claude.ai)
   with **no internet access and no ability to run a database or install
   packages**, so everything was verified by static code-reading and
   isolated logic tests, never an actual end-to-end run. That first real
   run is the honest next step, and it's exactly the kind of thing you're
   suited for that a browser-based chat isn't.

2. **`reference-ui/index.html`** — a single self-contained HTML prototype
   (open it directly in a browser, no setup needed). This is **newer** than
   `rosterpro-platform/`'s frontend styling — it has a corrected, readable
   light theme that the platform's CSS doesn't have yet. Treat this as the
   **visual source of truth**: same layout, same colors, same shift-code
   styling, should end up reflected in `rosterpro-platform/frontend/`.
   Don't try to make this HTML file itself into the app — it has no
   backend, no database, no multi-station concept; it was a UI-only
   prototyping step that the platform folder has since superseded
   architecturally. Its CSS (`<style>` block near the top of the file) and
   its shift-color logic (search for `SHIFT_DEFS_CUSTOM` and the `.s-M`
   `.s-A` `.s-N` etc. CSS classes) are what's actually worth pulling over.

## What to actually do, roughly in this order

1. **Read `rosterpro-platform/README.md`** — it's long (it documents every
   build stage), but the sections near the bottom cover the parts most
   likely to need attention first: auth/seeding, and the honest
   "not yet verified end-to-end" caveats repeated throughout.
2. **Get the backend running for real.** `cd rosterpro-platform/backend`,
   `npm install`, set up a real Postgres (Docker Compose file is at the
   repo root), run the Prisma migrations and seed script. Fix whatever
   actually breaks — some of this is genuinely untested against a live
   database.
3. **Get the frontend running against it**, `cd rosterpro-platform/frontend`,
   `npm install`, `npm run dev`. Confirm login, the dashboard, and the
   roster screen actually load data from the real backend.
4. **Port over the corrected visual design** from `reference-ui/index.html`
   into `rosterpro-platform/frontend/` — the light theme, the shift-code
   colors, and general readability fixes. The platform's React components
   already reference a shared stylesheet; that's the file to update.
5. **Once it's genuinely working locally**, help with deployment so
   multiple stations can actually reach it over the internet — the AWS
   guide is in `rosterpro-platform/infra/aws/`, but a simpler host
   (Railway, Render, etc.) is equally valid if that's a better fit.

## One thing worth knowing about the person you're working with

They've been explicit that they're not a developer and don't want to hire
one — they've been driving this project by describing what they want in
plain language, not by writing or reading code themselves. Explaining
what you're doing and why, in plain terms, as you go, will matter more
here than it would for a typical engineering handoff.
