import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-cyberpunk";

const PERMANENT_OWNER = "feqrgod";
const STARTING_TOKENS = 100;
const ROLES = ["user", "vip", "admin", "owner"];

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-Memory Database
const users = {};
const messages = []; // { id, username, type: 'token_request'|'bug', subject, text, requestedAmount, status: 'pending'|'approved'|'resolved', createdAt }

function isStaff(role) {
  return role === "admin" || role === "owner";
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const u = users[payload.username];
    if (u && u.isBanned) return res.status(403).json({ error: "Your account is banned." });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireStaff(req, res, next) {
  const me = users[req.user.username];
  if (!me || !isStaff(me.role)) return res.status(403).json({ error: "Access denied" });
  next();
}

// Helpers
function getValidBet(req, u) {
  const bet = parseInt(req.body.bet, 10);
  if (isNaN(bet) || bet <= 0) return { error: "Invalid bet amount" };
  if (u.tokens < bet) return { error: "Insufficient tokens" };
  return { bet };
}

function spend(u, amount) {
  if (amount <= 0 || u.tokens < amount) return false;
  u.tokens -= amount;
  return true;
}

function award(u, amount) {
  u.tokens += Math.round(amount);
  if (u.tokens < 0) u.tokens = 0;
}

// AUTH
app.post("/signup", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  if (users[username]) return res.status(400).json({ error: "Username taken" });

  const passwordHash = await bcrypt.hash(password, 10);
  users[username] = {
    passwordHash,
    tokens: STARTING_TOKENS,
    role: username === PERMANENT_OWNER ? "owner" : "user",
    isBanned: false,
    lastDaily: 0
  };

  res.json({ message: "Account created" });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const u = users[username];
  if (!u) return res.status(401).json({ error: "Invalid credentials" });
  if (u.isBanned) return res.status(403).json({ error: "Account banned" });

  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  if (username === PERMANENT_OWNER && u.role !== "owner") u.role = "owner";

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, username, tokens: u.tokens, role: u.role });
});

app.get("/me", auth, (req, res) => {
  const u = users[req.user.username];
  res.json({
    username: req.user.username,
    tokens: u.tokens,
    role: u.role,
    lastDaily: u.lastDaily || 0
  });
});

// SHOP & TOKENS
app.post("/shop/topup", auth, (req, res) => {
  const u = users[req.user.username];
  if (u.tokens >= 1000) {
    return res.status(400).json({ error: "Top-Up only available when balance is below 1,000 tokens." });
  }
  u.tokens = 1000;
  res.json({ message: "Tokens topped up to 1,000!", tokens: u.tokens });
});

