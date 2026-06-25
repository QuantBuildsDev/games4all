// ============================================================
//  Tetris — Phaser 3 + Firebase high-score saving
// ============================================================

import { auth, db } from "../../firebase.js";
import { showSignInRequired } from "../../shared/auth-guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { submitScore } from "../../shared/score-sync.js";

// ---------- Metrics ----------
const COLS = 10, ROWS = 20;
const CELL = 30;
const W = COLS * CELL;          // 300
const H = ROWS * CELL;          // 600
const PREVIEW_CELL = 22;        // cell size for next/hold preview canvases
const SCORE_FIELD = "tetris";

// ---------- Tetrominoes ----------
// Each piece: colour, 4 rotation states (each is a flat array of [col,row] offsets)
const PIECES = [
  // I — cyan
  {
    color: 0x00e5ff, dark: 0x00a8bb,
    rots: [
      [[0,1],[1,1],[2,1],[3,1]],
      [[2,0],[2,1],[2,2],[2,3]],
      [[0,2],[1,2],[2,2],[3,2]],
      [[1,0],[1,1],[1,2],[1,3]],
    ],
  },
  // O — yellow
  {
    color: 0xffe000, dark: 0xbba400,
    rots: [
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[2,1]],
    ],
  },
  // T — purple
  {
    color: 0xaa00ff, dark: 0x7700bb,
    rots: [
      [[1,0],[0,1],[1,1],[2,1]],
      [[1,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[2,1],[1,2]],
      [[1,0],[0,1],[1,1],[1,2]],
    ],
  },
  // S — green
  {
    color: 0x00e676, dark: 0x00a854,
    rots: [
      [[1,0],[2,0],[0,1],[1,1]],
      [[1,0],[1,1],[2,1],[2,2]],
      [[1,1],[2,1],[0,2],[1,2]],
      [[0,0],[0,1],[1,1],[1,2]],
    ],
  },
  // Z — red
  {
    color: 0xff1744, dark: 0xbb1033,
    rots: [
      [[0,0],[1,0],[1,1],[2,1]],
      [[2,0],[1,1],[2,1],[1,2]],
      [[0,1],[1,1],[1,2],[2,2]],
      [[1,0],[0,1],[1,1],[0,2]],
    ],
  },
  // J — blue
  {
    color: 0x2979ff, dark: 0x1c57bb,
    rots: [
      [[0,0],[0,1],[1,1],[2,1]],
      [[1,0],[2,0],[1,1],[1,2]],
      [[0,1],[1,1],[2,1],[2,2]],
      [[1,0],[1,1],[0,2],[1,2]],
    ],
  },
  // L — orange
  {
    color: 0xff6d00, dark: 0xbb4f00,
    rots: [
      [[2,0],[0,1],[1,1],[2,1]],
      [[1,0],[1,1],[1,2],[2,2]],
      [[0,1],[1,1],[2,1],[0,2]],
      [[0,0],[1,0],[1,1],[1,2]],
    ],
  },
];

// ---------- Scoring ----------
const LINE_SCORES = [0, 100, 300, 500, 800]; // 0-4 lines
const LEVEL_LINES = 10;                        // lines per level
function gravity(level) { return Math.max(50, 800 - (level - 1) * 70); } // ms per drop

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const scoreEl = $("scoreVal"), bestEl = $("bestVal");
const levelEl = $("levelVal"), linesEl = $("linesVal");
const startScreen = $("startScreen"), overScreen = $("overScreen");
const pauseScreen = $("pauseScreen");
const finalScoreEl = $("finalScore"), saveNote = $("saveNote");

// ---------- Best (local + cloud) ----------
const LS_KEY = "g4a_tetris_best";
let localBest = parseInt(localStorage.getItem(LS_KEY) || "0", 10);
let cloudBest = 0, currentUser = null;
const shownBest = () => Math.max(localBest, cloudBest);
function refreshBest() { bestEl.textContent = currentUser ? shownBest() : "—"; }
refreshBest();

