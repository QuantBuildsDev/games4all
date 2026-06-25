// ============================================================
//  Highway Rush — top-down racer (Phaser 3 + Kenney art + Firebase)
// ============================================================

import { auth, db } from "../../firebase.js";
import { showSignInRequired } from "../../shared/auth-guard.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { submitScore } from "../../shared/score-sync.js";

// ---------- Metrics ----------
const W = 480, H = 720;
const GRASS_W = 70;
const ROAD_L = GRASS_W;
const ROAD_R = W - GRASS_W;
const ROAD_W = ROAD_R - ROAD_L;
const LANES = 4;
const CAR_SCALE = 0.62;
const PLAYER_Y = H - 130;
const SCORE_FIELD = "racing";

const START_SPEED = 300;
const MAX_SPEED = 760;
const ACCEL = 7;
const NITRO_DURATION = 2.5;   // seconds nitro lasts
const NITRO_BOOST    = 190;   // instant speed added on collect

const ASSET = (f) => "/games/racing/assets/" + f;
const ENEMY_KEYS = ["enemy_blue", "enemy_green", "enemy_black", "enemy_yellow"];
const OBSTACLES = [
  { key: "cone",   scale: 0.7,  hit: 0.6  },
  { key: "barrel", scale: 0.75, hit: 0.75 },
  { key: "tires",  scale: 0.85, hit: 0.8  },
];

function laneX(i) { return ROAD_L + ROAD_W * (i + 0.5) / LANES; }

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const scoreVal    = $("scoreVal");
const bestVal     = $("bestVal");
const startScreen = $("startScreen");
const overScreen  = $("overScreen");
const finalScore  = $("finalScore");
const saveNote    = $("saveNote");

// ---------- Best (local + cloud) ----------
const LS_KEY = "g4a_racing_best";
let localBest = parseInt(localStorage.getItem(LS_KEY) || "0", 10);
let cloudBest = 0;
let currentUser = null;
const shownBest = () => Math.max(localBest, cloudBest);
function refreshBest() { bestVal.innerHTML = currentUser ? shownBest() + "<small>m</small>" : "—"; }
refreshBest();

// ============================================================
//  Firebase
// ============================================================
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  updateAuthUI(user);
  if (!user) { showSignInRequired(); return; }
  try {
    const snap = await getDoc(doc(db, "scores", user.uid));
    if (snap.exists()) {
      cloudBest = snap.data()[SCORE_FIELD] || 0;
      if (cloudBest > localBest) { localBest = cloudBest; localStorage.setItem(LS_KEY, String(localBest)); }
      refreshBest();
    }
  } catch (err) { console.warn("cloud best load failed", err); }
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
async function persistBest(score) {
  if (score > localBest) { localBest = score; localStorage.setItem(LS_KEY, String(localBest)); refreshBest(); }
  if (!currentUser) return { status: "signin" };
  if (score <= cloudBest) return { status: "nobeat" };
  const res = await submitScore(SCORE_FIELD, score);
  if (res.status === "saved") cloudBest = score;
  return res;
}

