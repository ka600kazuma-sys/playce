"use client";
import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

// NEXT_PUBLIC_ の値は公開情報(ブラウザに配信される)。秘密情報は入れない。
export function clientAuth() {
  const app = getApps().length ? getApp() : initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
  const auth = getAuth(app);
  if (process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST && !(auth as unknown as { _emu?: boolean })._emu) {
    connectAuthEmulator(auth, `http://${process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
    (auth as unknown as { _emu?: boolean })._emu = true;
  }
  return auth;
}
