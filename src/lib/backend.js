// 保存先の抽象化。Firebase の設定があれば Firestore、なければ localStorage（ローカルモード）
// どちらも users/{uid}/{collection}/{docId} と同じ形でデータを持つ
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

export const COLLECTIONS = ['exercises', 'programs', 'sessions', 'bodyweight', 'nutrition', 'foods', 'measurements', 'settings'];

const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// undefined は Firestore に保存できないので落とす
function clean(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ---------- Firestore ----------

let app, auth, db;
if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // オフライン永続化: 電波の弱いジムでも書き込みは端末に保存され、復帰後に同期される
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
}

function firestoreBackend(uid) {
  const col = (name) => collection(db, 'users', uid, name);
  return {
    kind: 'firestore',
    subscribe(name, cb) {
      return onSnapshot(
        col(name),
        { includeMetadataChanges: false },
        (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), { fromCache: snap.metadata.fromCache }),
        (err) => console.error(`[${name}]`, err),
      );
    },
    // オフライン時は await するとサーバー応答まで解決しないため、呼び出し側は待たない
    set(name, id, data) {
      return setDoc(doc(col(name), id), clean(data)).catch((e) => console.error(e));
    },
    remove(name, id) {
      return deleteDoc(doc(col(name), id)).catch((e) => console.error(e));
    },
    async setMany(entries) {
      // entries: [[collection, id, data], ...]  500件ごとにバッチ
      for (let i = 0; i < entries.length; i += 450) {
        const batch = writeBatch(db);
        for (const [name, id, data] of entries.slice(i, i + 450)) batch.set(doc(col(name), id), clean(data));
        await batch.commit();
      }
    },
  };
}

// ---------- localStorage ----------

const LS_PREFIX = 'kintore:data:';
const listeners = {};

function lsRead(name) {
  try {
    return JSON.parse(localStorage.getItem(LS_PREFIX + name) || '{}');
  } catch {
    return {};
  }
}

function lsWrite(name, map) {
  localStorage.setItem(LS_PREFIX + name, JSON.stringify(map));
  const docs = Object.entries(map).map(([id, d]) => ({ id, ...d }));
  (listeners[name] || []).forEach((cb) => cb(docs, { fromCache: false }));
}

function localBackend() {
  return {
    kind: 'local',
    subscribe(name, cb) {
      (listeners[name] ||= []).push(cb);
      cb(Object.entries(lsRead(name)).map(([id, d]) => ({ id, ...d })), { fromCache: false });
      return () => {
        listeners[name] = listeners[name].filter((x) => x !== cb);
      };
    },
    set(name, id, data) {
      const map = lsRead(name);
      const { id: _drop, ...rest } = clean(data);
      map[id] = rest;
      lsWrite(name, map);
      return Promise.resolve();
    },
    remove(name, id) {
      const map = lsRead(name);
      delete map[id];
      lsWrite(name, map);
      return Promise.resolve();
    },
    async setMany(entries) {
      const byCol = {};
      for (const [name, id, data] of entries) {
        byCol[name] ||= lsRead(name);
        const { id: _drop, ...rest } = clean(data);
        byCol[name][id] = rest;
      }
      for (const [name, map] of Object.entries(byCol)) lsWrite(name, map);
    },
  };
}

// ---------- 認証 ----------

export function watchAuth(cb) {
  if (!isFirebaseConfigured) {
    cb({ uid: 'local', displayName: 'ローカル' });
    return () => {};
  }
  return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, displayName: u.displayName, email: u.email } : null));
}

export async function login() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // iOS のホーム画面アプリなどポップアップが使えない環境
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else {
      throw e;
    }
  }
}

export function logout() {
  return isFirebaseConfigured ? signOut(auth) : Promise.resolve();
}

export function createBackend(uid) {
  return isFirebaseConfigured ? firestoreBackend(uid) : localBackend();
}
