// ============================================================
//  Parking Panic — Rush Hour puzzle (Phaser 3 + Kenney art + Firebase)
//  Score = highest level solved (saved under scores/{uid}.parking)
// ============================================================

import { auth, db } from "../../firebase.js";
import { showSignInRequired } from "../../shared/auth-guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { submitScore } from "../../shared/score-sync.js";

// ---------- Metrics ----------
const N = 6;                 // 6x6 grid
const SZ = 480;
const PAD = 16;
const CELL = (SZ - PAD * 2) / N;
const SCORE_FIELD = "parking";
const ASSET = (f) => "/games/parking/assets/" + f;
const ENEMY_KEYS = ["enemy_blue", "enemy_green", "enemy_black", "enemy_yellow"];

// ---------- Levels ----------
// Each vehicle: { x, y, len, dir:'h'|'v', t:true? (target) }
// Invariant for solvability: only the target sits on its exit row at cols 0..1;
// every vertical blocker on the exit row has an empty escape corridor.
// Generated + BFS-verified. Minimum solutions: 8,10,12,13,15,16,17,18,19,19 moves.
const LEVELS = [
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:5,y:0,len:2,dir:"v" }, { x:4,y:1,len:2,dir:"v" }, { x:3,y:0,len:3,dir:"v" }, { x:0,y:3,len:3,dir:"v" }, { x:1,y:0,len:2,dir:"v" }, { x:1,y:3,len:3,dir:"h" }, { x:5,y:4,len:2,dir:"v" }, { x:2,y:5,len:2,dir:"h" }, { x:1,y:4,len:2,dir:"v" }, { x:2,y:0,len:2,dir:"v" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:4,y:0,len:2,dir:"h" }, { x:1,y:0,len:2,dir:"v" }, { x:1,y:3,len:3,dir:"h" }, { x:0,y:3,len:3,dir:"v" }, { x:2,y:4,len:2,dir:"v" }, { x:4,y:1,len:3,dir:"v" }, { x:4,y:5,len:2,dir:"h" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:0,y:4,len:3,dir:"h" }, { x:4,y:2,len:2,dir:"v" }, { x:2,y:1,len:3,dir:"v" }, { x:5,y:2,len:3,dir:"v" }, { x:0,y:5,len:2,dir:"h" }, { x:2,y:5,len:3,dir:"h" }, { x:3,y:1,len:2,dir:"v" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:3,y:5,len:2,dir:"h" }, { x:3,y:1,len:2,dir:"v" }, { x:5,y:2,len:3,dir:"v" }, { x:2,y:1,len:3,dir:"v" }, { x:0,y:3,len:2,dir:"h" }, { x:4,y:1,len:2,dir:"h" }, { x:3,y:0,len:2,dir:"h" }, { x:0,y:0,len:2,dir:"h" }, { x:1,y:4,len:3,dir:"h" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:3,y:1,len:3,dir:"v" }, { x:2,y:5,len:2,dir:"h" }, { x:2,y:4,len:2,dir:"h" }, { x:1,y:3,len:2,dir:"v" }, { x:5,y:4,len:2,dir:"v" }, { x:5,y:1,len:2,dir:"v" }, { x:4,y:0,len:2,dir:"h" }, { x:4,y:4,len:2,dir:"v" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:3,y:1,len:2,dir:"h" }, { x:3,y:2,len:3,dir:"v" }, { x:3,y:5,len:2,dir:"h" }, { x:2,y:0,len:3,dir:"v" }, { x:0,y:0,len:2,dir:"h" }, { x:0,y:3,len:2,dir:"v" }, { x:1,y:3,len:2,dir:"h" }, { x:5,y:2,len:2,dir:"v" }, { x:0,y:5,len:2,dir:"h" }, { x:4,y:0,len:2,dir:"h" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:3,y:3,len:2,dir:"v" }, { x:4,y:0,len:3,dir:"v" }, { x:0,y:3,len:2,dir:"v" }, { x:1,y:4,len:2,dir:"v" }, { x:2,y:0,len:3,dir:"v" }, { x:2,y:5,len:2,dir:"h" }, { x:5,y:0,len:2,dir:"v" }, { x:1,y:3,len:2,dir:"h" }, { x:3,y:1,len:2,dir:"v" }, { x:5,y:4,len:2,dir:"v" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:3,y:1,len:2,dir:"v" }, { x:1,y:0,len:3,dir:"h" }, { x:0,y:0,len:2,dir:"v" }, { x:1,y:3,len:2,dir:"h" }, { x:3,y:3,len:2,dir:"v" }, { x:0,y:3,len:3,dir:"v" }, { x:4,y:1,len:2,dir:"h" }, { x:2,y:5,len:3,dir:"h" }, { x:2,y:1,len:2,dir:"v" }, { x:4,y:2,len:2,dir:"v" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:1,y:0,len:3,dir:"h" }, { x:5,y:3,len:3,dir:"v" }, { x:4,y:1,len:2,dir:"h" }, { x:3,y:1,len:2,dir:"v" }, { x:2,y:2,len:2,dir:"v" }, { x:4,y:2,len:3,dir:"v" }, { x:1,y:3,len:2,dir:"v" }, { x:2,y:4,len:2,dir:"h" } ],
  [ { x:0,y:2,len:2,dir:"h",t:true }, { x:2,y:2,len:2,dir:"v" }, { x:2,y:1,len:3,dir:"h" }, { x:0,y:0,len:3,dir:"h" }, { x:0,y:4,len:2,dir:"v" }, { x:2,y:4,len:2,dir:"h" }, { x:5,y:2,len:2,dir:"v" }, { x:3,y:0,len:2,dir:"h" }, { x:4,y:4,len:2,dir:"v" }, { x:3,y:2,len:2,dir:"v" }, { x:5,y:4,len:2,dir:"v" } ],
];

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const levelVal = $("levelVal");
const movesVal = $("movesVal");
const bestVal = $("bestVal");

