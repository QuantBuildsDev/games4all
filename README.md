# Games4All 🎮

A full-stack arcade of free, instant-play browser games — with Google sign-in,
global leaderboards, server-validated high scores, and an **AI-powered gaming
news feed that updates itself daily**.

🕹️ **Live:** [games4all-delta.vercel.app](https://games4all-delta.vercel.app)

---

## Features

- **6 arcade games** built with [Phaser 3](https://phaser.io/) — Flappy Bird, 2048, Snake, Highway Rush, Parking Panic, and Tetris.
- **Google sign-in** via Firebase Authentication.
- **Global leaderboards** — per-game high scores stored in Cloud Firestore.
- **Cheat-resistant scores** — scores are validated and written by a serverless function, not the browser (see [Architecture](#architecture)).
- **Automated Gaming News** — a daily GitHub Action pulls real gaming headlines, writes an original take with the Google Gemini API, and publishes them automatically.

## Tech stack

| Area | Technology |
|------|-----------|
| Frontend | Vanilla JavaScript (ES Modules), HTML5, CSS3, Phaser 3 |
| Auth & Database | Firebase Authentication (Google OAuth), Cloud Firestore |
| Backend | Vercel Serverless Functions (Node.js), Firebase Admin SDK |
| Automation & AI | GitHub Actions (cron), Google Gemini API, RSS parsing |
| Hosting / CI | Vercel (auto-deploy on push to `main`) |

---

## Architecture

### Server-validated scores (anti-cheat)

Because the games run entirely in the browser, a player could otherwise open the
console and write any score straight to the database. To prevent that:

1. The browser **cannot write to the `scores` collection at all** — Firestore
   Security Rules block all client writes.
2. When a game ends, it `POST`s the score to **`/api/submit-score`** (a Vercel
   serverless function) with the user's Firebase ID token.
3. The function **verifies the token**, validates and caps the score, and writes
   it via the **Firebase Admin SDK** inside a transaction that never lowers an
   existing best.

```
Browser game ──POST {score, idToken}──▶ /api/submit-score ──(Admin SDK)──▶ Firestore
                                         (verify · validate · cap)
```

Firestore Security Rules ([`firestore.rules`](firestore.rules)) additionally enforce
per-field types/ranges, monotonic scores, and a strict document shape to prevent
tampering and quota abuse.

### Automated AI news feed

A scheduled **GitHub Actions** workflow ([`.github/workflows/news.yml`](.github/workflows/news.yml))
runs once a day and:

1. Pulls the latest headlines from gaming **RSS feeds** (IGN, Polygon, PC Gamer).
2. Uses the **Gemini API** to pick the first genuine *video-game* story (filtering
   out movie/TV/celebrity items) and write an original ~100-word take.
3. Writes the result to [`news/articles.json`](news/articles.json) and commits it —
   which triggers a **Vercel auto-deploy**, publishing the article live.

The pipeline ([`scripts/generate-news.mjs`](scripts/generate-news.mjs)) is tuned for
free-tier reliability: it batches classification into a single API call and falls
back from `gemini-2.5-flash` to `gemini-2.5-flash-lite` if the quota is hit.

```
GitHub Action (daily) ─▶ RSS ─▶ Gemini (classify + summarize) ─▶ commit ─▶ Vercel deploy ─▶ live
```

---

## Project structure

```
games4all/
├── index.html              # landing page
├── app.js                  # auth + username + landing UI
├── firebase.js             # shared Firebase init
├── firestore.rules         # security rules (scores locked to server-only)
├── api/submit-score.js     # serverless score validator (Admin SDK)
├── shared/                 # auth guard + score-submit helper
├── games/                  # the 6 Phaser games
├── leaderboard/            # global leaderboard page
├── news/                   # AI news page + articles.json
├── scripts/generate-news.mjs   # RSS → Gemini → articles.json
└── .github/workflows/news.yml  # daily cron
```

---

## Running locally

The site uses ES modules, so serve it over HTTP (not `file://`).

```bash
# Static preview (games, leaderboard, news page):
npx serve .
```

The serverless function (`/api/submit-score`) and the news script only run on
Vercel's runtime. To exercise the full stack locally, use the Vercel CLI:

```bash
npm install
vercel dev
```

To generate a news article locally (needs a `GEMINI_API_KEY` in a `.env` file):

```bash
node scripts/generate-news.mjs        # add DRY_RUN=1 to preview without writing
```

## Deployment

Hosted on **Vercel**, auto-deploying on every push to `main`. Two secrets/vars power the backend:

- `FIREBASE_SERVICE_ACCOUNT` — Vercel environment variable, used by the score-validation function.
- `GEMINI_API_KEY` — GitHub Actions secret, used by the daily news workflow.

> **A note on the exposed Firebase keys:** the `firebaseConfig` in
> [`firebase.js`](firebase.js) is **safe to be public** — that's how Firebase web
> apps work. Access is controlled by Auth settings and Firestore Security Rules,
> not by hiding the config.

---

## License

Personal portfolio project. Game art assets from [Kenney](https://kenney.nl/) (CC0).