// ============================================================
//  Firebase
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
        if (cloudBest > localBest) { localBest = cloudBest; localStorage.setItem(LS_KEY, String(localBest)); }
        refreshBest();
      }
    } catch (err) { console.warn("cloud best load failed", err); }
  }
});
function updateAuthUI(user) {
  if (user) {
    $("authHint").hidden = true; $("authUser").hidden = false;
    $("authName").textContent = localStorage.getItem("g4a_username_" + user.uid) || (user.displayName || "Player").split(" ")[0];
    $("authAvatar").src = user.photoURL || avatarFallback(user.displayName || "P");
  } else { $("authHint").hidden = false; $("authUser").hidden = true; }
}
function avatarFallback(name) {
  const l = (name.trim()[0] || "P").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#7c5cff"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Outfit" font-size="28" font-weight="700" fill="#fff">${l}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
async function persistBest(score) {
  if (score > localBest) { localBest = score; localStorage.setItem(LS_KEY, String(localBest)); refreshBest(); }
  if (!currentUser) return { status: "signin" };
  if (score <= cloudBest) return { status: "nobeat" };
  const res = await submitScore(SCORE_FIELD, score);
  if (res.status === "saved") cloudBest = score;
  return res;
}

// ============================================================
//  WebAudio sfx
// ============================================================
let actx;
function sfx(type) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    const p = { move:[`square`,220,200,0.03,0.06], rotate:[`sine`,440,540,0.04,0.08], drop:[`square`,180,120,0.06,0.1], clear:[`triangle`,520,900,0.08,0.25], tetris:[`sawtooth`,300,700,0.1,0.4], over:[`sawtooth`,300,80,0.09,0.5] }[type];
    if (!p) return;
    o.type = p[0]; o.frequency.setValueAtTime(p[1], now); o.frequency.exponentialRampToValueAtTime(p[2], now + p[4]);
    g.gain.setValueAtTime(p[3], now); g.gain.exponentialRampToValueAtTime(0.0001, now + p[4]);
    o.start(now); o.stop(now + p[4]);
  } catch (_) {}
}

// ============================================================
//  Phaser Scene
// ============================================================
class TetrisScene extends Phaser.Scene {
  constructor() { super("tetris"); }

  create() {
    // Canvases for Next and Hold previews (plain 2D, outside Phaser)
    this.nextCtx = makePreviewCanvas("nextCanvas", 4, 4);
    this.holdCtx = makePreviewCanvas("holdCanvas", 4, 4);

    this.gfx = this.add.graphics();
    this.flashGfx = this.add.graphics().setDepth(10);

    this.state = "ready";
    this.board = [];
    this.gravityTimer = null;

    // DAS (Delayed Auto-Shift) state
    this.das = { left: false, right: false, dasTimer: 0, arrTimer: 0 };
    const DAS_DELAY = 170, ARR_DELAY = 50;

    // Keyboard
    const kb = this.input.keyboard;
    kb.on("keydown-LEFT",  () => this.handleKey("left"));
    kb.on("keydown-RIGHT", () => this.handleKey("right"));
    kb.on("keydown-UP",    () => this.handleKey("rotate"));
    kb.on("keydown-DOWN",  () => this.handleKey("down"));
    kb.on("keydown-SPACE", () => this.handleKey("drop"));
    kb.on("keydown-C",     () => this.handleKey("hold"));
    kb.on("keydown-Z",     () => this.handleKey("rotateCCW"));
    kb.on("keydown-P",     () => this.togglePause());

    kb.on("keydown-LEFT",  () => { this.das.left = true; this.das.dasTimer = DAS_DELAY; });
    kb.on("keydown-RIGHT", () => { this.das.right = true; this.das.dasTimer = DAS_DELAY; });
    kb.on("keyup-LEFT",    () => { this.das.left = false; });
    kb.on("keyup-RIGHT",   () => { this.das.right = false; });

    this._DAS_DELAY = DAS_DELAY;
    this._ARR_DELAY = ARR_DELAY;

    window.__startTetris = () => this.startGame();
    window.__restartTetris = () => this.startGame();
    window.__resumeTetris = () => this.resumeGame();
  }

  startGame() {
    startScreen.hidden = true;
    overScreen.hidden = true;
    pauseScreen.hidden = true;
    this.state = "playing";
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.score = 0; this.level = 1; this.lines = 0;
    this.heldPiece = null; this.holdUsed = false;
    this.bag = []; this.nextBag = [];
    this.refillBag(); this.refillBag();
    this.current = this.spawnPiece();
    this.startGravity();
    this.render();
    updateHUD(this);
  }