app.post("/shop/daily", auth, (req, res) => {
  const u = users[req.user.username];
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000; // 24 hours

  if (u.lastDaily && now - u.lastDaily < cooldown) {
    const remainingMs = cooldown - (now - u.lastDaily);
    const hours = Math.floor(remainingMs / (1000 * 60 * 60));
    const mins = Math.ceil((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    return res.status(400).json({ error: `Daily claim on cooldown. Retry in ${hours}h ${mins}m.` });
  }

  u.lastDaily = now;
  award(u, 1000);
  res.json({ message: "Claimed 1,000 free daily tokens!", tokens: u.tokens, lastDaily: u.lastDaily });
});

// MESSAGES & REQUESTS
app.post("/messages/send", auth, (req, res) => {
  const { type, subject, messageText, requestedAmount } = req.body || {};
  if (!subject || !messageText) return res.status(400).json({ error: "Subject and message body required." });

  const msg = {
    id: "msg_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
    username: req.user.username,
    type: type === "token_request" ? "token_request" : "bug",
    subject,
    messageText,
    requestedAmount: parseInt(requestedAmount, 10) || 0,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  messages.unshift(msg);
  res.json({ message: "Message sent successfully!", msgId: msg.id });
});

app.get("/admin/messages", auth, requireStaff, (req, res) => {
  res.json({ messages });
});

app.post("/admin/messages/action", auth, requireStaff, (req, res) => {
  const { msgId, action } = req.body || {};
  const msg = messages.find((m) => m.id === msgId);
  if (!msg) return res.status(404).json({ error: "Message not found" });

  const targetUser = users[msg.username];

  if (action === "approve_tokens" && msg.type === "token_request") {
    if (targetUser && msg.requestedAmount > 0) {
      award(targetUser, msg.requestedAmount);
    }
    msg.status = "approved";
  } else if (action === "resolve") {
    msg.status = "resolved";
  } else if (action === "reject") {
    msg.status = "rejected";
  }

  res.json({ message: "Message status updated", msg });
});

// GAMES (VARIABLE BETS)
app.post("/game/spin", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet, error } = getValidBet(req, u);
  if (error) return res.status(400).json({ error });

  spend(u, bet);
  const win = Math.random() < 0.3;
  const payout = win ? bet * 4 : 0;
  if (win) award(u, payout);

  res.json({ win, payout, tokens: u.tokens });
});

app.post("/game/slots", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet, error } = getValidBet(req, u);
  if (error) return res.status(400).json({ error });

  spend(u, bet);
  const icons = ["cherry", "star", "gem", "seven"];
  const reels = [
    icons[Math.floor(Math.random() * icons.length)],
    icons[Math.floor(Math.random() * icons.length)],
    icons[Math.floor(Math.random() * icons.length)]
  ];

  let payout = 0;
  let result = "lose";

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    result = "jackpot";
    payout = reels[0] === "seven" ? bet * 10 : bet * 5;
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    result = "pair";
    payout = Math.round(bet * 1.5);
  }

  if (payout > 0) award(u, payout);
  res.json({ reels, result, payout, tokens: u.tokens });
});

app.post("/game/crash", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet, error } = getValidBet(req, u);
  if (error) return res.status(400).json({ error });

  const { cashedOut, mult } = req.body || {};
  spend(u, bet);

  let payout = 0;
  const targetMult = parseFloat(mult) || 1.0;
  if (cashedOut && targetMult >= 1.0) {
    payout = Math.round(bet * targetMult);
    award(u, payout);
  }

  res.json({ win: cashedOut, payout, tokens: u.tokens });
});

app.post("/game/dice", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet, error } = getValidBet(req, u);
  if (error) return res.status(400).json({ error });

  const { guess } = req.body;
  spend(u, bet);

  const roll = Math.floor(Math.random() * 6) + 1;
  let win = false;
  let payout = 0;

  if (guess === "over" && roll >= 4) { win = true; payout = bet * 2; }
  else if (guess === "under" && roll <= 3) { win = true; payout = bet * 2; }
  else if (Number(guess) === roll) { win = true; payout = bet * 5; }

  if (win) award(u, payout);
  res.json({ roll, win, payout, tokens: u.tokens });
});

app.post("/game/coinflip", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet, error } = getValidBet(req, u);
  if (error) return res.status(400).json({ error });

  const { guess } = req.body;
  spend(u, bet);

  const result = Math.random() < 0.5 ? "heads" : "tails";
  const win = guess === result;
  const payout = win ? bet * 2 : 0;
  if (win) award(u, payout);

  res.json({ result, win, payout, tokens: u.tokens });
});

app.post("/game/roulette", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet, error } = getValidBet(req, u);
  if (error) return res.status(400).json({ error });

  const { guess } = req.body;
  spend(u, bet);

  const roll = Math.floor(Math.random() * 37);
  let color = roll === 0 ? "green" : (roll % 2 === 0 ? "black" : "red");
  const win = guess === color;
  const payout = win ? (color === "green" ? bet * 14 : bet * 2) : 0;

  if (win) award(u, payout);
  res.json({ roll, color, win, payout, tokens: u.tokens });
});

// ADMIN USERS
app.get("/admin/users", auth, requireStaff, (req, res) => {
  const list = Object.entries(users).map(([name, u]) => ({
    username: name,
    tokens: u.tokens,
    role: u.role,
    isBanned: !!u.isBanned
  }));
  res.json({ users: list });
});

app.listen(PORT, () => console.log(`Cyberpunk Casino Server running on port ${PORT}`));
