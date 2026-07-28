const BACKEND_URL = "https://imahannler.onrender.com"; // change this

let currentUser = null;

const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const balanceEl = document.getElementById("balance");
const addBtn = document.getElementById("addBtn");

async function register() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  if (!username || !password) return;

  const res = await fetch(`${BACKEND_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (data.success) {
    currentUser = username;
    await loadBalance();
  } else {
    alert(data.error || "Register failed");
  }
}

async function login() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  if (!username || !password) return;

  const res = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (data.success) {
    currentUser = username;
    await loadBalance();
  } else {
    alert(data.error || "Login failed");
  }
}

async function loadBalance() {
  if (!currentUser) return;

  const res = await fetch(`${BACKEND_URL}/tokens/${currentUser}`);
  const data = await res.json();
  balanceEl.textContent = data.balance ?? 0;
}

async function addTokens() {
  if (!currentUser) return;

  const res = await fetch(`${BACKEND_URL}/tokens/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: currentUser, amount: 10 })
  });

  const data = await res.json();
  balanceEl.textContent = data.balance ?? 0;
}

registerBtn.addEventListener("click", register);
loginBtn.addEventListener("click", login);
addBtn.addEventListener("click", addTokens);