// ============================================================
//  sfx
// ============================================================
let actx;
function sfx(type) {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    if (type === "crash") {
      o.type = "sawtooth";
      o.frequency.setValueAtTime(180, now);
      o.frequency.exponentialRampToValueAtTime(50, now + 0.4);
      g.gain.setValueAtTime(0.12, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      o.start(now); o.stop(now + 0.5);
    } else if (type === "start") {
      o.type = "square";
      o.frequency.setValueAtTime(320, now);
      o.frequency.exponentialRampToValueAtTime(520, now + 0.15);
      g.gain.setValueAtTime(0.05, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.start(now); o.stop(now + 0.18);
    } else if (type === "nearmiss") {
      o.type = "square";
      o.frequency.setValueAtTime(480, now);
      o.frequency.exponentialRampToValueAtTime(720, now + 0.09);
      g.gain.setValueAtTime(0.055, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      o.start(now); o.stop(now + 0.13);
    } else if (type === "nitro") {
      o.type = "sawtooth";
      o.frequency.setValueAtTime(220, now);
      o.frequency.exponentialRampToValueAtTime(880, now + 0.22);
      g.gain.setValueAtTime(0.09, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      o.start(now); o.stop(now + 0.28);
    }
  } catch (_) {}
}

// ============================================================
//  Phaser scene
// ============================================================
class RacingScene extends Phaser.Scene {
  constructor() { super("racing"); }

  preload() {
    this.load.image("player", ASSET("player.png"));
    ENEMY_KEYS.forEach((k) => this.load.image(k, ASSET(k + ".png")));
    OBSTACLES.forEach((o)   => this.load.image(o.key, ASSET(o.key + ".png")));
    this.load.image("grass", ASSET("grass.png"));
    this.load.image("tree",  ASSET("tree.png"));
  }

  create() {
    // Grass
    this.grassL = this.add.tileSprite(0, 0, GRASS_W, H, "grass").setOrigin(0, 0).setDepth(0);
    this.grassR = this.add.tileSprite(ROAD_R, 0, GRASS_W, H, "grass").setOrigin(0, 0).setDepth(0);
    this.roadGfx = this.add.graphics().setDepth(1);

    // Spark texture for crash particles
    const sg = this.make.graphics({ add: false });
    sg.fillStyle(0xffffff, 1); sg.fillCircle(4, 4, 4);
    sg.generateTexture("spark", 8, 8); sg.destroy();

    // Nitro pickup texture: glowing orange/yellow orb
    const ng = this.make.graphics({ add: false });
    ng.fillStyle(0xff8c00, 0.28); ng.fillCircle(26, 26, 26);   // outer glow
    ng.fillStyle(0xffcc00, 1);    ng.fillCircle(26, 26, 18);   // main circle
    ng.fillStyle(0xfff0a0, 1);    ng.fillCircle(26, 26, 10);   // bright core
    ng.fillStyle(0xffffff, 0.7);  ng.fillCircle(22, 20,  5);   // specular
    ng.generateTexture("nitropick", 52, 52);
    ng.destroy();

    // Player
    this.player = this.add.image(laneX(1), PLAYER_Y, "player").setScale(CAR_SCALE).setDepth(5);
    this.pHalfW = this.player.displayWidth  * 0.5 * 0.66;
    this.pHalfH = this.player.displayHeight * 0.5 * 0.82;

    // Initialize before resetRun
    this.obstacles    = [];
    this.trees        = [];
    this.nitroPickups = [];

    // ---- Lane-snap keyboard ----
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys    = this.input.keyboard.addKeys("W,A,S,D");
    this.input.keyboard.on("keydown-LEFT",  () => this.changeLane(-1));
    this.input.keyboard.on("keydown-A",     () => this.changeLane(-1));
    this.input.keyboard.on("keydown-RIGHT", () => this.changeLane(1));
    this.input.keyboard.on("keydown-D",     () => this.changeLane(1));

    // ---- Drag / touch steering ----
    this.drag = null;
    this.input.on("pointerdown", (p) => {
      this.drag = { x: p.x, y: p.y, px: this.player.x, py: this.player.y };
    });
    this.input.on("pointermove", (p) => {
      if (!this.drag || this.state !== "playing") return;
      this.player.x = Phaser.Math.Clamp(this.drag.px + (p.x - this.drag.x), ROAD_L + this.pHalfW, ROAD_R - this.pHalfW);
      this.player.y = Phaser.Math.Clamp(this.drag.py + (p.y - this.drag.y), 240, H - 60);
      this.targetLane = this.nearestLane(this.player.x);
    });
    this.input.on("pointerup", () => {
      if (this.drag) this.targetLane = this.nearestLane(this.player.x);
      this.drag = null;
    });

    // ---- HUD: near-miss popup ----
    this.nearMissText = this.add.text(W / 2, H / 2, "", {
      fontFamily: '"Space Grotesk", sans-serif', fontSize: "26px", fontStyle: "700",
      color: "#ffd34e", stroke: "#111111", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(12).setAlpha(0);

    // ---- HUD: streak badge ----
    this.multiBadge = this.add.text(ROAD_R - 8, 10, "", {
      fontFamily: '"Space Grotesk", sans-serif', fontSize: "17px", fontStyle: "700",
      color: "#ff7a45", stroke: "#111111", strokeThickness: 3,
    }).setOrigin(1, 0).setDepth(12).setAlpha(0);

    // ---- HUD: nitro popup ----
    this.nitroText = this.add.text(W / 2, PLAYER_Y - 70, "", {
      fontFamily: '"Space Grotesk", sans-serif', fontSize: "30px", fontStyle: "700",
      color: "#ff9500", stroke: "#111111", strokeThickness: 5,
    }).setOrigin(0.5).setDepth(12).setAlpha(0);

    // ---- HUD: nitro bar (bottom of road) ----
    this.nitroBarBg = this.add.rectangle(ROAD_L, H - 14, ROAD_W, 10, 0x222222, 0.85)
      .setOrigin(0, 0.5).setDepth(11).setVisible(false);
    this.nitroBar   = this.add.rectangle(ROAD_L, H - 14, ROAD_W, 10, 0xff8c00)
      .setOrigin(0, 0.5).setDepth(12).setVisible(false);
    // "NITRO" label above the bar
    this.nitroBarLabel = this.add.text(ROAD_L + 6, H - 20, "⚡ NITRO", {
      fontFamily: '"Space Grotesk", sans-serif', fontSize: "13px", fontStyle: "700",
      color: "#ff9500", stroke: "#111111", strokeThickness: 3,
    }).setOrigin(0, 1).setDepth(12).setVisible(false);

    this.roadOffset = 0;
    this.state = "ready";
    this.resetRun();

    window.__startRacing = () => this.startRun();
  }

  nearestLane(x) {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < LANES; i++) {
      const d = Math.abs(laneX(i) - x);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  changeLane(dir) {
    if (this.state !== "playing") return;
    this.targetLane = Phaser.Math.Clamp(this.targetLane + dir, 0, LANES - 1);
  }

  onNearMiss() {
    sfx("nearmiss");
    this.streakMultiplier = Math.min(5, this.streakMultiplier + 1);
    this.streakTimer = 4.0;
    const bonus = 8 * this.streakMultiplier;
    this.bonusScore += bonus;

    this.tweens.killTweensOf(this.nearMissText);
    this.nearMissText.setText(`NEAR MISS!  +${bonus}m`);
    this.nearMissText.setPosition(W / 2, this.player.y - 50).setAlpha(1).setScale(1.1);
    this.tweens.add({ targets: this.nearMissText, y: this.player.y - 115, alpha: 0, scale: 1, duration: 860, ease: "Power2" });

    this.multiBadge.setText(`x${this.streakMultiplier} STREAK`).setAlpha(1).setScale(1);
    this.tweens.killTweensOf(this.multiBadge);
    this.tweens.add({ targets: this.multiBadge, scaleX: 1.3, scaleY: 1.3, duration: 100, yoyo: true, ease: "Sine.InOut" });
  }

  spawnNitro() {
    // Pick a lane that isn't already occupied by an obstacle near the top
    const freeLanes = [0, 1, 2, 3].filter(ln => {
      const x = laneX(ln);
      return !this.obstacles.some(o => Math.abs(o.img.x - x) < 20 && o.img.y < 200);
    });
    if (!freeLanes.length) return;
    const ln = Phaser.Utils.Array.GetRandom(freeLanes);
    const x  = laneX(ln);

    const img   = this.add.image(x, -50, "nitropick").setDepth(4.5);
    const label = this.add.text(x, -50, "⚡", {
      fontSize: "20px",
    }).setOrigin(0.5, 0.5).setDepth(4.6);

    // Pulsing scale animation to make it very obvious
    this.tweens.add({
      targets: [img, label],
      scaleX: 1.25, scaleY: 1.25,
      duration: 350,
      yoyo: true, repeat: -1,
      ease: "Sine.InOut",
    });

    this.nitroPickups.push({ img, label });
  }

  collectNitro(n) {
    sfx("nitro");
    this.tweens.killTweensOf(n.img);
    this.tweens.killTweensOf(n.label);
    n.img.destroy();
    n.label.destroy();
    this.nitroPickups = this.nitroPickups.filter(p => p !== n);

    // Speed boost
    this.speed         = Math.min(MAX_SPEED, this.speed + NITRO_BOOST);
    this.nitroActive   = true;
    this.nitroDuration = NITRO_DURATION;

    // Screen flash orange
    this.cameras.main.flash(120, 255, 140, 0, false);

    // Nitro popup
    this.tweens.killTweensOf(this.nitroText);
    this.nitroText.setText("⚡ NITRO!").setPosition(W / 2, this.player.y - 70).setAlpha(1).setScale(1.3);
    this.tweens.add({ targets: this.nitroText, y: this.player.y - 140, alpha: 0, scale: 1, duration: 900, ease: "Power2" });

    // Show bar
    this.nitroBarBg.setVisible(true);
    this.nitroBar.setSize(ROAD_W, 10).setVisible(true);
    this.nitroBarLabel.setVisible(true);
  }

  resetRun() {
    this.obstacles.forEach(o => o.img.destroy());
    this.trees.forEach(t => t.destroy());
    if (this.nitroPickups) this.nitroPickups.forEach(n => { n.img.destroy(); n.label.destroy(); });

    this.obstacles    = [];
    this.trees        = [];
    this.nitroPickups = [];
    this.speed        = START_SPEED;
    this.distance     = 0;
    this.spawnTimer   = 0.8;
    this.treeTimer    = 0.4;
    this.nitroTimer   = 9;    // seconds until first nitro pickup spawns

    // Lane-snap
    this.targetLane = 1;
    // Streak
    this.bonusScore       = 0;
    this.streakMultiplier = 1;
    this.streakTimer      = 0;
    // Nitro state
    this.nitroActive   = false;
    this.nitroDuration = 0;

    this.player.setPosition(laneX(1), PLAYER_Y).setAngle(0).setAlpha(1);

    if (this.nearMissText)  { this.tweens.killTweensOf(this.nearMissText);  this.nearMissText.setAlpha(0).setScale(1); }
    if (this.multiBadge)    { this.tweens.killTweensOf(this.multiBadge);    this.multiBadge.setAlpha(0).setScale(1); }
    if (this.nitroText)     { this.tweens.killTweensOf(this.nitroText);     this.nitroText.setAlpha(0).setScale(1); }
    if (this.nitroBarBg)    { this.nitroBarBg.setVisible(false); }
    if (this.nitroBar)      { this.nitroBar.setVisible(false); }
    if (this.nitroBarLabel) { this.nitroBarLabel.setVisible(false); }

    updateScore(0, true);
  }

  startRun() {
    startScreen.hidden = true;
    overScreen.hidden  = true;
    saveNote.textContent = "";
    this.resetRun();
    this.state = "playing";
    sfx("start");
  }

  spawnTree() {
    const onLeft = Math.random() < 0.5;
    const x = onLeft
      ? Phaser.Math.Between(6, GRASS_W - 28)
      : Phaser.Math.Between(ROAD_R + 28, W - 6);
    const t = this.add.image(x, -60, "tree").setScale(Phaser.Math.FloatBetween(0.4, 0.58)).setDepth(2);
    this.trees.push(t);
  }

  spawnWave() {
    const ramp     = (this.speed - START_SPEED) / (MAX_SPEED - START_SPEED);
    const maxBlock = Math.min(LANES - 1, 1 + Math.floor(ramp * 2 + 0.4));
    const blockers = Phaser.Math.Between(1, maxBlock);
    const lanes    = Phaser.Utils.Array.Shuffle([0, 1, 2, 3]).slice(0, blockers);

    for (const ln of lanes) {
      const x = laneX(ln);
      const y = -Phaser.Math.Between(60, 220);

      // Ghost-car fix: skip lane if another obstacle is already nearby at the top
      const crowded = this.obstacles.some(o => Math.abs(o.img.x - x) < 20 && o.img.y < 60);
      if (crowded) continue;

      if (Math.random() < 0.68) {
        const key = Phaser.Utils.Array.GetRandom(ENEMY_KEYS);
        const img = this.add.image(x, y, key).setScale(CAR_SCALE).setAngle(180).setDepth(4);
        this.obstacles.push({
          img, factor: Phaser.Math.FloatBetween(0.35, 0.6),
          halfW: img.displayWidth * 0.5 * 0.66, halfH: img.displayHeight * 0.5 * 0.82,
          solid: true, passed: false,
        });
      } else {
        const o   = Phaser.Utils.Array.GetRandom(OBSTACLES);
        const img = this.add.image(x, y, o.key).setScale(o.scale).setDepth(3);
        this.obstacles.push({
          img, factor: 1,
          halfW: img.displayWidth * 0.5 * o.hit, halfH: img.displayHeight * 0.5 * o.hit,
          solid: true, passed: false,
        });
      }
    }
  }

  drawRoad() {
    const g = this.roadGfx;
    g.clear();
    g.fillStyle(0x3c4049, 1);
    g.fillRect(ROAD_L, 0, ROAD_W, H);
    g.fillStyle(0xf2f2f2, 1);
    g.fillRect(ROAD_L + 4, 0, 5, H);
    g.fillRect(ROAD_R - 9, 0, 5, H);
    const dashH = 38, gap = 34, period = dashH + gap;
    const off   = this.roadOffset % period;
    g.fillStyle(0xf2c44d, 0.95);
    for (let i = 1; i < LANES; i++) {
      const lx = ROAD_L + ROAD_W * i / LANES - 3;
      for (let y = -period + off; y < H; y += period) g.fillRect(lx, y, 6, dashH);
    }
  }

  update(_t, delta) {
    const dt = Math.min(delta / 1000, 0.05);

    if (this.state === "playing") {
      this.speed    = Math.min(MAX_SPEED, this.speed + ACCEL * dt);
      this.distance += this.speed * dt;
      updateScore(Math.floor(this.distance / 28) + this.bonusScore);

      // Vertical keyboard movement
      let vy = 0;
      if (this.cursors.up.isDown   || this.keys.W.isDown) vy -= 1;
      if (this.cursors.down.isDown || this.keys.S.isDown) vy += 1;
      this.player.y = Phaser.Math.Clamp(this.player.y + vy * 340 * dt, 240, H - 60);

      // Lane-snap slide (disabled while dragging)
      if (!this.drag) {
        const targetX = laneX(this.targetLane);
        const dx      = targetX - this.player.x;
        const step    = Math.min(Math.abs(dx), 700 * dt);
        this.player.x += Math.sign(dx) * step;
        const targetAngle = dx > 0.5 ? 9 : dx < -0.5 ? -9 : 0;
        this.player.angle += (targetAngle - this.player.angle) * Math.min(1, dt * 10);
      }

      // Streak decay
      if (this.streakTimer > 0) {
        this.streakTimer -= dt;
        if (this.streakTimer <= 0) {
          this.streakMultiplier = 1;
          this.tweens.killTweensOf(this.multiBadge);
          this.tweens.add({ targets: this.multiBadge, alpha: 0, duration: 400 });
        }
      }

      // Nitro countdown + bar update
      if (this.nitroActive) {
        this.nitroDuration -= dt;
        const frac = Math.max(0, this.nitroDuration / NITRO_DURATION);
        this.nitroBar.setSize(ROAD_W * frac, 10);
        if (this.nitroDuration <= 0) {
          this.nitroActive = false;
          this.nitroBarBg.setVisible(false);
          this.nitroBar.setVisible(false);
          this.nitroBarLabel.setVisible(false);
        }
      }

      // Nitro pickup spawn timer
      this.nitroTimer -= dt;
      if (this.nitroTimer <= 0) {
        this.spawnNitro();
        this.nitroTimer = Phaser.Math.FloatBetween(9, 14);
      }

      // Spawn traffic
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnWave();
        const ramp      = (this.speed - START_SPEED) / (MAX_SPEED - START_SPEED);
        this.spawnTimer = Phaser.Math.FloatBetween(0.55, 0.95) - ramp * 0.35;
      }
      // Spawn trees
      this.treeTimer -= dt;
      if (this.treeTimer <= 0) { this.spawnTree(); this.treeTimer = Phaser.Math.FloatBetween(0.3, 0.7); }
    }

    // Scroll world
    const scroll = (this.state === "playing" ? this.speed : START_SPEED * 0.5) * dt;
    this.roadOffset       += scroll;
    this.grassL.tilePositionY -= scroll;
    this.grassR.tilePositionY -= scroll;
    this.drawRoad();

    // Move obstacles & trees
    for (const o of this.obstacles) o.img.y += this.speed * o.factor * dt;
    for (const t of this.trees)     t.y      += this.speed * dt;

    // Move nitro pickups (scroll with road)
    for (const n of this.nitroPickups) {
      n.img.y   += this.speed * dt;
      n.label.y  = n.img.y;
    }

    // Cull off-screen
    this.obstacles    = this.obstacles.filter(o    => { if (o.img.y   > H + 120) { o.img.destroy(); return false; }    return true; });
    this.trees        = this.trees.filter(t        => { if (t.y       > H + 120) { t.destroy();     return false; }    return true; });
    this.nitroPickups = this.nitroPickups.filter(n => {
      if (n.img.y > H + 80) { n.img.destroy(); n.label.destroy(); return false; }
      return true;
    });

    if (this.state === "playing") {
      // Nitro pickup collection
      for (const n of this.nitroPickups) {
        if (Math.abs(this.player.x - n.img.x) < this.pHalfW + 22 &&
            Math.abs(this.player.y - n.img.y) < this.pHalfH + 22) {
          this.collectNitro(n);
          break;
        }
      }

      // Near-miss detection
      for (const o of this.obstacles) {
        if (!o.passed && o.img.y > this.player.y + this.pHalfH) {
          o.passed = true;
          const hDist     = Math.abs(this.player.x - o.img.x);
          const hitThresh = this.pHalfW + o.halfW;
          if (hDist > hitThresh && hDist < hitThresh + 50) this.onNearMiss();
        }
      }

      // Collision detection
      for (const o of this.obstacles) {
        if (Math.abs(this.player.x - o.img.x) < this.pHalfW + o.halfW &&
            Math.abs(this.player.y - o.img.y) < this.pHalfH + o.halfH) {
          this.crash(o);
          break;
        }
      }
    }
  }

  crash(o) {
    this.state = "dead";
    sfx("crash");
    this.cameras.main.shake(260, 0.016);
    this.cameras.main.flash(120, 255, 180, 60);

    const px = (this.player.x + o.img.x) / 2;
    const py = (this.player.y + o.img.y) / 2;
    const burst = this.add.particles(px, py, "spark", {
      speed: { min: 80, max: 320 }, angle: { min: 0, max: 360 },
      scale: { start: 1.1, end: 0 }, lifespan: { min: 250, max: 600 },
      quantity: 26, tint: [0xffd34e, 0xff7a45, 0xffffff], emitting: false,
    }).setDepth(9);
    burst.explode(26);

    this.tweens.add({ targets: this.player, angle: this.player.angle + Phaser.Math.Between(-40, 40), alpha: 0.4, duration: 400 });
    this.time.delayedCall(700, () => showGameOver(Math.floor(this.distance / 28) + this.bonusScore));
  }
}

// ============================================================
//  Score + overlay glue
// ============================================================
let gameScore = 0;
function updateScore(v, reset = false) {
  gameScore = reset ? 0 : v;
  scoreVal.innerHTML = gameScore + "<small>m</small>";
  bestVal.innerHTML  = currentUser ? Math.max(shownBest(), gameScore) + "<small>m</small>" : "—";
}
function showGameOver(score) {
  finalScore.textContent = score + "m";
  saveNote.className     = "save-note";
  saveNote.textContent   = "Saving…";
  persistBest(score).then((res) => {
    refreshBest();
    if      (res.status === "saved")  { saveNote.classList.add("saved");  saveNote.textContent = "🏆 New best distance saved!"; }
    else if (res.status === "signin") { saveNote.classList.add("signin"); saveNote.textContent = "Sign in on the home page to save scores"; }
    else if (res.status === "nobeat") { saveNote.textContent = "Nice driving! Beat your best to set a record."; }
    else if (res.status === "error")  { saveNote.textContent = "Couldn't save — check your connection."; }
  });
  overScreen.hidden = false;
}

// ============================================================
//  Boot
// ============================================================
const config = {
  type: Phaser.AUTO,
  parent: "game",
  width: W, height: H,
  backgroundColor: "#3a4a32",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: RacingScene,
};
const game = new Phaser.Game(config);

$("startBtn").addEventListener("click",   () => window.__startRacing && window.__startRacing());
$("restartBtn").addEventListener("click", () => window.__startRacing && window.__startRacing());

window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
}, { passive: false });
