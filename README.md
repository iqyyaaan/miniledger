# MiniLedger

Track money lent to friends: who owes you, how much, and since when.

A monorepo with two pieces:

```
miniledger/
├── server/   Node.js + TypeScript + PostgreSQL API
├── app/      React Native app (Expo + expo-router)
└── docker-compose.yml   Postgres for both dev and tests
```

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | any recent | runs Postgres — no local Postgres install needed |
| Node.js | **20.x** for `server/`, **24.x** for `app/` | the app's Expo SDK (58) / React Native (0.88) require Node ≥22; the server is fine on 20. If you use [nvm](https://github.com/nvm-sh/nvm), each folder has its own `.nvmrc`-equivalent — just run `nvm use 24` inside `app/` |
| Xcode (Mac) or Android Studio | latest | to run an iOS Simulator / Android Emulator. A physical phone with the **Expo Go** app also works — see §4. |

No native Postgres, no global Expo CLI, no Android/iOS SDKs beyond what Xcode/Android Studio already bundle.

---

## 2. Run the backend

```bash
cd server
cp .env.example .env          # defaults already match docker-compose.yml
docker compose -f ../docker-compose.yml up -d   # starts Postgres on :5432 (+ a test DB on :5433)
npm install
npm run migrate               # creates the schema
npm run seed                  # creates a demo account with realistic sample data
npm run dev                   # API on http://localhost:4000
```

Leave this running. You should see:

```
MiniLedger API listening on http://localhost:4000  (env=development, tz=Asia/Kolkata, docs=/api/docs)
```

**Interactive API docs**: open **http://localhost:4000/api/docs** — every endpoint, with a "try it" panel. Useful for exercising the API without the app at all.

**The demo account** created by `npm run seed`: phone **`9876543210`**, with 10 loans across overdue / due-soon / repaid states, so the summary card and filters have something real to show immediately.

### How the mock OTP works

`POST /api/auth/request-otp` prints the 6-digit code to this terminal, exactly as the assignment asks:

```
┌──────────────────────────────────────────┐
│ 📲  MOCK SMS — MiniLedger login code       │
│   To      : +919876543210                 │
│   Code    : 482913                         │
│   Expires : in 300s                        │
└──────────────────────────────────────────┘
```

In development the same code is *also* returned in the API response as `devCode` (controlled by `OTP_ECHO_IN_RESPONSE` in `.env`, and refused at boot if left on in `NODE_ENV=production`) — the app shows it as a tappable "Dev mode" banner so you never have to alt-tab to this terminal during a demo.

### Backend tests

```bash
npm test                 # 41 unit tests — money parsing, phone normalization, OTP crypto, image-type sniffing
npm run test:integration # 54 integration tests — real HTTP requests against a real throwaway Postgres
npm run test:all         # both
```

The integration suite runs against the second Postgres service in `docker-compose.yml` (`db-test`, port 5433, tmpfs-backed) so it never touches your dev data.

---

## 3. Run the app

In a **second terminal**:

```bash
cd app
nvm use                  # picks up .nvmrc → Node 24
npm install
npx expo start --ios     # or: --android, or no flag and press i / a / w, or scan the QR with Expo Go
```

