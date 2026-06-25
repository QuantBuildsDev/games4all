// ============================================================
//  Leaderboard — fetch all scores and render per-game tables
// ============================================================

import { auth, db } from "../firebase.js";
import { showSignInRequired } from "../shared/auth-guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- Game definitions ----------
const GAMES = [
  {
    key:    "flappybird",
    name:   "Flappy Bird",
    format: v => `${v} pts`,
  },
  {
    key:    "game2048",
    name:   "2048",
    format: v => v.toLocaleString() + " pts",
  },
  {
    key:    "snake",
    name:   "Snake",
    format: v => `${v} pts`,
  },
  {
    key:    "racing",
    name:   "Highway Rush",
    format: v => `${v} m`,
  },
  {
    key:    "parking",
    name:   "Parking Panic",
    // Levels 1-10; show progress out of 10
    format: v => `Level ${v} / 10`,
  },
  {
    key:    "tetris",
    name:   "Tetris",
    format: v => v.toLocaleString() + " pts",
  },
];

const MEDAL = ["🥇", "🥈", "🥉"];

// ---------- Auth ----------
let currentUid = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) { showSignInRequired(); return; }

  currentUid = user.uid;
  updateAuthUI(user);
  await loadAll();
});

function updateAuthUI(user) {
  const hint    = document.getElementById("authHint");
  const userBox = document.getElementById("authUser");
  hint.hidden    = true;
  userBox.hidden = false;
  document.getElementById("authName").textContent   =
    localStorage.getItem("g4a_username_" + user.uid) || (user.displayName || "Player").split(" ")[0];
  document.getElementById("authAvatar").src = user.photoURL || avatarFallback(user.displayName || "P");
}

function avatarFallback(name) {
  const l = (name.trim()[0] || "P").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#7c5cff"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Outfit" font-size="28" font-weight="700" fill="#fff">${l}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// ---------- Data ----------
async function loadAll() {
  let docs;
  try {
    // Fetch scores and usernames in parallel, then join by uid
    const [scoresSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, "scores")),
      getDocs(collection(db, "users")),
    ]);

    // Build uid → username lookup from the users collection
    const usernameMap = {};
    usersSnap.docs.forEach(d => {
      if (d.data().username) usernameMap[d.id] = d.data().username;
    });

    // Merge: prefer the chosen username, fall back to Google display name
    docs = scoresSnap.docs.map(d => ({
      uid: d.id,
      ...d.data(),
      displayName: usernameMap[d.id] || d.data().displayName || "Anonymous",
    }));
  } catch (err) {
    console.error("Leaderboard fetch failed:", err);
    GAMES.forEach(g => {
      const el = document.getElementById("rows-" + g.key);
      if (el) el.innerHTML = `<p class="lb-empty">Couldn't load scores — check your connection.</p>`;
    });
    return;
  }

  GAMES.forEach(game => renderGame(game, docs));
}

function renderGame(game, allDocs) {
  const container = document.getElementById("rows-" + game.key);
  if (!container) return;

  const ranked = allDocs
    .filter(d => d[game.key] != null && d[game.key] > 0)
    .sort((a, b) => b[game.key] - a[game.key])
    .slice(0, 10);

  if (!ranked.length) {
    container.innerHTML = `<p class="lb-empty">No scores yet — be the first to play!</p>`;
    return;
  }

  container.innerHTML = ranked.map((entry, i) => {
    const isYou     = entry.uid === currentUid;
    const rankClass = i < 3 ? `rank-${i + 1}` : "";
    const medal     = i < 3 ? MEDAL[i] : `#${i + 1}`;
    const name      = esc(entry.displayName || "Anonymous");
    const score     = game.format(entry[game.key]);
    const avatar    = entry.photoURL || avatarFallback(entry.displayName || "?");

    return `
      <div class="lb-row ${rankClass} ${isYou ? "is-you" : ""}">
        <span class="lb-rank">${medal}</span>
        <img class="lb-avatar" src="${esc(avatar)}" referrerpolicy="no-referrer"
             onerror="this.src='${avatarFallback(entry.displayName || "?")}'"/>
        <span class="lb-name">${name}</span>
        <span class="lb-score">${score}</span>
      </div>`;
  }).join("");
}

// Prevent XSS from Firestore data
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- Tabs ----------
const tabs   = document.querySelectorAll(".lb-tab");
const panels = document.querySelectorAll(".lb-panel");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    const game = tab.dataset.game;

    tabs.forEach(t   => t.classList.remove("active"));
    panels.forEach(p => p.classList.remove("active"));

    tab.classList.add("active");
    const panel = document.getElementById("panel-" + game);
    if (panel) panel.classList.add("active");
  });
});
