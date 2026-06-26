# AI Deployment & Context Guide

This file is intended for future AI assistants working on this project. It contains critical context regarding deployment, security, and PWA specific requirements.

## 1. Project URLs & Deployment
- **GitHub Repository**: https://github.com/tm7smc-png/homework-tracker (Branch: `main`)
- **Live Vercel URL**: https://homework-tracker-beta-six.vercel.app/
- **Deployment Process**: The project is strictly frontend (HTML/CSS/JS) and is continuously deployed via Vercel. 
  - To deploy changes, simply commit and push to the `main` branch:
    ```bash
    git add -A
    git commit -m "Your commit message"
    git push origin main
    ```
  - Vercel will automatically trigger a build and update the live URL within 30 seconds.

## 2. Security (CRITICAL)
- **Firebase Admin SDK Key**: There is a Firebase Admin SDK JSON file in this project (`homework-4-6bc0f-firebase-adminsdk-fbsvc-cb78eda217.json`). 
  - **DO NOT** commit this file to GitHub under any circumstances.
  - It is currently ignored via `*firebase-adminsdk*.json` in `.gitignore`. Ensure this rule is strictly respected.
- **Client Firebase Config**: The `config/firebase.config.js` is required by the frontend and is intentionally committed to Git so that Vercel can build and serve it. Client keys are public by design.

## 3. PWA & Caching Caveats (Service Worker)
- **Aggressive Caching**: This app uses a Service Worker (`sw.js`). When you modify CSS, JS, HTML, or Images, you **MUST** bump the `CACHE_NAME` (e.g., from `v3` to `v4`) in `sw.js` for changes to propagate.
- **Cache Busting**: iOS and Android can be extremely stubborn with caching `manifest.json` and PWA icons. If you change the app icon or manifest, append a query string cache buster in `index.html` (e.g., `<link rel="manifest" href="manifest.json?v=2" />`) or physically rename the asset file.

## 4. Known Auth Bugs Addressed
- **Google Sign-In on PWAs**: `signInWithPopup` is known to hang on mobile PWAs if the user closes the popup without logging in. `auth.js` has been explicitly configured to use `signInWithRedirect` if the user agent is a mobile browser or PWA standalone mode.
- **Button InnerHTML Destruction**: When adding a loading state to buttons containing SVG icons or specific formatting (e.g., the Google Sign-in button), use `setButtonLoading` properly by preserving `btn._origHTML`. Do not overwrite it using `textContent`.

## 5. Firebase Auth Constraints
- If the project ever moves to a new domain, the new domain **must** be added to **Authorized domains** in the Firebase Console under `Authentication > Settings` (excluding the `https://` prefix).
