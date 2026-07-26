// Firebase initialization, shared across the whole site.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Firebase project config (games4all-9237d)
const firebaseConfig = {
  apiKey: "AIzaSyDNUdiuO9b_nDWAviNSSDzjqqvZiidhydw",
  authDomain: "games4all-9237d.firebaseapp.com",
  projectId: "games4all-9237d",
  storageBucket: "games4all-9237d.firebasestorage.app",
  messagingSenderId: "232089087800",
  appId: "1:232089087800:web:a5b83d469318ebf4ae9bcd",
  measurementId: "G-0KYCHZW7X9",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Keep the user signed in across tabs / reloads.
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Could not set auth persistence:", err);
});

// Lets the rest of the app warn if config is missing.
export const isConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";