  togglePause() {
    if (this.state === "playing") {
      this.state = "paused";
      if (this.gravityTimer) this.gravityTimer.paused = true;
      pauseScreen.hidden = false;
    } else if (this.state === "paused") {
      this.resumeGame();
    }
  }
  resumeGame() {
    if (this.state !== "paused") return;
    this.state = "playing";
    if (this.gravityTimer) this.gravityTimer.paused = false;
    pauseScreen.hidden = true;
  }

  // ---------- Piece management ----------
  refillBag() {
    const bag = [0,1,2,3,4,5,6];
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    if (this.bag.length === 0) this.bag = bag;
    else this.nextBag = bag;
  }
  nextPieceId() {
    if (this.bag.length === 0) { this.bag = this.nextBag; this.nextBag = []; this.refillBag(); }
    return this.bag.shift();
  }
  spawnPiece(id) {
    if (id === undefined) id = this.nextPieceId();
    return { id, rot: 0, x: 3, y: id === 0 ? -1 : 0 };
  }
  peekNext() { return this.bag.length ? this.bag[0] : this.nextBag[0]; }

  // ---------- Collision ----------
  cells(piece) {
    return PIECES[piece.id].rots[piece.rot].map(([dc, dr]) => [piece.x + dc, piece.y + dr]);
  }
  valid(piece) {
    return this.cells(piece).every(([c, r]) =>
      c >= 0 && c < COLS && r < ROWS && (r < 0 || this.board[r][c] === null)
    );
  }

  // ---------- Controls ----------
  handleKey(action) {
    if (this.state !== "playing") return;
    const p = this.current;
    if (action === "left") {
      const t = { ...p, x: p.x - 1 };
      if (this.valid(t)) { this.current = t; sfx("move"); this.render(); }
    } else if (action === "right") {
      const t = { ...p, x: p.x + 1 };
      if (this.valid(t)) { this.current = t; sfx("move"); this.render(); }
    } else if (action === "rotate") {
      this.tryRotate(1);
    } else if (action === "rotateCCW") {
      this.tryRotate(-1);
    } else if (action === "down") {
      const t = { ...p, y: p.y + 1 };
      if (this.valid(t)) { this.current = t; this.render(); }
      else this.lock();
    } else if (action === "drop") {
      while (this.valid({ ...this.current, y: this.current.y + 1 })) this.current.y++;
      sfx("drop"); this.render(); this.lock();
    } else if (action === "hold") {
      this.doHold();
    }
  }

  tryRotate(dir) {
    const p = this.current;
    const newRot = ((p.rot + dir) + 4) % 4;
    const kicks = [[0,0],[dir > 0 ? -1 : 1,0],[dir > 0 ? -1 : 1, p.id === 0 ? (newRot === 1||newRot === 3 ? -1 : 1) : -1],[0,dir > 0 ? 1 : -1],[dir > 0 ? 1 : -1,0]];
    for (const [kx, ky] of kicks) {
      const t = { ...p, rot: newRot, x: p.x + kx, y: p.y + ky };
      if (this.valid(t)) { this.current = t; sfx("rotate"); this.render(); return; }
    }
  }

  doHold() {
    if (this.holdUsed) return;
    this.holdUsed = true;
    if (this.heldPiece === null) {
      this.heldPiece = this.current.id;
      this.current = this.spawnPiece();
    } else {
      const tmp = this.heldPiece;
      this.heldPiece = this.current.id;
      this.current = this.spawnPiece(tmp);
    }
    this.render();
    drawPreview(this.holdCtx, this.heldPiece, PIECES[this.heldPiece]);
    if (this.gravityTimer) { this.gravityTimer.remove(); this.startGravity(); }
  }

  // ---------- Gravity ----------
  startGravity() {
    if (this.gravityTimer) this.gravityTimer.remove();
    this.gravityTimer = this.time.addEvent({
      delay: gravity(this.level), loop: true,
      callback: () => {
        if (this.state !== "playing") return;
        const t = { ...this.current, y: this.current.y + 1 };
        if (this.valid(t)) { this.current = t; this.render(); }
        else this.lock();
      },
    });
  }

