// ============================================================
// config/firebase.config.js — Firebase + App Configuration
// ⚠️ DO NOT COMMIT — Protected by .gitignore
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyBE9VOkEqkzHxcEtD3FV6LV07qFN5In61Y",
  authDomain: "homework-4-6bc0f.firebaseapp.com",
  projectId: "homework-4-6bc0f",
  storageBucket: "homework-4-6bc0f.firebasestorage.app",
  messagingSenderId: "222843763631",
  appId: "1:222843763631:web:8387b22fe8d6921c580d5a",
  measurementId: "G-ZN6PP965B4"
};

// Super Admin email — hardcoded, cannot be changed through UI
export const SUPER_ADMIN_EMAIL = "tm7.smc@gmail.com";

// Google Apps Script Web App URL for Google Drive file uploads
// Set this after deploying your GAS script
// GAS should handle: POST { action, fileName, mimeType, data (base64), folder }
// GAS should return: { success: true, url, fileId }
export const GAS_ENDPOINT = "https://script.google.com/macros/s/AKfycbzHigpYL93rIE5e9dMXnSf__iFhCeeEEttNfFyErvxJ-U5aVpNzmXXCC6mQklaIaUNtTg/exec"; // e.g. "https://script.google.com/macros/s/AKfycb.../exec"
