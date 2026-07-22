const API = "https://imahannler.onrender.com";

let token = localStorage.getItem("token") || null;
let cachedMe = null; // cached result of /me for this page load

// ---------- CORE FETCH HELPER ----------
async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;

  let res;
  try {
    res = await fetch(API + path, { ...options, headers });
  } catch (err) {
    return { error: "Can't reach the server. Check your connection." };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    data = { error: "Unexpected server response" };
  }

  if (res.status === 401) {
    // token is invalid/expired — clear it so the UI reflects reality
    logout(false);
  }

  return data;
}

// ---------- AUTH ----------
async function signup(username, password) {
  return apiFetch("/signup", { method: "POST", body: JSON.stringify({ username, password }) });
}

async function login(username, password) {
  const data = await apiFetch("/login", { method: "POST", body: JSON.stringify({ username, password }) });
  if (data.token) {
    token = data.token;
    localStorage.setItem("token", token);
    cachedMe = { username: data.username, tokens: data.tokens, role: data.role };
  }
  return data;
}

function logout(redirect = true) {
  token = null;
  cachedMe = null;
  localStorage.removeItem("token");
  if (redirect) window.location.href = "/login.html";
}

async function getMe(force = false) {
  if (!token) return null;
  if (cachedMe && !force) return cachedMe;
  const data = await apiFetch("/me");
  if (data.error) {
    cachedMe = null;
    return null;
  }
  cachedMe = data;
  return data;
}

// ---------- PAGE GUARDS ----------
// Call on any page that requires being logged in.
async function requireLogin() {
  if (!token) {
    window.location.href = "/signup.html";
    return null;
  }
  const me = await getMe(true);
  if (!me) {
    window.location.href = "/signup.html";
    return null;
  }
  return me;
}

// Call on login/signup pages: if already logged in, skip straight to home.
async function redirectIfLoggedIn() {
  if (!token) return;
  const me = await getMe(true);
  if (me) window.location.href = "/index.html";
}

// Call on the owner/admin page: kicks non-staff back to home.
async function requireStaff() {
  const me = await requireLogin();
  if (!me) return null;
  if (!["owner", "admin"].includes(me.role)) {
    window.location.href = "/index.html";
    return null;
  }
  return me;
}

// ---------- TOKEN HUD ----------
async function renderTokenBox() {
  const box = document.getElementById("tokenBox");
  if (!box) return;
  const me = await getMe();
  box.innerText = me ? `${me.tokens}` : "—";
}

function bumpTokenBox(newTotal) {
  const box = document.getElementById("tokenBox");
  if (box) box.innerText = `${newTotal}`;
  if (cachedMe) cachedMe.tokens = newTotal;
}

// ---------- GAME CALLS (server decides outcomes) ----------
async function playSpin() {
  return apiFetch("/game/spin", { method: "POST" });
}
async function playSlots() {
  return apiFetch("/game/slots", { method: "POST" });
}
async function playDice(guess) {
  return apiFetch("/game/dice", { method: "POST", body: JSON.stringify({ guess }) });
}
async function playCoinflip(guess) {
  return apiFetch("/game/coinflip", { method: "POST", body: JSON.stringify({ guess }) });
}
async function playRoulette(guess) {
  return apiFetch("/game/roulette", { method: "POST", body: JSON.stringify({ guess }) });
}
async function blackjackDeal() {
  return apiFetch("/game/blackjack/deal", { method: "POST" });
}
async function blackjackHit() {
  return apiFetch("/game/blackjack/hit", { method: "POST" });
}
async function blackjackStand() {
  return apiFetch("/game/blackjack/stand", { method: "POST" });
}

// ---------- ADMIN ----------
async function getAllUsers() {
  return apiFetch("/admin/users");
}
async function setUserRole(username, role) {
  return apiFetch("/admin/setRole", { method: "POST", body: JSON.stringify({ username, role }) });
}
async function setUserTokens(username, tokens) {
  return apiFetch("/admin/setTokens", { method: "POST", body: JSON.stringify({ username, tokens }) });
}
async function setUserPassword(username, password) {
  return apiFetch("/admin/setPassword", { method: "POST", body: JSON.stringify({ username, password }) });
}
async function deleteUser(username) {
  return apiFetch("/admin/deleteUser", { method: "POST", body: JSON.stringify({ username }) });
}

// ---------- NAV ----------
async function loadNav(path = "/nav.html") {
  const container = document.getElementById("nav");
  if (!container) return;

  const html = await fetch(path).then((r) => r.text());
  container.innerHTML = html;

  const me = token ? await getMe() : null;

  const loginLink = container.querySelector('a[href="/login.html"]');
  const signupLink = container.querySelector('a[href="/signup.html"]');
  const ownerLink = container.querySelector('a[href="/owner.html"]');
  const logoutLink = container.querySelector('a[data-action="logout"]');

  if (me) {
    // Logged in: hide login/signup, show logout
    if (loginLink) loginLink.style.display = "none";
    if (signupLink) signupLink.style.display = "none";
    if (logoutLink) logoutLink.style.display = "";
    if (ownerLink) ownerLink.style.display = ["owner", "admin"].includes(me.role) ? "" : "none";
  } else {
    // Logged out: hide logout and owner panel
    if (logoutLink) logoutLink.style.display = "none";
    if (ownerLink) ownerLink.style.display = "none";
  }

  // Highlight current page
  const here = window.location.pathname.split("/").pop() || "index.html";
  container.querySelectorAll("a").forEach((a) => {
    const target = a.getAttribute("href")?.split("/").pop();
    if (target === here) a.classList.add("active");
  });

  if (logoutLink) {
    logoutLink.addEventListener("click", (e) => {
      e.preventDefault();
      logout(true);
    });
  }
}
