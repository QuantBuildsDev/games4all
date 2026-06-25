// ============================================================
//  Snake — Phaser 3 + Firebase high-score saving
// ============================================================

import { auth, db } from "../../firebase.js";
import { showSignInRequired } from "../../shared/auth-guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { submitScore } from "../../shared/score-sync.js";

// ---------- Board metrics ----------
const W = 480;
const GRID = 20;
const CELL = W / GRID; // 24
const START_LEN = 4;
const START_INTERVAL = 145; // ms per step
const MIN_INTERVAL = 70;
const SPEEDUP = 4;          // ms faster per apple
const SCORE_FIELD = "snake";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const scoreVal = $("scoreVal");
const bestVal = $("bestVal");
const startScreen = $("startScreen");
const overScreen = $("overScreen");
const finalScore = $("finalScore");
const saveNote = $("saveNote");

// ---------- Best score (local + cloud) ----------
const LS_KEY = "g4a_snake_best";
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
  if (user) {
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
    if (type === "eat") {
      o.type = "square";
      o.frequency.setValueAtTime(520, now);
      o.frequency.exponentialRampToValueAtTime(760, now + 0.07);
      g.gain.setValueAtTime(0.05, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      o.start(now); o.stop(now + 0.1);
    } else if (type === "die") {
      o.type = "sawtooth";
      o.frequency.setValueAtTime(240, now);
      o.frequency.exponentialRampToValueAtTime(60, now + 0.35);
      g.gain.setValueAtTime(0.08, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      o.start(now); o.stop(now + 0.4);
    }
  } catch (_) {}
}

// ---------- Color helper ----------
function lerpColor(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// ============================================================
//  Phaser scene
// ============================================================
class SnakeScene extends Phaser.Scene {
  constructor() { super("snake"); }

  create() {
    this.gfx = this.add.graphics();
    this.pauseText = this.add.text(W / 2, W / 2, "Paused", {
      fontFamily: '"Space Grotesk", sans-serif', fontSize: "40px", color: "#ffffff", fontStyle: "700",
    }).setOrigin(0.5).setDepth(5).setVisible(false);

    this.state = "ready";
    this.resetState();
    this.draw();

    // Keyboard
    const dirs = {
      "keydown-LEFT": [-1, 0], "keydown-A": [-1, 0],
      "keydown-RIGHT": [1, 0], "keydown-D": [1, 0],
      "keydown-UP": [0, -1], "keydown-W": [0, -1],
      "keydown-DOWN": [0, 1], "keydown-S": [0, 1],
    };
    Object.entries(dirs).forEach(([key, [x, y]]) => {
      this.input.keyboard.on(key, () => this.steer(x, y));
    });
    this.input.keyboard.on("keydown-P", () => this.togglePause());

    // Swipe
    this.input.on("pointerdown", (p) => { this.swipeStart = { x: p.x, y: p.y }; });
    this.input.on("pointerup", (p) => {
      if (!this.swipeStart) return;
      const dx = p.x - this.swipeStart.x;
      const dy = p.y - this.swipeStart.y;
      this.swipeStart = null;
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
      if (Math.abs(dx) > Math.abs(dy)) this.steer(dx > 0 ? 1 : -1, 0);
      else this.steer(0, dy > 0 ? 1 : -1);
    });

    // Expose start/restart to DOM buttons
    window.__startSnake = () => this.startGame();
  }

  resetState() {
    this.snake = [];
    const cy = Math.floor(GRID / 2);
    const startX = Math.floor(GRID / 2);
    for (let i = 0; i < START_LEN; i++) this.snake.push({ x: startX - i, y: cy });
    this.dir = { x: 1, y: 0 };
    this.pendingDir = { x: 1, y: 0 };
    this.interval = START_INTERVAL;
    this.acc = 0;
    updateScore(0, true);
    this.placeFood();
  }

  startGame() {
    startScreen.hidden = true;
    overScreen.hidden = true;
    saveNote.textContent = "";
    this.pauseText.setVisible(false);
    this.resetState();
    this.state = "playing";
    this.draw();
  }

  steer(x, y) {
    if (this.state === "ready") { this.startGame(); }
    if (this.state !== "playing") return;
    // ignore direct reversal
    if (x === -this.dir.x && y === -this.dir.y) return;
    // ignore no-op (same as current)
    if (x === this.dir.x && y === this.dir.y) return;
    this.pendingDir = { x, y };
  }

  togglePause() {
    if (this.state === "playing") { this.state = "paused"; this.pauseText.setVisible(true); }
    else if (this.state === "paused") { this.state = "playing"; this.pauseText.setVisible(false); }
  }

  placeFood() {
    const occupied = new Set(this.snake.map((s) => s.x + "," + s.y));
    const free = [];
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++)
        if (!occupied.has(x + "," + y)) free.push({ x, y });
    if (!free.length) { this.food = null; return; } // board full (win)
    this.food = Phaser.Utils.Array.GetRandom(free);
  }

  step() {
    if (this.state !== "playing") return;

    this.dir = this.pendingDir;
    const head = this.snake[0];
    const nx = head.x + this.dir.x;
    const ny = head.y + this.dir.y;

    // Wall collision
    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) return this.die();

    const willGrow = this.food && nx === this.food.x && ny === this.food.y;

    // Self collision (the tail will move away unless we grow)
    const body = willGrow ? this.snake : this.snake.slice(0, this.snake.length - 1);
    if (body.some((s) => s.x === nx && s.y === ny)) return this.die();

    this.snake.unshift({ x: nx, y: ny });

    if (willGrow) {
      updateScore(10);
      this.interval = Math.max(MIN_INTERVAL, this.interval - SPEEDUP);
      sfx("eat");
      this.placeFood();
      if (!this.food) return this.win();
    } else {
      this.snake.pop();
    }

    this.draw();
  }

  die() {
    this.state = "dead";
    sfx("die");
    // flash the head red then show game over
    this.draw(true);
    this.time.delayedCall(360, () => showGameOver(gameScore));
  }

  win() {
    this.state = "dead";
    this.draw();
    this.time.delayedCall(200, () => showGameOver(gameScore));
  }

  draw(dead = false) {
    const g = this.gfx;
    g.clear();

    // faint grid
    g.lineStyle(1, 0xffffff, 0.03);
    for (let i = 1; i < GRID; i++) {
      g.lineBetween(i * CELL, 0, i * CELL, W);
      g.lineBetween(0, i * CELL, W, i * CELL);
    }

    // food
    if (this.food) {
      const fx = this.food.x * CELL + CELL / 2;
      const fy = this.food.y * CELL + CELL / 2;
      g.fillStyle(0xff4d6d, 1);
      g.fillCircle(fx, fy, CELL * 0.34);
      g.fillStyle(0xffffff, 0.45);
      g.fillCircle(fx - 3, fy - 3, CELL * 0.1);
    }

    // snake body
    const n = this.snake.length;
    for (let i = n - 1; i >= 0; i--) {
      const s = this.snake[i];
      const t = n > 1 ? i / (n - 1) : 0;
      let color = lerpColor(0x2fe6a8, 0x12806e, t);
      if (i === 0 && dead) color = 0xff4d6d;
      g.fillStyle(color, 1);
      g.fillRoundedRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2, 6);
    }

    // head eyes
    const head = this.snake[0];
    const cx = head.x * CELL + CELL / 2;
    const cy = head.y * CELL + CELL / 2;
    const fwd = CELL * 0.16, side = CELL * 0.2, eye = CELL * 0.12;
    const px = -this.dir.y, py = this.dir.x;
    g.fillStyle(0x0e1322, 1);
    g.fillCircle(cx + this.dir.x * fwd + px * side, cy + this.dir.y * fwd + py * side, eye);
    g.fillCircle(cx + this.dir.x * fwd - px * side, cy + this.dir.y * fwd - py * side, eye);
  }

  update(_t, delta) {
    if (this.state !== "playing") return;
    this.acc += delta;
    // cap to avoid spiral-of-death after tab refocus
    if (this.acc > 1000) this.acc = this.interval;
    while (this.acc >= this.interval && this.state === "playing") {
      this.acc -= this.interval;
      this.step();
    }
  }
}

