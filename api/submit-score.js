// Server-side score validator (Vercel). Verifies the caller's Firebase ID
// token, validates the score, and writes via the Admin SDK. firestore.rules
// blocks direct client writes to /scores, so this is the only write path.
// Requires the FIREBASE_SERVICE_ACCOUNT env var (service-account JSON, one line).

import admin from "firebase-admin";

// Init once and reuse across warm invocations.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    ),
  });
}
const db = admin.firestore();

// Per-game sane caps, set well above any believable human result.
// Keep these in sync with firestore.rules.
const GAME_CAPS = {
  flappybird: 100000,
  game2048:   10000000,
  snake:      100000,
  racing:     100000000,
  parking:    10,        // the game only has 10 levels
  tetris:     10000000,
};
const GAME_MIN = {
  parking: 1,
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ status: "error", message: "Missing auth token" });
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch {
    return res.status(401).json({ status: "error", message: "Invalid auth token" });
  }
  const uid = decoded.uid;

  const body = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
  const { game, score } = body;

  if (!Object.prototype.hasOwnProperty.call(GAME_CAPS, game)) {
    return res.status(400).json({ status: "error", message: "Unknown game" });
  }
  if (typeof score !== "number" || !Number.isInteger(score)) {
    return res.status(400).json({ status: "error", message: "Score must be a whole number" });
  }
  const min = GAME_MIN[game] ?? 0;
  if (score < min || score > GAME_CAPS[game]) {
    return res.status(400).json({ status: "error", message: "Score out of range" });
  }

  // Resolve display name server-side so it can't be spoofed by the client.
  let displayName = decoded.name || "Player";
  try {
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists && userSnap.data().username) {
      displayName = userSnap.data().username;
    }
  } catch {
    // Non-fatal, fall back to the token's name.
  }

  // Monotonic write: only ever raise the stored best.
  const ref = db.collection("scores").doc(uid);
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.data()[game] || 0) : 0;
      if (score <= current) return "nobeat";
      tx.set(
        ref,
        {
          [game]: score,
          displayName,
          photoURL: decoded.picture || "",
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      return "saved";
    });
    return res.status(200).json({ status: result });
  } catch (err) {
    console.error("submit-score write failed:", err);
    return res.status(500).json({ status: "error", message: "Write failed" });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