  // ---------- Lock ----------
  lock() {
    const cells = this.cells(this.current);
    // game over — piece locked above visible area
    if (cells.every(([, r]) => r < 0)) { this.gameOver(); return; }
    for (const [c, r] of cells) {
      if (r >= 0) this.board[r][c] = this.current.id;
    }
    const cleared = this.clearLines();
    this.holdUsed = false;
    this.current = this.spawnPiece();
    // spawn collision = game over
    if (!this.valid(this.current)) { this.gameOver(); return; }
    this.startGravity();
    this.render();
    updateHUD(this);
    if (cleared === 4) sfx("tetris");
    else if (cleared > 0) sfx("clear");
  }

  clearLines() {
    let cleared = 0;
    const full = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.board[r].every((c) => c !== null)) { full.push(r); cleared++; }
    }
    if (!cleared) return 0;
    // flash then remove
    this.flashLines(full);
    for (const r of full) { this.board.splice(r, 1); this.board.unshift(Array(COLS).fill(null)); }
    this.lines += cleared;
    const newLevel = Math.floor(this.lines / LEVEL_LINES) + 1;
    if (newLevel > this.level) { this.level = newLevel; this.startGravity(); }
    this.score += LINE_SCORES[cleared] * this.level;
    if (this.score > shownBest()) refreshBest();
    return cleared;
  }

  flashLines(rows) {
    const g = this.flashGfx;
    g.clear();
    g.fillStyle(0xffffff, 0.75);
    for (const r of rows) g.fillRect(0, r * CELL, W, CELL);
    this.time.delayedCall(100, () => { g.clear(); this.render(); });
  }

  gameOver() {
    this.state = "over";
    if (this.gravityTimer) { this.gravityTimer.remove(); this.gravityTimer = null; }
    sfx("over");
    this.cameras.main.shake(220, 0.012);
    showGameOver(this.score);
  }

  // ---------- DAS update (update loop) ----------
  update(_t, delta) {
    if (this.state !== "playing") return;
    const das = this.das;
    if (das.left || das.right) {
      das.dasTimer -= delta;
      if (das.dasTimer <= 0) {
        das.arrTimer -= delta;
        if (das.arrTimer <= 0) {
          das.arrTimer = this._ARR_DELAY;
          this.handleKey(das.left ? "left" : "right");
        }
      }
    } else {
      das.arrTimer = 0;
    }
  }

  // ---------- Rendering ----------
  ghostY() {
    let y = this.current.y;
    while (this.valid({ ...this.current, y: y + 1 })) y++;
    return y;
  }

  render() {
    const g = this.gfx;
    g.clear();

    // Board background + grid lines
    g.fillStyle(0x0d1117, 1);
    g.fillRect(0, 0, W, H);
    g.lineStyle(1, 0xffffff, 0.04);
    for (let c = 1; c < COLS; c++) g.lineBetween(c * CELL, 0, c * CELL, H);
    for (let r = 1; r < ROWS; r++) g.lineBetween(0, r * CELL, W, r * CELL);

    // Locked cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.board[r][c] !== null) drawCell(g, c, r, PIECES[this.board[r][c]].color, PIECES[this.board[r][c]].dark);
      }
    }

    if (this.state === "playing" || this.state === "paused") {
      // Ghost piece
      const gy = this.ghostY();
      if (gy !== this.current.y) {
        const col = PIECES[this.current.id].color;
        for (const [dc, dr] of PIECES[this.current.id].rots[this.current.rot]) {
          const gc = this.current.x + dc, gr = gy + dr;
          if (gr >= 0) drawGhost(g, gc, gr, col);
        }
      }
      // Active piece
      for (const [dc, dr] of PIECES[this.current.id].rots[this.current.rot]) {
        const c = this.current.x + dc, r = this.current.y + dr;
        if (r >= 0) drawCell(g, c, r, PIECES[this.current.id].color, PIECES[this.current.id].dark);
      }
    }

    // Previews
    drawPreview(this.nextCtx, this.peekNext(), PIECES[this.peekNext()]);
    if (this.heldPiece !== null) drawPreview(this.holdCtx, this.heldPiece, PIECES[this.heldPiece]);
    else clearPreview(this.holdCtx);
  }
}

