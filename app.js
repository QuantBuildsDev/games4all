// ============================================================
//  Games4All — landing page app logic (auth + username + UI)
// ============================================================

import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { auth, db, googleProvider, isConfigured } from "./firebase.js";

// ---------- Element refs ----------
const $ = (id) => document.getElementById(id);

const signInBtn    = $("signInBtn");
const userMenu     = $("userMenu");
const userMenuBtn  = $("userMenuBtn");
const userDropdown = $("userDropdown");
const signOutBtn   = $("signOutBtn");

const userAvatar   = $("userAvatar");
const userAvatarLg = $("userAvatarLg");
const userName     = $("userName");
const userNameLg   = $("userNameLg");
const userEmail    = $("userEmail");

const toastEl      = $("toast");

// ---------- Username validation ----------
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function usernameKey(uid) { return "g4a_username_" + uid; }

function getCachedUsername(uid) {
  return localStorage.getItem(usernameKey(uid)) || null;
}

// ---------- Toast helper ----------
let toastTimer;
function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.classList.toggle("toast-error", isError);
  void toastEl.offsetWidth; // force reflow
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
    setTimeout(() => (toastEl.hidden = true), 300);
  }, 3200);
}

// ---------- Auth actions ----------
async function handleSignIn() {
  if (!isConfigured) {
    toast("Firebase isn't configured yet — add your keys in firebase.js", true);
    return;
  }
  try {
    signInBtn.disabled = true;
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged handles the rest
  } catch (err) {
    console.error(err);
    if (err.code === "auth/popup-closed-by-user") {
      // silent
    } else if (err.code === "auth/unauthorized-domain") {
      toast("This domain isn't authorized in Firebase Auth settings.", true);
    } else {
      toast("Sign-in failed. Please try again.", true);
    }
  } finally {
    signInBtn.disabled = false;
  }
}

async function handleSignOut() {
  try {
    await signOut(auth);
    closeDropdown();
    toast("Signed out. See you soon!");
  } catch (err) {
    console.error(err);
    toast("Couldn't sign out. Try again.", true);
  }
}

// ---------- Auth state → UI ----------
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const photo = user.photoURL || avatarFallback(user.displayName || "P");
    userAvatar.src   = photo;
    userAvatarLg.src = photo;
    userEmail.textContent = user.email || "";

    signInBtn.hidden = true;
    userMenu.hidden  = false;

    // Resolve username (cache → Firestore → modal)
    await resolveUsername(user);
  } else {
    signInBtn.hidden = false;
    userMenu.hidden  = true;
    closeDropdown();
  }
});

// Apply a known username to the nav UI
function applyUsernameToNav(uname) {
  userName.textContent   = uname;
  userNameLg.textContent = uname;
}

// Check cache → Firestore → show modal if missing
async function resolveUsername(user) {
  const cached = getCachedUsername(user.uid);
  if (cached) {
    applyUsernameToNav(cached);
    return;
  }

  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists() && snap.data().username) {
      const uname = snap.data().username;
      localStorage.setItem(usernameKey(user.uid), uname);
      applyUsernameToNav(uname);
      return;
    }
  } catch (err) {
    console.warn("Could not fetch username from Firestore:", err);
    // Fall through to show modal
  }

  // No username found — prompt the user
  showUsernameModal(user);
}

// ---------- Username modal ----------
function showUsernameModal(user) {
  const modal  = $("usernameModal");
  const input  = $("usernameInput");
  const hint   = $("usernameHint");
  const btn    = $("usernameSubmitBtn");

  input.value = "";
  hint.textContent = "3–20 characters · letters, numbers and underscores only";
  hint.className   = "modal-hint";
  input.className  = "modal-input";
  btn.disabled     = false;
  btn.textContent  = "Save username";
  modal.hidden     = false;

  setTimeout(() => input.focus(), 80);

  // Live validation
  input.oninput = () => {
    const val = input.value.trim();
    if (!val) {
      hint.textContent = "3–20 characters · letters, numbers and underscores only";
      hint.className   = "modal-hint";
      input.className  = "modal-input";
    } else if (val.length < 3) {
      hint.textContent = "Too short — at least 3 characters required.";
      hint.className   = "modal-hint hint-error";
      input.className  = "modal-input error";
    } else if (!USERNAME_RE.test(val)) {
      hint.textContent = "Only letters, numbers and underscores are allowed.";
      hint.className   = "modal-hint hint-error";
      input.className  = "modal-input error";
    } else {
      hint.textContent = `"${val}" looks good!`;
      hint.className   = "modal-hint hint-ok";
      input.className  = "modal-input valid";
    }
  };

  // Allow Enter key
  input.onkeydown = (e) => { if (e.key === "Enter") btn.click(); };

  btn.onclick = async () => {
    const val = input.value.trim();
    if (!USERNAME_RE.test(val)) {
      hint.textContent = val.length < 3
        ? "Too short — at least 3 characters required."
        : "Only letters, numbers and underscores are allowed.";
      hint.className  = "modal-hint hint-error";
      input.className = "modal-input error";
      input.focus();
      return;
    }

    btn.disabled    = true;
    btn.textContent = "Saving…";

    try {
      await setDoc(doc(db, "users", user.uid), {
        username:  val,
        createdAt: Date.now(),
      }, { merge: true });

      localStorage.setItem(usernameKey(user.uid), val);
      applyUsernameToNav(val);
      modal.hidden = true;
      toast(`Welcome, ${val}! 🎮`);
    } catch (err) {
      console.error("Failed to save username:", err);
      hint.textContent = "Couldn't save — check your connection and try again.";
      hint.className   = "modal-hint hint-error";
      btn.disabled     = false;
      btn.textContent  = "Save username";
    }
  };
}

// Generate a fallback avatar (initials on a colored circle) as a data URI
function avatarFallback(name) {
  const letter = (name.trim()[0] || "P").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
    <rect width="64" height="64" rx="32" fill="#7c5cff"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
      font-family="Outfit, sans-serif" font-size="28" font-weight="700" fill="#fff">${letter}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// ---------- Dropdown ----------
function openDropdown()  { userDropdown.hidden = false; userMenuBtn.setAttribute("aria-expanded", "true"); }
function closeDropdown() { userDropdown.hidden = true;  userMenuBtn.setAttribute("aria-expanded", "false"); }
function toggleDropdown() { userDropdown.hidden ? openDropdown() : closeDropdown(); }

document.addEventListener("click", (e) => {
  if (!userMenu.hidden && !userMenu.contains(e.target)) closeDropdown();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDropdown();
});

// ---------- Wire up events ----------
signInBtn.addEventListener("click",   handleSignIn);
signOutBtn.addEventListener("click",  handleSignOut);
userMenuBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleDropdown(); });

// ---------- Misc UI ----------
$("year").textContent = new Date().getFullYear();

const revealEls = document.querySelectorAll(".section, .hero-stats");
revealEls.forEach((el) => el.classList.add("reveal"));
const io = new IntersectionObserver(
  (entries) => { entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); },
  { threshold: 0.12 }
);
revealEls.forEach((el) => io.observe(el));

if (!isConfigured) {
  console.warn(
    "%cGames4All: Firebase not configured yet.",
    "color:#ff5c8a;font-weight:bold",
    "\nAdd your project keys in firebase.js to enable Google sign-in."
  );
}
