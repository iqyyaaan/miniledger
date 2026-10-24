# MiniLedger

A small app for tracking money you've lent to friends — who owes you, how much, and since when.

It's a monorepo: a Node/TypeScript/Postgres API in `server/`, and an Expo/React Native app in `app/`, with a `docker-compose.yml` at the root that spins up Postgres for both dev and tests.

```
miniledger/
├── server/   the API
├── app/      the mobile app
└── docker-compose.yml
```

## Before you start

You'll need Docker Desktop (any recent version — it's only there to run Postgres, nothing else needs it) and two different Node versions depending on which half you're touching. The server is happy on Node 20. The app isn't — Expo SDK 58 and React Native 0.88 need Node 22+, so I've pinned `app/.nvmrc` to 24.16.0. If you use nvm, `cd app && nvm use` picks that up automatically; the server doesn't need anything special, whatever Node 20+ you already have is fine.

You'll also want Xcode (for the iOS Simulator) or Android Studio, unless you're testing on a real phone through Expo Go, which works just as well and is covered further down.

Nothing else to install globally — no system-wide Postgres, no Expo CLI, nothing beyond what Xcode/Android Studio already bring.

## Getting the backend running

```bash
cd server
cp .env.example .env
docker compose -f ../docker-compose.yml up -d   # Postgres on :5432, plus a throwaway test DB on :5433
npm install
npm run migrate
npm run seed      # creates a demo account with realistic sample data
npm run dev       # API on http://localhost:4000
```

Leave that running — you should see it print something like:

```
MiniLedger API listening on http://localhost:4000  (env=development, tz=Asia/Kolkata, docs=/api/docs)
```

If you want to poke at the API directly without the app, there's a full interactive docs page at **http://localhost:4000/api/docs** — every endpoint, with a "try it" panel right there in the browser.

The seed script sets up a demo account on phone **`9876543210`** with ten loans spread across overdue, due-soon, and already-repaid states, so the summary card and filters actually have something worth looking at the moment you log in, rather than a wall of zeros.

### About the OTP

This was explicitly meant to be mocked, so that's what it is — `POST /api/auth/request-otp` just prints the 6-digit code straight to this terminal:

```
┌──────────────────────────────────────────┐
│ 📲  MOCK SMS — MiniLedger login code       │
│   To      : +919876543210                 │
│   Code    : 482913                         │
│   Expires : in 300s                        │
└──────────────────────────────────────────┘
```

