const BACKEND_URL = "https://imahannler.onrender.com"; // change this

const userIdInput = document.getElementById("userIdInput");
const loadBtn = document.getElementById("loadBtn");
const addBtn = document.getElementById("addBtn");
const balanceEl = document.getElementById("balance");

async function loadTokens() {
  const userId = userIdInput.value.trim();
  if (!userId) return;

  const res = await fetch(`${BACKEND_URL}/tokens/${userId}`);
  const data = await res.json();
  balanceEl.textContent = data.balance ?? 0;
}

async function addTokens() {
  const userId = userIdInput.value.trim();
  if (!userId) return;

  const res = await fetch(`${BACKEND_URL}/tokens/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, amount: 10 })
  });

  const data = await res.json();
  balanceEl.textContent = data.balance ?? 0;
}

loadBtn.addEventListener("click", loadTokens);
addBtn.addEventListener("click", addTokens);
