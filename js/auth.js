// ============================================================
// AUTH MODULE — Firebase Authentication
// ============================================================
const Auth = (() => {
  function isLoggedIn()  { return !!fbAuth.currentUser; }
  function currentUser() { return fbAuth.currentUser; }

  async function login(email, password) {
    return fbAuth.signInWithEmailAndPassword(email, password);
  }

  async function signup(email, password) {
    return fbAuth.createUserWithEmailAndPassword(email, password);
  }

  async function logout() {
    return fbAuth.signOut();
  }

  async function changePassword(currentPw, newPw) {
    const user = fbAuth.currentUser;
    if (!user) throw new Error('Non autenticato');
    const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPw);
    await user.reauthenticateWithCredential(cred);
    await user.updatePassword(newPw);
  }

  async function sendPasswordReset(email) {
    return fbAuth.sendPasswordResetEmail(email);
  }

  return { isLoggedIn, currentUser, login, signup, logout, changePassword, sendPasswordReset };
})();
