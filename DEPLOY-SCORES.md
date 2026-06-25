# Server-side score validation — setup & deploy

Scores are no longer written by the browser. The games POST to a Vercel
serverless function (`/api/submit-score`) which verifies the player, validates
the score, and writes it with the Firebase Admin SDK. Firestore rules now
**block all client writes** to `scores`, so the only way to save is through the
server — which kills the "type a score in the console" cheat.

Follow these steps once. **Do them in order** — locking the rules before the
function is live would stop scores saving.

---

## 1. Generate a Firebase service-account key (free)

1. [Firebase Console](https://console.firebase.google.com/) → your project
   (**games4all-9237d**) → ⚙️ **Project settings** → **Service accounts** tab.
2. Click **Generate new private key** → **Generate key**. A JSON file downloads.
3. Keep this file private — it grants admin access. **Never commit it.**

## 2. Add it to Vercel as an environment variable

1. [Vercel dashboard](https://vercel.com/) → your project → **Settings** →
   **Environment Variables**.
2. Add a variable:
   - **Name:** `FIREBASE_SERVICE_ACCOUNT`
   - **Value:** paste the **entire contents** of the JSON file (one big blob —
     pasting with newlines is fine).
   - **Environments:** Production (and Preview, if you use it).
3. Save.

## 3. Deploy the site + function

Push to GitHub (Vercel auto-deploys), or run `vercel --prod`. Vercel sees
`package.json`, installs `firebase-admin`, and turns `api/submit-score.js` into
a live endpoint at `https://<your-domain>/api/submit-score`.

**Test it:** sign in, beat a high score in any game, and confirm it still saves
("🏆 New high score saved!"). Check the leaderboard updates.

## 4. Deploy the locked-down Firestore rules (do this LAST)

Once scores save correctly through the function, publish the new rules:

```bash
firebase deploy --only firestore:rules
```

…or paste `firestore.rules` into Firebase Console → **Firestore Database** →
**Rules** → **Publish**.

After this, direct browser writes to `scores` are rejected — only the server
can save.

---

## Local development note

The `/api` function only runs on Vercel's infrastructure, **not** under VS Code
Live Server or `python -m http.server`. To test the function locally:

```bash
npm install
vercel dev
```

Then open the URL Vercel prints. Without `vercel dev`, the games will load but
score-saving will return an error locally (that's expected — it works once
deployed).

---

## What changed (file map)

| File | Change |
|---|---|
| `api/submit-score.js` | **New** — server validator (auth check + caps + monotonic write) |
| `shared/score-sync.js` | **New** — client helper the games call instead of writing directly |
| `package.json` | **New** — declares the `firebase-admin` dependency for Vercel |
| `firestore.rules` | `scores` writes blocked (server-only); legacy public rule removed; usernames validated |
| `games/*/game.js` | Each game now calls `submitScore(...)` instead of `setDoc(...)` |

## Optional next layer (free): Firebase App Check

App Check blocks requests that don't come from your real site (bots/scripts
hitting Firestore or the function directly). It's free and complements this.
Ask when you're ready and we'll wire it up.
