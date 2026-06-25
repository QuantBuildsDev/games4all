// ============================================================
//  2048 — Phaser 3 + Firebase high-score saving
// ============================================================

import { auth, db } from "../../firebase.js";
import { showSignInRequired } from "../../shared/auth-guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { submitScore } from "../../shared/score-sync.js";

// ---------- Board metrics ----------
const SIZE = 4;
const W = 480;
const PAD = 14;
const CELL = (W - PAD * (SIZE + 1)) / SIZE; // 102.5
const RADIUS = 10;
const MOVE_MS = 110;
const SCORE_FIELD = "game2048"; // Firestore field under scores/{uid}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const scoreVal = $("scoreVal");
const bestVal = $("bestVal");
const winScreen = $("winScreen");
const overScreen = $("overScreen");
const finalScore = $("finalScore");
const saveNote = $("saveNote");

// ---------- Best score (local + cloud) ----------
const LS_KEY = "g4a_2048_best";
let localBest = parseInt(localStorage.getItem(LS_KEY) || "0", 10);
let cloudBest = 0;
let currentUser = null;

const shownBest = () => Math.max(localBest, cloudBest);
function refreshBest() { bestVal.textContent = currentUser ? shownBest() : "—"; }
refreshBest();

// ============================================================
//  Firebase auth + persistence
// ============================================================
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  updateAuthUI(user);
  if (!user) { showSignInRequired(); return; }
  try {
    const snap = await getDoc(doc(db, "scores", user.uid));
    if (snap.exists()) {
      cloudBest = snap.data()[SCORE_FIELD] || 0;
      if (cloudBest > localBest) {
        localBest = cloudBest;
        localStorage.setItem(LS_KEY, String(localBest));
      }
      refreshBest();
    }
  } catch (err) {
    console.warn("Could not load cloud best:", err);
  }
});