// ---------- Best (local + cloud) — highest level solved ----------
const LS_KEY = "g4a_parking_best";
let localBest = parseInt(localStorage.getItem(LS_KEY) || "0", 10);
let cloudBest = 0;
let currentUser = null;
const shownBest = () => Math.max(localBest, cloudBest);
function refreshBest() { bestVal.textContent = currentUser ? shownBest() : "—"; }
refreshBest();

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
  const hint = $("authHint"), userBox = $("authUser");
  if (user) {
    hint.hidden = true; userBox.hidden = false;
    $("authName").textContent = localStorage.getItem("g4a_username_" + user.uid) || (user.displayName || "Player").split(" ")[0];
    $("authAvatar").src = user.photoURL || avatarFallback(user.displayName || "P");
  } else { hint.hidden = false; userBox.hidden = true; }
}
function avatarFallback(name) {
  const letter = (name.trim()[0] || "P").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#7c5cff"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Outfit" font-size="28" font-weight="700" fill="#fff">${letter}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
async function persistBest(levelNum) {
  if (levelNum > localBest) { localBest = levelNum; localStorage.setItem(LS_KEY, String(localBest)); refreshBest(); }
  if (!currentUser) return { status: "signin" };
  if (levelNum <= cloudBest) return { status: "nobeat" };
  const res = await submitScore(SCORE_FIELD, levelNum);
  if (res.status === "saved") cloudBest = levelNum;
  return res;
}

// ---------- sfx ----------
let actx;
function sfx(type) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    if (type === "move") { o.type = "sine"; o.frequency.setValueAtTime(300, now); o.frequency.exponentialRampToValueAtTime(380, now + 0.05); g.gain.setValueAtTime(0.03, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08); o.start(now); o.stop(now + 0.08); }
    else if (type === "win") { o.type = "triangle"; o.frequency.setValueAtTime(520, now); o.frequency.setValueAtTime(700, now + 0.08); o.frequency.setValueAtTime(900, now + 0.16); g.gain.setValueAtTime(0.07, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3); o.start(now); o.stop(now + 0.3); }
  } catch (_) {}
}

