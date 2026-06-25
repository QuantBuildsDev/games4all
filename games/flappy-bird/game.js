// ============================================================
//  Flappy Bird — Phaser 3 game + Firebase high-score saving
// ============================================================

import { auth, db } from "../../firebase.js";
import { showSignInRequired } from "../../shared/auth-guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { submitScore } from "../../shared/score-sync.js";

// ---------- Tunable game constants ----------
const WIDTH = 400;
const HEIGHT = 600;
const GRAVITY = 1400;
const FLAP_VELOCITY = -420;
const PIPE_SPEED = 200;
const PIPE_GAP = 165;          // vertical gap between pipes
const PIPE_SPACING = 1500;     // ms between pipe spawns
const PIPE_WIDTH = 64;
const GROUND_HEIGHT = 80;
const BIRD_X = 110;

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const startScreen = $("startScreen");
const gameOverScreen = $("gameOverScreen");
const liveScore = $("liveScore");
const startBtn = $("startBtn");
const restartBtn = $("restartBtn");
const finalScoreEl = $("finalScore");
const bestScoreEl = $("bestScore");
const bestStartEl = $("bestStart");
const saveNote = $("saveNote");

// ---------- Best-score state (local + cloud) ----------
const LS_KEY = "g4a_flappy_best";
let localBest = parseInt(localStorage.getItem(LS_KEY) || "0", 10);
let cloudBest = 0;
let currentUser = null;

function shownBest() {
  return Math.max(localBest, cloudBest);
}
function refreshBestLabels() {
  const val = currentUser ? shownBest() : "—";
  bestStartEl.textContent = val;
}
refreshBestLabels();

