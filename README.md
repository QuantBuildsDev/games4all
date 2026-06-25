# Games4All 🎮

A growing arcade of free, instant-play browser games — built with plain HTML/CSS/JS,
[Phaser 3](https://phaser.io/) for the games, and **Firebase** for Google sign-in
and high-score storage. Deploys as a static site on **Vercel**.

---


```js
const firebaseConfig = {
  apiKey: "AIza………",
  authDomain: "games4all-xxxxx.firebaseapp.com",
  projectId: "games4all-xxxxx",
  storageBucket: "games4all-xxxxx.appspot.com",
  messagingSenderId: "0000000000",
  appId: "1:0000000000:web:abcdef……",
};
```

> ℹ️ These keys are **safe to expose** in client-side code — that's how Firebase
> web apps work. Security is enforced by Auth settings + Firestore rules, not by
> hiding the API key.

### 4. Enable Google Sign-In
1. Left sidebar → **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → click **Google** → toggle **Enable**.
3. Pick a support email → **Save**.

### 5. Authorize your domains
Still under **Authentication → Settings → Authorized domains**, make sure these are listed
(add any that are missing):
- `localhost` (for local testing)
- your Vercel domain, e.g. `games4all.vercel.app`
- your custom domain, if you add one later

That's it — sign-in will now work. 🎉

> **Phase 2 note:** When we add score-saving, you'll also enable **Firestore Database**
> (Build → Firestore → Create database → *production mode*) and add a small security
> rule. We'll cover that when we build the game.

---

## ▶️ Running locally

Because the site uses ES modules, open it through a local server (not `file://`):

**VS Code:** install the **Live Server** extension → right-click `index.html` → *Open with Live Server*.

**Or with Node:**
```bash
npx serve .
```

**Or with Python:**
```bash
python -m http.server 5500
```
Then visit the URL it prints (e.g. `http://localhost:5500`).

---

## 🚀 Deploying to Vercel

1. Push this folder to a GitHub repo.
2. Go to <https://vercel.com/new> → import the repo.
3. Framework preset: **Other** (it's a static site — no build step).
4. Click **Deploy**.
5. Copy your `*.vercel.app` domain and add it to Firebase **Authorized domains** (step 5 above).

No environment variables or build command needed.

---

## Roadmap
- [x] **Phase 1** — Landing page + Google auth
- [ ] **Phase 2** — Flappy Bird (Phaser 3) + Firestore high scores
- [ ] **Phase 3** — Global leaderboards
- [ ] More games…