function updateAuthUI(user) {
  const hint = $("authHint");
  const userBox = $("authUser");
  if (user) {
    hint.hidden = true;
    userBox.hidden = false;
    $("authName").textContent = localStorage.getItem("g4a_username_" + user.uid) || (user.displayName || "Player").split(" ")[0];
    $("authAvatar").src = user.photoURL || avatarFallback(user.displayName || "P");
  } else {
    hint.hidden = false;
    userBox.hidden = true;
  }
}
function avatarFallback(name) {
  const letter = (name.trim()[0] || "P").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#7c5cff"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Outfit" font-size="28" font-weight="700" fill="#fff">${letter}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

async function persistBest(score) {
  if (score > localBest) {
    localBest = score;
    localStorage.setItem(LS_KEY, String(localBest));
    refreshBest();
  }
  if (!currentUser) return { status: "signin" };
  if (score <= cloudBest) return { status: "nobeat" };
  const res = await submitScore(SCORE_FIELD, score);
  if (res.status === "saved") cloudBest = score;
  return res;
}

// ============================================================
//  Tile colors (classic 2048 palette)
// ============================================================
function tileColors(v) {
  const map = {
    2:    [0xeee4da, "#776e65"],
    4:    [0xede0c8, "#776e65"],
    8:    [0xf2b179, "#f9f6f2"],
    16:   [0xf59563, "#f9f6f2"],
    32:   [0xf67c5f, "#f9f6f2"],
    64:   [0xf65e3b, "#f9f6f2"],
    128:  [0xedcf72, "#f9f6f2"],
    256:  [0xedcc61, "#f9f6f2"],
    512:  [0xedc850, "#f9f6f2"],
    1024: [0xedc53f, "#f9f6f2"],
    2048: [0xedc22e, "#f9f6f2"],
  };
  return map[v] || [0x3c3a32, "#f9f6f2"];
}
function fontSizeFor(v) {
  if (v < 100) return 46;
  if (v < 1000) return 38;
  return 30;
}

// ============================================================
//  Tiny WebAudio sfx
// ============================================================
let actx;
function sfx(type) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    if (type === "merge") {
      o.type = "sine";
      o.frequency.setValueAtTime(330, now);
      o.frequency.exponentialRampToValueAtTime(520, now + 0.09);
      g.gain.setValueAtTime(0.05, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      o.start(now); o.stop(now + 0.14);
    } else if (type === "over") {
      o.type = "sawtooth";
      o.frequency.setValueAtTime(200, now);
      o.frequency.exponentialRampToValueAtTime(70, now + 0.4);
      g.gain.setValueAtTime(0.07, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      o.start(now); o.stop(now + 0.45);
    }
  } catch (_) {}
}

// ============================================================
//  Position helpers
// ============================================================
function cellCenter(r, c) {
  return {
    x: PAD + c * (CELL + PAD) + CELL / 2,
    y: PAD + r * (CELL + PAD) + CELL / 2,
  };
}
// Map a line index `i` and slot `k` (in travel order) to a board (r,c)
function posFor(dir, i, k) {
  if (dir === "left") return { r: i, c: k };
  if (dir === "right") return { r: i, c: SIZE - 1 - k };
  if (dir === "up") return { r: k, c: i };
  return { r: SIZE - 1 - k, c: i }; // down
}

// ============================================================
//  Phaser scene
// ============================================================
class Game2048 extends Phaser.Scene {
  constructor() { super("g2048"); }

  create() {
    this.score = 0;
    this.won = false;
    this.animating = false;
    this.cells = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

    this.drawBoardBackground();

    this.tileLayer = this.add.container(0, 0);

    // Input — keyboard
    const map = {
      "keydown-LEFT": "left", "keydown-A": "left",
      "keydown-RIGHT": "right", "keydown-D": "right",
      "keydown-UP": "up", "keydown-W": "up",
      "keydown-DOWN": "down", "keydown-S": "down",
    };
    Object.entries(map).forEach(([key, dir]) => {
      this.input.keyboard.on(key, () => this.move(dir));
    });

    // Input — swipe
    this.input.on("pointerdown", (p) => { this.swipeStart = { x: p.x, y: p.y }; });
    this.input.on("pointerup", (p) => {
      if (!this.swipeStart) return;
      const dx = p.x - this.swipeStart.x;
      const dy = p.y - this.swipeStart.y;
      this.swipeStart = null;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? "right" : "left");
      else this.move(dy > 0 ? "down" : "up");
    });

    // Expose controls to DOM
    window.__newGame2048 = () => this.newGame();

    this.startGame();
  }

  drawBoardBackground() {
    const g = this.add.graphics();
    g.fillStyle(0x1b1f33, 1);
    g.fillRoundedRect(0, 0, W, W, 14);
    g.fillStyle(0x2a2f49, 1);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const { x, y } = cellCenter(r, c);
        g.fillRoundedRect(x - CELL / 2, y - CELL / 2, CELL, CELL, RADIUS);
      }
    }
  }

  // ---- Tile object management ----
  makeTile(r, c, value) {
    const { x, y } = cellCenter(r, c);
    const gfx = this.add.graphics();
    const text = this.add.text(0, 0, String(value), {
      fontFamily: '"Space Grotesk", sans-serif',
      fontSize: fontSizeFor(value) + "px",
      fontStyle: "700",
    }).setOrigin(0.5);
    const container = this.add.container(x, y, [gfx, text]);
    const tile = { value, gfx, text, container, row: r, col: c };
    this.drawTile(tile);
    this.tileLayer.add(container);
    this.cells[r][c] = tile;

    // Pop-in
    container.setScale(0);
    this.tweens.add({ targets: container, scale: 1, duration: 130, ease: "Back.easeOut" });
    return tile;
  }

  drawTile(tile) {
    const [bg, fg] = tileColors(tile.value);
    tile.gfx.clear();
    tile.gfx.fillStyle(bg, 1);
    tile.gfx.fillRoundedRect(-CELL / 2, -CELL / 2, CELL, CELL, RADIUS);
    tile.text.setText(String(tile.value));
    tile.text.setFontSize(fontSizeFor(tile.value));
    tile.text.setColor(fg);
  }

  spawnRandom() {
    const empties = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (!this.cells[r][c]) empties.push({ r, c });
    if (!empties.length) return;
    const { r, c } = Phaser.Utils.Array.GetRandom(empties);
    const value = Math.random() < 0.9 ? 2 : 4;
    this.makeTile(r, c, value);
  }

  startGame() {
    this.spawnRandom();
    this.spawnRandom();
    updateScore(0, true);
  }

  newGame() {
    // Clear all tiles
    this.tileLayer.removeAll(true);
    this.cells = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    this.score = 0;
    this.won = false;
    this.animating = false;
    winScreen.hidden = true;
    overScreen.hidden = true;
    saveNote.textContent = "";
    updateScore(0, true);
    this.spawnRandom();
    this.spawnRandom();
  }

  // ---- Core move ----
  move(dir) {
    if (this.animating) return;
    if (!overScreen.hidden) return; // ignore moves on game over

    const newCells = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    const slides = []; // {tile, r, c}
    const merges = []; // {keep, remove, value, r, c}
    let gain = 0;

    for (let i = 0; i < SIZE; i++) {
      // gather tiles in this line in travel order
      const tiles = [];
      for (let k = 0; k < SIZE; k++) {
        const { r, c } = posFor(dir, i, k);
        if (this.cells[r][c]) tiles.push(this.cells[r][c]);
      }
      let slot = 0;
      let k = 0;
      while (k < tiles.length) {
        const { r, c } = posFor(dir, i, slot);
        if (k + 1 < tiles.length && tiles[k].value === tiles[k + 1].value) {
          newCells[r][c] = tiles[k];
          merges.push({ keep: tiles[k], remove: tiles[k + 1], value: tiles[k].value * 2, r, c });
          slides.push({ tile: tiles[k], r, c });
          slides.push({ tile: tiles[k + 1], r, c });
          gain += tiles[k].value * 2;
          k += 2;
        } else {
          newCells[r][c] = tiles[k];
          slides.push({ tile: tiles[k], r, c });
          k += 1;
        }
        slot++;
      }
    }

    // Did anything actually move?
    const moved = slides.some((s) => s.tile.row !== s.r || s.tile.col !== s.c);
    if (!moved) return;

    this.animating = true;
    this.cells = newCells;

    // Animate slides
    for (const s of slides) {
      const { x, y } = cellCenter(s.r, s.c);
      s.tile.row = s.r;
      s.tile.col = s.c;
      this.tweens.add({ targets: s.tile.container, x, y, duration: MOVE_MS, ease: "Quad.easeOut" });
    }

    // Finalize after slide completes
    this.time.delayedCall(MOVE_MS, () => {
      let justWon = false;
      for (const m of merges) {
        m.remove.container.destroy();
        m.keep.value = m.value;
        this.drawTile(m.keep);
        // merge pop
        this.tweens.add({ targets: m.keep.container, scale: 1.18, duration: 70, yoyo: true, ease: "Quad.easeOut" });
        if (m.value === 2048 && !this.won) { this.won = true; justWon = true; }
      }
      if (merges.length) { updateScore(gain); sfx("merge"); }

      this.spawnRandom();
      this.animating = false;

      // Only show the win overlay at the moment 2048 is first reached
      if (justWon) showWin();
      else if (!this.movesAvailable()) this.gameOver();
    });
  }

  movesAvailable() {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (!this.cells[r][c]) return true;
        const v = this.cells[r][c].value;
        if (c + 1 < SIZE && this.cells[r][c + 1] && this.cells[r][c + 1].value === v) return true;
        if (r + 1 < SIZE && this.cells[r + 1][c] && this.cells[r + 1][c].value === v) return true;
      }
    return false;
  }

  gameOver() {
    sfx("over");
    showGameOver(gameScore);
  }
}