In development the same code also comes back in the API response as `devCode` (the app shows it as a tappable banner so you're not alt-tabbing to a terminal mid-demo). That behavior is gated behind `OTP_ECHO_IN_RESPONSE` in `.env`, and the server will flatly refuse to boot if that's left on with `NODE_ENV=production` — handing out login codes in a production API response would be a fairly bad idea.

### Running the tests

```bash
npm test                 # 41 unit tests — money parsing, phone normalization, OTP crypto, image sniffing
npm run test:integration # 54 integration tests, hitting real HTTP routes against a real Postgres
npm run test:all         # both
```

The integration suite runs against the second Postgres instance from docker-compose (`db-test`, tmpfs-backed, port 5433), so running tests never touches the data you're actually demoing with.

## Getting the app running

In a second terminal:

```bash
cd app
nvm use              # Node 24, via .nvmrc
npm install
npx expo start --ios # or --android, or no flag and press i / a / w, or scan the QR with Expo Go
```

The app figures out where the API lives on its own: `localhost:4000` on the iOS Simulator (it shares the Mac's network), `10.0.2.2:4000` on the Android Emulator (its alias for the host machine), or your Mac's LAN IP for a physical device over Expo Go — picked up automatically from the Expo dev server, as long as your phone's on the same Wi-Fi. If you ever want to point it at a deployed API instead, drop `EXPO_PUBLIC_API_URL` into an `app/.env` file and that takes priority over all of the above.

### What to actually try

- **Log in** with `9876543210`, tap Send code, then tap the yellow "Dev mode" banner to autofill the OTP (or just read it off the server log)
- Look at the **summary card** — outstanding total, lent/repaid/overdue breakdown, a due-soon banner when something's coming up
- Flip through the **filter chips** and try the **search**
- **Add an entry** with the `+` button — friend name with autocomplete from people you've already lent to, an amount, a due date, an optional note, and optionally a receipt photo from the camera or your library
- **Mark something repaid** — tap the pill on a row, or open the entry and use the button there. Overdue entries are the ones with the red border down the left side
- Open an entry's **detail view** to edit it, swap out the receipt, delete it, or undo a repayment
- Toggle your **system dark mode** — the whole app follows it automatically, no setting to flip inside the app itself

## Running it on your actual phone

Install **Expo Go** from the App Store or Play Store, make sure your phone's on the same Wi-Fi as your Mac, then run `npx expo start` (no platform flag) and scan the QR code it prints. That's it.

## How it's built, and why

### The backend

There's no ORM — every query is plain SQL through `pg`, which I'd rather own directly than hide behind an abstraction, especially somewhere I need to be able to explain every line of. The split is: SQL lives in `*.repository.ts` files, business logic lives in `*.service.ts`, and HTTP-level stuff (status codes, validation) lives in `*.routes.ts`.

Money is never a float, anywhere. Every amount is an integer — paise, not rupees — stored in a `BIGINT` column, and `lib/money.ts` is the one place that converts between that and the decimal string a user actually types. It works off the digit string rather than doing `parseFloat(x) * 100`, because that trick quietly breaks on inputs like `1.005` (IEEE-754 stores it as 1.00499999999999989, and the rounding goes the wrong way). The exact same logic is mirrored client-side in `app/src/lib/money.ts`, so a number is never "correct" on one side and slightly off on the other.

"Overdue" isn't a column anywhere — it's derived on every read, from `status = 'outstanding' AND due_date < asOf`. Storing it instead would mean running something on a schedule just to flip a flag at midnight, which felt like solving a problem that didn't need to exist.

The summary endpoint is a single query. The lazy version would pull every loan and reduce it in JavaScript, which means transferring the whole table just to compute five numbers, and getting slower as the ledger grows. Using `FILTER (WHERE ...)` inside one aggregate query lets Postgres do that work in one pass instead.

OTPs and refresh tokens are stored as SHA-256 hashes, never plaintext — a DB dump gets you hashes, not working credentials. OTP verification happens inside a transaction with the row locked `FOR UPDATE`, so two concurrent guesses can't both read "4 attempts left" and both proceed; each one really does cost an attempt, capped at 5 before lockout. Refresh tokens rotate on every use and are single-use by design — if a token that's already been rotated ever shows up again, that's not a normal race condition, it's a strong signal of a stolen or duplicated token, so the whole session family gets revoked.

Receipt uploads get checked by their actual magic bytes, not by the filename or whatever `Content-Type` the client claims. An HTML or SVG file renamed to `.png` gets rejected before it ever touches disk — that's specifically what stops someone using the upload as a stored-XSS vector against our own origin.

Marking something repaid is a single conditional `UPDATE ... WHERE status = 'outstanding'`. Two taps racing each other hit that at the database level, not in application code, so exactly one wins and the other gets a clean `409`. No read-then-write anywhere, so there's no window for a lost update.

Pagination uses a keyset cursor rather than `OFFSET` — comparing against the last row you saw instead of asking Postgres to count and skip. `OFFSET` gets slower on later pages and can skip or duplicate rows if the list changes while someone's scrolling; this doesn't have either problem.

### The app

Routing is Expo Router, file-based, under `src/app/`, using the current `Stack.Protected` pattern to gate the signed-in routes behind a real session and the auth routes behind a signed-out one.

Server state goes through TanStack Query, with optimistic updates on marking something repaid (or undoing it) — the row flips instantly in every open filter tab, then reconciles once the actual response comes back, and rolls back cleanly if the request fails.

Tokens live in the OS keychain via `expo-secure-store`, not `AsyncStorage` — a refresh token is a long-lived bearer credential for the account, and `AsyncStorage` is unencrypted on Android. Worth the extra dependency.

There's one fetch client (`lib/api-client.ts`) that all requests go through, and it handles the case where your access token expires mid-session: a 401 triggers a single shared token refresh, deduplicated across whatever else happens to be in flight at that moment. Without that dedup, three screens 401-ing at once would each try to refresh independently, and since a refresh token is single-use, only the first would actually succeed — the other two would look like token reuse and get the whole session revoked.

## Against the brief

**Backend**
- [x] Phone login with a mock OTP, printed to the server log
- [x] Add a loan entry — friend name, amount, due date
- [x] Mark an entry as repaid
- [x] Summary endpoint: total lent, total repaid, overdue amount (plus due-soon and a per-friend breakdown, which weren't asked for but fell out naturally)

**App**
- [x] Login screen, phone + OTP
- [x] List of entries, overdue ones highlighted
- [x] Form to add an entry
- [x] Summary card at the top

**Bonus**
- [x] Receipt photo upload, camera or library
- [x] Input validation (Zod, both sides) and tests — 95 of them, 41 unit and 54 integration against a real throwaway Postgres, which felt like more than "basic" but didn't seem like a reason to stop

## If something's not working

- **App can't reach the API** — check `npm run dev` is actually still running in the server terminal, and that `curl http://localhost:4000/api/health` comes back `{"status":"ok", ...}`
- **Postgres won't come up** — Docker Desktop has to be open first; `open -a Docker` and wait for it to say it's running before `docker compose up -d`
- **"Unmatched Route" or a blank screen on first launch** — quit everything and run `npx expo start -c` to clear Metro's cache. Shows up most often right after switching Node versions
- **First Simulator launch feels slow** — that's `expo start --ios` downloading the Expo Go client to the simulator the first time; every launch after that is fast