The app auto-detects the API's address:
- **iOS Simulator** → `localhost:4000` (shares the Mac's network)
- **Android Emulator** → `10.0.2.2:4000` (the emulator's alias for the host)
- **Physical device via Expo Go** → the Mac's LAN IP, read automatically from the Expo dev server's own address — just make sure your phone is on the same Wi-Fi as your Mac

To point at a different/deployed API, set `EXPO_PUBLIC_API_URL` in an `app/.env` file.

### Try it

1. **Login** — phone `9876543210` → *Send code*. Tap the yellow "Dev mode" banner to autofill the OTP (or type it from the server log).
2. **Ledger** — summary card at the top (outstanding, lent, repaid, overdue, due-soon banner), filter chips, search.
3. **Add an entry** — the `+` button: friend name (with autocomplete from past entries), amount, due date, optional note, optional receipt photo (camera or library).
4. **Mark repaid** — tap the pill on a row, or open an entry and use the button there. Overdue entries are the ones with the red left border.
5. **Entry detail** — edit any field, attach/replace/remove a receipt, delete the entry, undo a repayment.
6. **Dark mode** — follows the OS appearance setting automatically.

---

## 4. Running on a physical phone

1. Install **Expo Go** from the App Store / Play Store.
2. Make sure your phone and Mac are on the same Wi-Fi network.
3. `npx expo start` (no `--ios`/`--android` flag) and scan the QR code shown in the terminal.

---

## Architecture notes

### Backend (`server/`)

- **Plain SQL over `pg`**, no ORM — every query is one you can read end-to-end, which matters for an interview where you need to explain all of it. Queries live in `*.repository.ts` files; business rules live in `*.service.ts`; HTTP concerns (validation, status codes) live in `*.routes.ts`.
- **Money is never a float.** Every amount is stored as an integer in minor units (paise) in a `BIGINT` column. `lib/money.ts` is the one place that converts between a user-typed decimal string and that integer, using digit-string arithmetic rather than `parseFloat(x) * 100` — the latter is wrong for inputs like `1.005`. The same logic is mirrored on the client (`app/src/lib/money.ts`) so a number never has two different "correct" values depending on which side computed it.
- **"Overdue" is derived, never stored**: `is_overdue = status = 'outstanding' AND due_date < asOf`, computed in SQL on every read. Storing it would need a cron job to keep it from silently going stale at midnight.
- **The summary endpoint is one query** — a single aggregate with `FILTER (WHERE ...)` clauses computing total lent/repaid/outstanding/overdue/due-soon in one pass, rather than fetching every loan and reducing in JavaScript (which would get slower as the ledger grows and ship the whole table over the wire for five numbers).
- **OTPs and refresh tokens are stored as SHA-256 hashes**, never plaintext. OTP verification runs inside a DB transaction with the row locked `FOR UPDATE`, so concurrent guesses are serialized and a wrong guess always costs an attempt (5 max, then locked out).
- **Refresh tokens rotate** on every use (single-use, OAuth 2.0 BCP-style). Replaying an already-rotated token is treated as token theft and revokes every session for that user.
- **Receipt uploads are verified by magic number**, not by the filename or the client's declared `Content-Type` — an attacker-supplied HTML/SVG file renamed to `.png` is rejected before it ever touches disk, which is what stops a stored-XSS-via-upload.
- **Idempotent repayment**: `POST /loans/:id/repayment` is a single conditional `UPDATE ... WHERE status = 'outstanding'`. Two concurrent taps race at the database, not in application code — exactly one succeeds, the other gets a clean `409 already_repaid`.
- **Pagination is keyset-based** (`(due_date, id) > (cursor...)`), not `OFFSET`, so it doesn't get slower on later pages and doesn't skip/duplicate rows if the list changes mid-scroll.

### App (`app/`)

- **Expo Router**, file-based routes under `src/app/`, with the current `Stack.Protected` pattern gating `(app)/*` behind a signed-in session and `(auth)/*` behind a signed-out one.
- **TanStack Query** for all server state, with optimistic updates on "mark repaid"/"undo" — the row updates instantly in every open filter tab, then reconciles with the server's response, and rolls back cleanly if the request fails.
- **Tokens live in the OS keychain** (`expo-secure-store`), not `AsyncStorage` — a refresh token is a long-lived bearer credential and `AsyncStorage` is unencrypted on Android.
- **A single fetch client** (`lib/api-client.ts`) handles the access-token-expired-mid-request case: a 401 triggers one shared in-flight refresh (deduplicated across simultaneous requests, so three screens failing at once doesn't try to burn the single-use refresh token three times), then retries the original request once.

---

## What's implemented from the brief

**Backend**
- [x] Phone number login with a mock OTP, printed to the server log
- [x] Add a loan entry (friend name, amount, due date)
- [x] Mark an entry as repaid
- [x] Summary endpoint: total lent, total repaid, overdue amount (plus due-soon and per-friend breakdown)

**App**
- [x] Login screen: phone + OTP
- [x] List of entries, overdue ones highlighted
- [x] Form to add an entry
- [x] Summary card at the top

**Bonus**
- [x] Upload a photo of a receipt with an entry (camera or library)
- [x] Input validation (Zod, both client and server) and tests — 95 automated backend tests (41 unit, 54 integration against a real database)

---

## Troubleshooting

- **App can't reach the API**: confirm `npm run dev` (server) is still running and `curl http://localhost:4000/api/health` returns `{"status":"ok", ...}`.
- **Postgres won't start**: Docker Desktop needs to actually be running first (`open -a Docker` on a Mac, then wait for it to say "running").
- **Metro bundler shows "Unmatched Route" or a blank screen on first launch**: fully quit and restart `npx expo start -c` (clears the Metro cache) — most commonly needed after switching Node versions.
- **iOS Simulator first launch is slow**: the first `expo start --ios` downloads the Expo Go client to the simulator; subsequent launches are fast.