// ============================================================
//  Firebase: auth state + score persistence
// ============================================================
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  updateAuthUI(user);
  if (!user) { showSignInRequired(); return; }

  if (user) {
    try {
      const snap = await getDoc(doc(db, "scores", user.uid));
      if (snap.exists()) {
        cloudBest = snap.data().flappybird || 0;
        // If the cloud has a higher score, mirror it locally too
        if (cloudBest > localBest) {
          localBest = cloudBest;
          localStorage.setItem(LS_KEY, String(localBest));
        }
        refreshBestLabels();
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

// Save a new high score to Firestore (only if it beats the cloud best)
async function persistScore(score) {
  // Always keep local best
  if (score > localBest) {
    localBest = score;
    localStorage.setItem(LS_KEY, String(localBest));
  }

  if (!currentUser) {
    return { status: "signin" };
  }
  if (score <= cloudBest) {
    return { status: "nobeat" };
  }

  const res = await submitScore("flappybird", score);
  if (res.status === "saved") cloudBest = score;
  return res;
}

// ============================================================
//  Tiny WebAudio sound effects (no asset files)
// ============================================================
let actx;
function sfx(type) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.connect(g);
    g.connect(actx.destination);

    if (type === "flap") {
      o.type = "square";
      o.frequency.setValueAtTime(420, now);
      o.frequency.exponentialRampToValueAtTime(620, now + 0.08);
      g.gain.setValueAtTime(0.06, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      o.start(now); o.stop(now + 0.12);
    } else if (type === "score") {
      o.type = "triangle";
      o.frequency.setValueAtTime(680, now);
      o.frequency.setValueAtTime(900, now + 0.07);
      g.gain.setValueAtTime(0.07, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.start(now); o.stop(now + 0.18);
    } else if (type === "hit") {
      o.type = "sawtooth";
      o.frequency.setValueAtTime(220, now);
      o.frequency.exponentialRampToValueAtTime(60, now + 0.3);
      g.gain.setValueAtTime(0.09, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      o.start(now); o.stop(now + 0.35);
    }
  } catch (_) { /* audio not available — ignore */ }
}

// ============================================================
//  Phaser scene
// ============================================================
class FlappyScene extends Phaser.Scene {
  constructor() {
    super("flappy");
  }

  create() {
    this.gameState = "ready"; // ready | playing | dead
    this.score = 0;

    this.buildTextures();
    this.buildWorld();
    this.buildBird();

    // Pipe group
    this.pipes = this.physics.add.group({ allowGravity: false, immovable: true });
    this.pipePairs = [];

    // Input
    this.input.on("pointerdown", () => this.flap());
    this.input.keyboard.on("keydown-SPACE", () => this.flap());
    this.input.keyboard.on("keydown-UP", () => this.flap());

    // Collisions
    this.physics.add.overlap(this.bird, this.pipes, () => this.die(), null, this);

    // Pipe spawner (paused until play starts)
    this.pipeTimer = this.time.addEvent({
      delay: PIPE_SPACING,
      loop: true,
      paused: true,
      callback: () => this.spawnPipes(),
    });

    // Expose start/restart to the DOM buttons
    window.__startFlappy = () => this.startPlay();
    window.__restartFlappy = () => this.scene.restart();
  }

  // ---- Generated textures (no image files) ----
  buildTextures() {
    if (this.textures.exists("bird")) return;

    // Bird
    const b = this.make.graphics({ x: 0, y: 0, add: false });
    b.fillStyle(0xf5b400, 1);
    b.fillCircle(17, 17, 16);
    b.fillStyle(0xffe066, 1);
    b.fillCircle(13, 13, 11);
    b.fillStyle(0xffffff, 1);
    b.fillCircle(23, 12, 6);              // eye white
    b.fillStyle(0x14161f, 1);
    b.fillCircle(25, 12, 3);              // pupil
    b.fillStyle(0xff8c42, 1);
    b.fillTriangle(31, 16, 31, 24, 42, 20); // beak
    b.generateTexture("bird", 44, 36);
    b.destroy();

    // Ground (grass + dirt, tileable)
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xded895, 1);
    g.fillRect(0, 0, 32, GROUND_HEIGHT);
    g.fillStyle(0x7ec850, 1);
    g.fillRect(0, 0, 32, 14);             // grass top
    g.fillStyle(0x5fa83c, 1);
    g.fillRect(0, 12, 32, 4);
    g.fillStyle(0xc4b95a, 1);
    g.fillRect(0, 20, 16, 6);             // dirt speckle
    g.generateTexture("ground", 32, GROUND_HEIGHT);
    g.destroy();

    // Cloud
    const cl = this.make.graphics({ x: 0, y: 0, add: false });
    cl.fillStyle(0xffffff, 0.85);
    cl.fillCircle(20, 20, 18);
    cl.fillCircle(40, 22, 22);
    cl.fillCircle(62, 20, 16);
    cl.fillRect(20, 20, 42, 18);
    cl.generateTexture("cloud", 82, 40);
    cl.destroy();
  }

  buildWorld() {
    // Sky gradient via two rects
    this.add.rectangle(0, 0, WIDTH, HEIGHT, 0x4ec0ff).setOrigin(0, 0);
    this.add.rectangle(0, HEIGHT * 0.55, WIDTH, HEIGHT * 0.45, 0x8fd9ff).setOrigin(0, 0).setAlpha(0.6);

    // Drifting clouds
    this.clouds = [];
    for (let i = 0; i < 4; i++) {
      const c = this.add.image(
        Phaser.Math.Between(0, WIDTH),
        Phaser.Math.Between(40, 220),
        "cloud"
      ).setAlpha(0.8).setScale(Phaser.Math.FloatBetween(0.6, 1.2));
      c.speed = Phaser.Math.FloatBetween(8, 22);
      this.clouds.push(c);
    }

    // Scrolling ground
    this.ground = this.add.tileSprite(0, HEIGHT - GROUND_HEIGHT, WIDTH, GROUND_HEIGHT, "ground")
      .setOrigin(0, 0)
      .setDepth(20);

    // Physics floor (invisible)
    this.floor = this.add.rectangle(0, HEIGHT - GROUND_HEIGHT, WIDTH, GROUND_HEIGHT, 0x000000, 0)
      .setOrigin(0, 0);
    this.physics.add.existing(this.floor, true);
    this.floorTop = HEIGHT - GROUND_HEIGHT;
  }

  buildBird() {
    this.bird = this.physics.add.sprite(BIRD_X, HEIGHT / 2, "bird").setDepth(15);
    this.bird.body.setCircle(16, 6, 2);
    this.bird.body.allowGravity = false;
    this.bird.setCollideWorldBounds(false);

    // Idle bob before the game starts
    this.idleTween = this.tweens.add({
      targets: this.bird,
      y: HEIGHT / 2 - 14,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });
  }

  // ---- State transitions ----
  startPlay() {
    if (this.gameState === "playing") return;
    this.gameState = "playing";
    this.score = 0;
    liveScore.textContent = "0";
    liveScore.hidden = false;

    if (this.idleTween) this.idleTween.stop();
    this.bird.body.allowGravity = true;
    this.bird.body.gravity.y = GRAVITY;
    this.pipeTimer.paused = false;
    this.flap();
  }

  flap() {
    if (this.gameState === "ready") {
      // First flap also starts the game
      startScreen.hidden = true;
      this.startPlay();
      return;
    }
    if (this.gameState !== "playing") return;
    this.bird.setVelocityY(FLAP_VELOCITY);
    this.tweens.add({ targets: this.bird, angle: -22, duration: 120, ease: "Quad.out" });
    sfx("flap");
  }

  // Create one physics-backed pipe segment (rectangle) and add it to the group
  makePipe(cx, cy, w, h, color) {
    const r = this.add.rectangle(cx, cy, w, h, color);
    this.physics.add.existing(r);
    this.pipes.add(r);
    r.body.allowGravity = false;
    r.body.setVelocityX(-PIPE_SPEED); // set after group add so it isn't reset
    return r;
  }

  spawnPipes() {
    if (this.gameState !== "playing") return;

    const margin = 60;
    const minTop = margin;
    const maxTop = this.floorTop - PIPE_GAP - margin;
    const gapTop = Phaser.Math.Between(minTop, maxTop);
    const gapBottom = gapTop + PIPE_GAP;
    const startX = WIDTH + PIPE_WIDTH;

    const GREEN = 0x4caf50;
    const CAP_W = PIPE_WIDTH + 10;
    const CAP_H = 24;

    // Top pipe: spans 0 → gapTop
    const topH = gapTop;
    const top = this.makePipe(startX, topH / 2, PIPE_WIDTH, topH, GREEN);
    const topCap = this.makePipe(startX, gapTop - CAP_H / 2, CAP_W, CAP_H, GREEN);

    // Bottom pipe: spans gapBottom → floor
    const bottomH = this.floorTop - gapBottom;
    const bottom = this.makePipe(startX, gapBottom + bottomH / 2, PIPE_WIDTH, bottomH, GREEN);
    const bottomCap = this.makePipe(startX, gapBottom + CAP_H / 2, CAP_W, CAP_H, GREEN);

    // Subtle highlight strips for depth (visual only — move with pipes)
    [top, bottom].forEach((p) => {
      const hl = this.add.rectangle(p.x - PIPE_WIDTH / 2 + 8, p.y, 8, p.height, 0x69d36e);
      this.physics.add.existing(hl);
      hl.body.allowGravity = false;
      hl.body.setVelocityX(-PIPE_SPEED);
      p._hl = hl;
    });

    // Track this pair for scoring + cleanup. `lead` is the top pipe's rect.
    this.pipePairs.push({
      lead: top,
      scored: false,
      parts: [top, topCap, bottom, bottomCap, top._hl, bottom._hl],
    });
  }

  die() {
    if (this.gameState !== "playing") return;
    this.gameState = "dead";
    sfx("hit");

    this.pipeTimer.paused = true;
    this.pipes.setVelocityX(0);
    this.bird.setVelocity(0, 0);
    this.bird.body.allowGravity = true;
    this.bird.body.gravity.y = GRAVITY;
    this.bird.setVelocityY(-200); // little death hop

    // Camera shake for feedback
    this.cameras.main.shake(180, 0.012);

    liveScore.hidden = true;
    this.time.delayedCall(550, () => showGameOver(this.score));
  }

  update(_time, delta) {
    // Clouds drift always
    const dt = delta / 1000;
    for (const c of this.clouds) {
      c.x -= c.speed * dt;
      if (c.x < -50) { c.x = WIDTH + 50; c.y = Phaser.Math.Between(40, 220); }
    }

    if (this.gameState === "playing") {
      this.ground.tilePositionX += PIPE_SPEED * dt;

      // Tilt bird downward as it falls
      if (this.bird.body.velocity.y > 0) {
        this.bird.angle = Math.min(90, this.bird.angle + 180 * dt);
      }

      // Ground / ceiling collision
      if (this.bird.y + 14 >= this.floorTop) {
        this.bird.y = this.floorTop - 14;
        this.die();
      }
      if (this.bird.y < -20) this.bird.y = -20;

      // Scoring + cleanup (rectangle x is centered)
      for (const pair of this.pipePairs) {
        if (!pair.scored && pair.lead.x + PIPE_WIDTH / 2 < BIRD_X) {
          pair.scored = true;
          this.score++;
          liveScore.textContent = String(this.score);
          sfx("score");
        }
      }
      // Remove off-screen pipes
      this.pipePairs = this.pipePairs.filter((pair) => {
        if (pair.lead.x < -PIPE_WIDTH) {
          pair.parts.forEach((p) => p && p.destroy());
          return false;
        }
        return true;
      });
    }
  }
}

// ============================================================
//  Boot Phaser
// ============================================================
const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#4ec0ff",
  physics: { default: "arcade", arcade: { gravity: { y: 0 }, debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: FlappyScene,
};

const game = new Phaser.Game(config);

// ============================================================
//  DOM glue: start / restart / game-over
// ============================================================
function showGameOver(score) {
  finalScoreEl.textContent = score;
  saveNote.className = "save-note";
  saveNote.textContent = "Saving…";

  persistScore(score).then((res) => {
    bestScoreEl.textContent = currentUser ? shownBest() : "—";
    refreshBestLabels();
    if (res.status === "saved") {
      saveNote.classList.add("saved");
      saveNote.textContent = "🏆 New high score saved!";
    } else if (res.status === "signin") {
      saveNote.classList.add("signin");
      saveNote.textContent = "Sign in on the home page to save scores";
    } else if (res.status === "nobeat") {
      saveNote.textContent = "Good run! Beat your best to save a new record.";
    } else if (res.status === "error") {
      saveNote.textContent = "Couldn't save — check your connection.";
    }
  });

  gameOverScreen.hidden = false;
}

startBtn.addEventListener("click", () => {
  startScreen.hidden = true;
  if (window.__startFlappy) window.__startFlappy();
});

restartBtn.addEventListener("click", () => {
  gameOverScreen.hidden = true;
  liveScore.hidden = true;
  saveNote.textContent = "";
  bestStartEl.textContent = shownBest();
  if (window.__restartFlappy) window.__restartFlappy();
  // Scene restarts in "ready" state — show the start prompt so it's clear
  // the player needs to tap/click/Space to begin the next run.
  startScreen.hidden = false;
});

// Allow keyboard to dismiss game-over with Space/Enter → restart
document.addEventListener("keydown", (e) => {
  if (!gameOverScreen.hidden && (e.code === "Space" || e.code === "Enter")) {
    e.preventDefault();
    restartBtn.click();
  }
});

// Pause / resume with P (handled at document level so it works while paused)
document.addEventListener("keydown", (e) => {
  if (e.code !== "KeyP") return;
  const scene = game.scene.getScene("flappy");
  if (!scene || scene.gameState !== "playing") return;
  if (game.scene.isPaused("flappy")) {
    game.scene.resume("flappy");
    liveScore.classList.remove("paused");
  } else {
    game.scene.pause("flappy");
    liveScore.classList.add("paused");
  }
});
