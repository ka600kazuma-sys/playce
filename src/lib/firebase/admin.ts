import "server-only";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// エミュレータ(FIRESTORE_EMULATOR_HOST)または本番の認証情報で初期化する。秘密情報はコードに書かない。
export function db() {
  const app =
    getApps()[0] ??
    initializeApp({
      projectId: process.env.GCLOUD_PROJECT ?? "demo-playce",
      ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }),
    });
  return getFirestore(app);
}

export function adminAuth() {
  db(); // アプリを初期化
  return getAuth(getApps()[0]);
}
