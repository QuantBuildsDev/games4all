import { auth, googleProvider } from "../firebase.js";
import { signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export function showSignInRequired() {
  const wrap = document.createElement("div");
  wrap.style.cssText = [
    "position:fixed", "inset:0", "z-index:9999",
    "background:rgba(8,9,18,0.97)", "backdrop-filter:blur(12px)",
    "-webkit-backdrop-filter:blur(12px)",
    "display:flex", "align-items:center", "justify-content:center",
    "font-family:'Outfit',sans-serif",
  ].join(";");

  wrap.innerHTML = `
    <div style="text-align:center;max-width:380px;padding:2.5rem 2rem;color:#fff;">
      <div style="font-size:3.5rem;margin-bottom:1rem;line-height:1">🎮</div>

      <h2 style="font-size:1.75rem;font-weight:800;margin:0 0 0.5rem;letter-spacing:-0.02em">
        You're one step away!
      </h2>

      <p style="color:rgba(255,255,255,0.55);font-size:0.95rem;line-height:1.65;margin:0 0 2rem">
        Sign in with Google to unlock all games, save your high scores,
        and compete on the leaderboard — it only takes a second.
      </p>

      <button id="guardGoogleBtn" style="
        display:inline-flex;align-items:center;gap:0.65rem;
        background:#ffffff;color:#111827;border:none;cursor:pointer;
        font-family:'Outfit',sans-serif;font-size:0.97rem;font-weight:700;
        padding:0.82rem 1.6rem;border-radius:12px;
        box-shadow:0 4px 24px rgba(0,0,0,0.35);
        transition:transform .15s,box-shadow .15s,opacity .15s;
        width:100%;justify-content:center;
      ">
        <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
        </svg>
        <span id="guardGoogleLabel">Sign in with Google</span>
      </button>

      <p id="guardError" style="
        display:none;margin:0.9rem 0 0;font-size:0.85rem;color:#ff4d6d;
      "></p>

      <p style="margin:1.4rem 0 0;font-size:0.8rem;color:rgba(255,255,255,0.28)">
        Free forever · No password needed
      </p>

      <a href="/index.html" style="
        display:inline-block;margin-top:1.2rem;
        font-size:0.85rem;color:rgba(255,255,255,0.38);text-decoration:none;
        transition:color .15s;
      "
      onmouseover="this.style.color='rgba(255,255,255,0.7)'"
      onmouseout="this.style.color='rgba(255,255,255,0.38)'"
      >← Back to home</a>
    </div>
  `;

  document.body.appendChild(wrap);

  const btn   = wrap.querySelector("#guardGoogleBtn");
  const label = wrap.querySelector("#guardGoogleLabel");
  const err   = wrap.querySelector("#guardError");

  btn.addEventListener("mouseenter", () => {
    if (!btn.disabled) { btn.style.transform = "translateY(-2px)"; btn.style.boxShadow = "0 8px 32px rgba(0,0,0,0.45)"; }
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = ""; btn.style.boxShadow = "0 4px 24px rgba(0,0,0,0.35)";
  });

  btn.addEventListener("click", async () => {
    btn.disabled    = true;
    btn.style.opacity = "0.65";
    label.textContent = "Opening sign-in…";
    err.style.display = "none";

    try {
      await signInWithPopup(auth, googleProvider);
      // Auth state change fires → reload so the game initialises with the new user
      window.location.reload();
    } catch (e) {
      btn.disabled      = false;
      btn.style.opacity = "1";
      label.textContent = "Sign in with Google";

      if (e.code !== "auth/popup-closed-by-user") {
        err.style.display = "block";
        err.textContent   = e.code === "auth/unauthorized-domain"
          ? "This domain isn't authorised in Firebase — check your Auth settings."
          : "Sign-in failed. Please try again.";
      }
    }
  });
}