// ============================================================
//  Helpers (grid geometry)
// ============================================================
function centerH(x, y, len) { return { cx: PAD + (x + len / 2) * CELL, cy: PAD + (y + 0.5) * CELL }; }
function centerV(x, y, len) { return { cx: PAD + (x + 0.5) * CELL, cy: PAD + (y + len / 2) * CELL }; }

// ============================================================
//  Phaser scene
// ============================================================
class ParkingScene extends Phaser.Scene {
  constructor() { super("parking"); }

  preload() {
    this.load.image("player", ASSET("player.png"));
    ENEMY_KEYS.forEach((k) => this.load.image(k, ASSET(k + ".png")));
  }

  create() {
    this.boardGfx = this.add.graphics().setDepth(0);
    this.hlGfx = this.add.graphics().setDepth(1);

    this.vehicles = [];
    this.sel = null;
    this.solving = false;
    this.levelIndex = 0;

    this.input.on("pointerdown", (p) => this.onDown(p));
    this.input.on("pointermove", (p) => this.onMove(p));
    this.input.on("pointerup", () => this.onUp());
    // If the button is released off-canvas, still end the drag (otherwise the
    // car would keep following the mouse — the "click then click again" feel).
    this.input.on("pointerupoutside", () => this.onUp());
    this.input.on("gameout", () => this.onUp());

    window.__startParking = () => { $("startScreen").hidden = true; this.loadLevel(0); };
    window.__nextLevel = () => this.loadLevel(this.levelIndex + 1);
    window.__restartLevel = () => this.loadLevel(this.levelIndex);
    window.__replay = () => { $("allClearScreen").hidden = true; this.loadLevel(0); };
  }

  loadLevel(idx) {
    if (idx >= LEVELS.length) { showAllClear(); return; }
    $("solvedScreen").hidden = true;
    $("allClearScreen").hidden = true;
    this.solving = false;
    this.sel = null;
    this.hlGfx.clear();
    this.vehicles.forEach((v) => v.sprite.destroy());
    this.vehicles = [];

    this.levelIndex = idx;
    this.moves = 0;
    this.exitRow = LEVELS[idx][0].y; // target's row

    let ei = 0;
    LEVELS[idx].forEach((spec) => {
      const key = spec.t ? "player" : ENEMY_KEYS[ei++ % ENEMY_KEYS.length];
      const v = { x: spec.x, y: spec.y, len: spec.len, dir: spec.dir, isTarget: !!spec.t, key };
      const c = spec.dir === "h" ? centerH(v.x, v.y, v.len) : centerV(v.x, v.y, v.len);
      const sprite = this.add.image(c.cx, c.cy, key).setDepth(2);
      const carW = CELL * 0.74, carLen = v.len * CELL * 0.9;
      sprite.setDisplaySize(carW, carLen);     // local: width across, height along length
      if (v.dir === "h") sprite.setAngle(90);   // up-pointing car → points right (toward exit)
      v.sprite = sprite;
      this.vehicles.push(v);
    });

    this.drawBoard();
    levelVal.textContent = idx + 1;
    movesVal.textContent = "0";
  }

