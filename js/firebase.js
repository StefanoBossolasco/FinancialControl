// ── Firebase Init ────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDU_k_mp99Ollr2x2eSbDBTiPQTw1btlt0",
  authDomain: "financialcontrol-d695b.firebaseapp.com",
  projectId: "financialcontrol-d695b",
  storageBucket: "financialcontrol-d695b.firebasestorage.app",
  messagingSenderId: "53037340559",
  appId: "1:53037340559:web:743f4e08a9f942bb3c9dfa"
};

firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const fbDb   = firebase.firestore();

// Enable offline persistence for better UX
fbDb.enablePersistence({ synchronizeTabs: true })
  .catch(e => {
    if (e.code === 'failed-precondition') console.warn('Firebase persistence: multiple tabs open');
    else if (e.code === 'unimplemented') console.warn('Firebase persistence: not supported in this browser');
  });