// ============================================================
//  Cell drawing helpers
// ============================================================
function drawCell(g, c, r, color, dark) {
  const x = c * CELL, y = r * CELL, s = CELL;
  const pad = 1.5;
  g.fillStyle(color, 1);
  g.fillRoundedRect(x + pad, y + pad, s - pad * 2, s - pad * 2, 4);
  // top-left highlight
  g.fillStyle(0xffffff, 0.22);
  g.fillRoundedRect(x + pad, y + pad, s - pad * 2, 5, 4);
  // bottom shadow
  g.fillStyle(dark, 1);
  g.fillRect(x + pad, y + s - pad - 5, s - pad * 2, 5);
}
function drawGhost(g, c, r, color) {
  const x = c * CELL, y = r * CELL, s = CELL, pad = 1.5;
  g.lineStyle(1.5, color, 0.35);
  g.strokeRoundedRect(x + pad, y + pad, s - pad * 2, s - pad * 2, 4);
}

// ============================================================
//  Preview canvases (Next / Hold)
// ============================================================
function makePreviewCanvas(parentId, cols, rows) {
  const canvas = document.createElement("canvas");
  canvas.width = cols * PREVIEW_CELL;
  canvas.height = rows * PREVIEW_CELL;
  canvas.style.display = "block";
  $(parentId).appendChild(canvas);
  return canvas.getContext("2d");
}
function drawPreview(ctx, id, piece) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  const cells = piece.rots[0];
  // center the piece
  const minC = Math.min(...cells.map(([c]) => c));
  const maxC = Math.max(...cells.map(([c]) => c));
  const minR = Math.min(...cells.map(([, r]) => r));
  const maxR = Math.max(...cells.map(([, r]) => r));
  const ox = Math.floor((4 - (maxC - minC + 1)) / 2) - minC;
  const oy = Math.floor((4 - (maxR - minR + 1)) / 2) - minR;
  const c = "#" + piece.color.toString(16).padStart(6, "0");
  const d = "#" + piece.dark.toString(16).padStart(6, "0");
  for (const [dc, dr] of cells) {
    const x = (dc + ox) * PREVIEW_CELL, y = (dr + oy) * PREVIEW_CELL, s = PREVIEW_CELL, p = 1.5;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.roundRect(x + p, y + p, s - p * 2, s - p * 2, 3); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(x + p, y + p, s - p * 2, 4);
    ctx.fillStyle = d;
    ctx.fillRect(x + p, y + s - p - 4, s - p * 2, 4);
  }
}
function clearPreview(ctx) { ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); }

// ============================================================
//  HUD + overlay glue
// ============================================================
function updateHUD(scene) {
  scoreEl.textContent = scene.score;
  levelEl.textContent = scene.level;
  linesEl.textContent = scene.lines;
  bestEl.textContent = currentUser ? Math.max(shownBest(), scene.score) : "—";
}
function showGameOver(score) {
  finalScoreEl.textContent = score;
  saveNote.className = "save-note"; saveNote.textContent = "Saving…";
  persistBest(score).then((res) => {
    refreshBest();
    if (res.status === "saved") { saveNote.classList.add("saved"); saveNote.textContent = "🏆 New high score saved!"; }
    else if (res.status === "signin") { saveNote.classList.add("signin"); saveNote.textContent = "Sign in on the home page to save scores"; }
    else if (res.status === "nobeat") { saveNote.textContent = "Good game! Beat your best to set a record."; }
    else { saveNote.textContent = "Couldn't save — check your connection."; }
  });
  overScreen.hidden = false;
}

// ============================================================
//  Boot Phaser
// ============================================================
const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: W, height: H,
  backgroundColor: "#0d1117",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: TetrisScene,
};
const game = new Phaser.Game(config);

$("startBtn").addEventListener("click", () => window.__startTetris && window.__startTetris());
$("restartBtn").addEventListener("click", () => window.__restartTetris && window.__restartTetris());
$("resumeBtn").addEventListener("click", () => window.__resumeTetris && window.__resumeTetris());

// Prevent arrow keys / space from scrolling the page
window.addEventListener("keydown", (e) => {
  if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Space"].includes(e.code)) e.preventDefault();
}, { passive: false });