  drawBoard() {
    const g = this.boardGfx;
    g.clear();
    // panel
    g.fillStyle(0x1b2030, 1);
    g.fillRoundedRect(0, 0, SZ, SZ, 18);
    // cells
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        g.fillStyle(0x252b3d, 1);
        g.fillRoundedRect(PAD + c * CELL + 3, PAD + r * CELL + 3, CELL - 6, CELL - 6, 8);
      }
    }
    // border frame
    g.lineStyle(6, 0x394056, 1);
    g.strokeRoundedRect(PAD - 4, PAD - 4, N * CELL + 8, N * CELL + 8, 12);
    // exit gap + arrow on the right of the exit row
    const ey = PAD + (this.exitRow + 0.5) * CELL;
    g.fillStyle(0x11141f, 1);
    g.fillRect(SZ - PAD + 2, PAD + this.exitRow * CELL + 4, PAD, CELL - 8);
    g.fillStyle(0x2fe6a8, 1);
    const ax = SZ - PAD + 4;
    g.fillRect(ax - 18, ey - 4, 14, 8);
    g.fillTriangle(ax - 6, ey - 12, ax - 6, ey + 12, ax + 8, ey);
  }

  occupancy(excludeIdx) {
    const grid = Array.from({ length: N }, () => Array(N).fill(null));
    this.vehicles.forEach((v, i) => {
      if (i === excludeIdx) return;
      for (let k = 0; k < v.len; k++) {
        if (v.dir === "h") grid[v.y][v.x + k] = i;
        else grid[v.y + k][v.x] = i;
      }
    });
    return grid;
  }

  vehicleAt(px, py) {
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const left = PAD + v.x * CELL;
      const top = PAD + v.y * CELL;
      const w = (v.dir === "h" ? v.len : 1) * CELL;
      const h = (v.dir === "v" ? v.len : 1) * CELL;
      if (px >= left && px <= left + w && py >= top && py <= top + h) return i;
    }
    return -1;
  }

  range(idx) {
    const v = this.vehicles[idx];
    const occ = this.occupancy(idx);
    let min, max;
    if (v.dir === "h") {
      min = v.x; while (min - 1 >= 0 && occ[v.y][min - 1] === null) min--;
      max = v.x; while (max + v.len <= N - 1 && occ[v.y][max + v.len] === null) max++;
      const exitClear = v.isTarget && max === N - v.len;
      return { occ, min, max, exitClear };
    } else {
      min = v.y; while (min - 1 >= 0 && occ[min - 1][v.x] === null) min--;
      max = v.y; while (max + v.len <= N - 1 && occ[max + v.len][v.x] === null) max++;
      return { occ, min, max, exitClear: false };
    }
  }

  setVisualPos(v, f) {
    const c = v.dir === "h" ? centerH(f, v.y, v.len) : centerV(v.x, f, v.len);
    v.sprite.setPosition(c.cx, c.cy);
    this.drawHighlight(v, f);
  }

  drawHighlight(v, f) {
    this.hlGfx.clear();
    if (!v) return;
    let left, top, w, h;
    if (v.dir === "h") { left = PAD + f * CELL; top = PAD + v.y * CELL; w = v.len * CELL; h = CELL; }
    else { left = PAD + v.x * CELL; top = PAD + f * CELL; w = CELL; h = v.len * CELL; }
    this.hlGfx.fillStyle(v.isTarget ? 0xff7a45 : 0x21d4fd, 0.16);
    this.hlGfx.fillRoundedRect(left + 2, top + 2, w - 4, h - 4, 10);
    this.hlGfx.lineStyle(2, v.isTarget ? 0xff7a45 : 0x21d4fd, 0.7);
    this.hlGfx.strokeRoundedRect(left + 2, top + 2, w - 4, h - 4, 10);
  }

  onDown(p) {
    if (this.solving) return;
    if (!$("startScreen").hidden || !$("solvedScreen").hidden || !$("allClearScreen").hidden) return;
    const idx = this.vehicleAt(p.x, p.y);
    if (idx < 0) return;
    const r = this.range(idx);
    const v0 = this.vehicles[idx];
    const startPos = v0.dir === "h" ? v0.x : v0.y;
    // Snapshot the pointer position — the Phaser pointer object is reused/mutated,
    // so storing the reference would make the drag delta always read as 0.
    this.sel = { idx, r, start: { x: p.x, y: p.y }, startPos, float: startPos };
    this.vehicles[idx].sprite.setDepth(3);
    this.drawHighlight(this.vehicles[idx], this.sel.float);
  }

  onMove(p) {
    if (!this.sel || this.solving) return;
    // Safety net: if the mouse button isn't actually held, end the drag.
    // (Guards against a missed pointerup leaving a car "stuck" to the cursor.)
    if (!p.isDown) { this.onUp(); return; }
    const v = this.vehicles[this.sel.idx];
    const delta = (v.dir === "h" ? (p.x - this.sel.start.x) : (p.y - this.sel.start.y)) / CELL;
    let desired = this.sel.startPos + delta;
    const clamped = Phaser.Math.Clamp(desired, this.sel.r.min, this.sel.r.max);
    this.sel.float = clamped;
    this.setVisualPos(v, clamped);

    // target reaches the exit (rightmost) with a clear row → escape
    if (v.isTarget && this.sel.r.exitClear && clamped >= this.sel.r.max) {
      this.escape(v);
    }
  }

  onUp() {
    if (!this.sel || this.solving) return;
    const v = this.vehicles[this.sel.idx];
    const snapped = Phaser.Math.Clamp(Math.round(this.sel.float), this.sel.r.min, this.sel.r.max);
    const moved = snapped !== this.sel.startPos;
    if (v.dir === "h") v.x = snapped; else v.y = snapped;
    this.setVisualPos(v, snapped);
    v.sprite.setDepth(2);

    if (moved) { this.moves++; movesVal.textContent = this.moves; sfx("move"); }

    // settle highlight off
    const sel = this.sel;
    this.sel = null;
    this.hlGfx.clear();

    // win if target snapped at exit
    if (v.isTarget && sel.r.exitClear && snapped === N - v.len) this.escape(v);
  }

  escape(v) {
    if (this.solving) return;
    this.solving = true;
    this.sel = null;
    this.hlGfx.clear();
    v.sprite.setDepth(3);
    const offX = SZ + CELL * 1.5;
    this.tweens.add({ targets: v.sprite, x: offX, duration: 420, ease: "Quad.easeIn", onComplete: () => this.solved() });
  }

  solved() {
    sfx("win");
    const levelNum = this.levelIndex + 1;
    const isLast = this.levelIndex >= LEVELS.length - 1;
    showSolved(levelNum, this.moves, isLast);
  }
}

