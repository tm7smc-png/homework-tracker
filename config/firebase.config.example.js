// ============================================================
// config/firebase.config.example.js — TEMPLATE (Safe to commit)
// Copy this file → firebase.config.js and fill in your values
// ============================================================

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
  measurementId: "YOUR_MEASUREMENT_ID"
};

// Email of the Super Admin (hardcoded, gets superadmin role automatically on first login)
export const SUPER_ADMIN_EMAIL = "your-admin@gmail.com";

// Google Apps Script Web App URL for file upload to Google Drive
// Deploy your GAS script and paste the URL here
export const GAS_ENDPOINT = "";