// ============================================================
//  Score + overlay glue (module scope)
// ============================================================
let gameScore = 0;
function updateScore(delta, reset = false) {
  gameScore = reset ? 0 : gameScore + delta;
  scoreVal.textContent = gameScore;
  bestVal.textContent = currentUser ? Math.max(shownBest(), gameScore) : "—";
}

function showGameOver(score) {
  finalScore.textContent = score;
  saveNote.className = "save-note";
  saveNote.textContent = "Saving…";
  persistBest(score).then((res) => {
    refreshBest();
    if (res.status === "saved") { saveNote.classList.add("saved"); saveNote.textContent = "🏆 New high score saved!"; }
    else if (res.status === "signin") { saveNote.classList.add("signin"); saveNote.textContent = "Sign in on the home page to save scores"; }
    else if (res.status === "nobeat") { saveNote.textContent = "Nice run! Beat your best to set a record."; }
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
  backgroundColor: "#0e1322",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: SnakeScene,
};
const game = new Phaser.Game(config);

// ---------- DOM buttons ----------
$("startBtn").addEventListener("click", () => window.__startSnake && window.__startSnake());
$("restartBtn").addEventListener("click", () => window.__startSnake && window.__startSnake());

// Prevent arrow keys from scrolling the page
window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
}, { passive: false });