// ============================================================
//  Overlay glue
// ============================================================
function showSolved(levelNum, moves, isLast) {
  const note = $("saveNote");
  note.className = "save-note";
  note.textContent = "Saving…";
  persistBest(levelNum).then((res) => {
    refreshBest();
    if (res.status === "saved") { note.classList.add("saved"); note.textContent = "🏆 New best — level " + levelNum + " cleared!"; }
    else if (res.status === "signin") { note.classList.add("signin"); note.textContent = "Sign in on the home page to save progress"; }
    else if (res.status === "nobeat") { note.textContent = "Solved in " + moves + " moves."; }
    else if (res.status === "error") { note.textContent = "Couldn't save — check your connection."; }
  });
  $("solvedTitle").textContent = isLast ? "Final level done! 🎉" : "Solved! 🎉";
  $("solvedSub").textContent = "Cleared level " + levelNum + " in " + moves + " moves.";
  $("nextBtn").textContent = isLast ? "See results" : "Next level";
  $("solvedScreen").hidden = false;
}
function showAllClear() {
  const note = $("saveNote2");
  note.className = "save-note saved";
  note.textContent = "🏆 You cleared all " + LEVELS.length + " levels!";
  persistBest(LEVELS.length);
  refreshBest();
  $("allClearScreen").hidden = false;
}

// ============================================================
//  Boot
// ============================================================
const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: SZ, height: SZ,
  backgroundColor: "#11141f",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: ParkingScene,
};
const game = new Phaser.Game(config);

$("startBtn").addEventListener("click", () => window.__startParking && window.__startParking());
$("nextBtn").addEventListener("click", () => window.__nextLevel && window.__nextLevel());
$("restartLevelBtn").addEventListener("click", () => window.__restartLevel && window.__restartLevel());
$("replayBtn").addEventListener("click", () => window.__replay && window.__replay());