// ============================================================
//  Score + overlay glue (module scope)
// ============================================================
let gameScore = 0;
function updateScore(delta, reset = false) {
  gameScore = reset ? 0 : gameScore + delta;
  scoreVal.textContent = gameScore;
  // Live "best" preview: show whichever is higher, the saved best or this run
  bestVal.textContent = currentUser ? Math.max(shownBest(), gameScore) : "—";
}

function showWin() {
  winScreen.hidden = false;
  persistBest(gameScore); // record progress even mid-game
}

function showGameOver(score) {
  finalScore.textContent = score;
  saveNote.className = "save-note";
  saveNote.textContent = "Saving…";
  persistBest(score).then((res) => {
    refreshBest();
    if (res.status === "saved") { saveNote.classList.add("saved"); saveNote.textContent = "🏆 New high score saved!"; }
    else if (res.status === "signin") { saveNote.classList.add("signin"); saveNote.textContent = "Sign in on the home page to save scores"; }
    else if (res.status === "nobeat") { saveNote.textContent = "Good game! Beat your best to set a record."; }
    else if (res.status === "error") { saveNote.textContent = "Couldn't save — check your connection."; }
  });
  overScreen.hidden = false;
}

// ============================================================
//  Boot Phaser
// ============================================================
const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: W,
  height: W,
  backgroundColor: "#141728",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: Game2048,
};
const game = new Phaser.Game(config);

// ---------- DOM buttons ----------
$("newGameBtn").addEventListener("click", () => window.__newGame2048 && window.__newGame2048());
$("overNewBtn").addEventListener("click", () => window.__newGame2048 && window.__newGame2048());
$("winNewBtn").addEventListener("click", () => window.__newGame2048 && window.__newGame2048());
$("keepGoingBtn").addEventListener("click", () => { winScreen.hidden = true; });

// Prevent arrow keys from scrolling the page
window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
}, { passive: false });
