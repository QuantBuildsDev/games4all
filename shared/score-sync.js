// ============================================================
//  score-sync — submit a high score to the server-side validator
// ============================================================
//
//  Games used to write scores straight to Firestore. They now POST to
//  /api/submit-score instead, which verifies the user and validates the
//  value on the server (where it can't be tampered with). Firestore rules
//  block direct client writes to /scores, so this is the only way to save.
//
//  Usage from a game:
//      import { submitScore } from "../../shared/score-sync.js";
//      const res = await submitScore("tetris", score);
//      // res.status === "saved" | "nobeat" | "signin" | "error"
// ------------------------------------------------------------

import { auth } from "../firebase.js";

export async function submitScore(game, score) {
  const user = auth.currentUser;
  if (!user) return { status: "signin" };

  try {
    const token = await user.getIdToken();
    const resp = await fetch("/api/submit-score", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ game, score }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("submitScore rejected:", data.message || resp.status);
      return { status: "error" };
    }
    return { status: data.status || "error" };
  } catch (err) {
    console.error("submitScore failed:", err);
    return { status: "error" };
  }
}
