import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const PERMANENT_OWNER = "feqrgod";
const STARTING_TOKENS = 100;
const ROLES = ["user", "vip", "admin", "owner"];

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory user database
// Structure: { username: { passwordHash, tokens, role, isBanned } }
const users = {};

function isStaff(role) {
  return role === "admin" || role === "owner";
}

// Auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token provided" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const u = users[payload.username];
    if (u && u.isBanned) {
      return res.status(403).json({ error: "Your account has been banned." });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

function requireStaff(req, res, next) {
  const me = users[req.user.username];
  if (!me || !isStaff(me.role)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  next();
}

function requireOwner(req, res, next) {
  const me = users[req.user.username];
  if (!me || me.role !== "owner") {
    return res.status(403).json({ error: "Only the owner can perform this action" });
  }
  next();
}

// Helpers
function spend(u, amount) {
  if (amount <= 0 || u.tokens < amount) return false;
  u.tokens -= amount;
  return true;
}

function award(u, amount) {
  u.tokens += Math.round(amount);
  if (u.tokens < 0) u.tokens = 0;
}

function notEnoughTokens(res) {
  return res.status(400).json({ error: "Not enough tokens" });
}

// AUTH ENDPOINTS
app.post("/signup", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Missing username or password" });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: "Username must be 3-20 characters" });
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
  if (users[username]) return res.status(400).json({ error: "User already exists" });

  const passwordHash = await bcrypt.hash(password, 10);
  users[username] = {
    passwordHash,
    tokens: STARTING_TOKENS,
    role: username === PERMANENT_OWNER ? "owner" : "user",
    isBanned: false
  };

  res.json({ message: "Account created successfully" });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const u = users[username];
  if (!u) return res.status(401).json({ error: "Invalid username or password" });
  if (u.isBanned) return res.status(403).json({ error: "This account is banned." });

  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid username or password" });

  if (username === PERMANENT_OWNER && u.role !== "owner") {
    u.role = "owner";
  }

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, username, tokens: u.tokens, role: u.role });
});

app.get("/me", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  res.json({
    username: req.user.username,
    tokens: u.tokens,
    role: u.role
  });
});

// GAME ENDPOINTS
app.post("/game/spin", auth, (req, res) => {
  const u = users[req.user.username];
  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const win = Math.random() < 0.3;
  const payout = win ? bet * 4 : 0;
  if (win) award(u, payout);

  res.json({ win, payout, tokens: u.tokens });
});

app.post("/game/slots", auth, (req, res) => {
  const u = users[req.user.username];
  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const icons = ["cherry", "star", "gem", "seven"];
  const weights = [0.4, 0.3, 0.2, 0.1];
  function rollIcon() {
    const r = Math.random();
    let acc = 0;
    for (let i = 0; i < icons.length; i++) {
      acc += weights[i];
      if (r <= acc) return icons[i];
    }
    return icons[icons.length - 1];
  }

  const reels = [rollIcon(), rollIcon(), rollIcon()];
  let payout = 0;
  let result = "lose";

  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    result = "jackpot";
    payout = reels[0] === "seven" ? bet * 10 : bet * 4;
  } else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    result = "pair";
    payout = Math.round(bet * 1.5);
  }

  if (payout > 0) award(u, payout);
  res.json({ reels, result, payout, tokens: u.tokens });
});

app.post("/game/dice", auth, (req, res) => {
  const u = users[req.user.username];
  const { guess } = req.body || {};
  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

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
  const { guess } = req.body || {};
  if (guess !== "heads" && guess !== "tails") return res.status(400).json({ error: "Pick heads or tails" });

  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const result = Math.random() < 0.5 ? "heads" : "tails";
  const win = guess === result;
  const payout = win ? bet * 2 : 0;
  if (win) award(u, payout);

  res.json({ result, win, payout, tokens: u.tokens });
});

app.post("/game/roulette", auth, (req, res) => {
  const u = users[req.user.username];
  const { guess } = req.body || {};
  if (!["red", "black", "green"].includes(guess)) return res.status(400).json({ error: "Pick red, black, or green" });

  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const roll = Math.floor(Math.random() * 37);
  let color = roll === 0 ? "green" : (roll % 2 === 0 ? "black" : "red");

  const win = guess === color;
  const payout = win ? (color === "green" ? bet * 14 : bet * 2) : 0;
  if (win) award(u, payout);

  res.json({ roll, color, win, payout, tokens: u.tokens });
});

// NEW SERVER ENDPOINTS FOR MISSING GAMES
app.post("/game/chicken", auth, (req, res) => {
  const u = users[req.user.username];
  const bet = Math.max(1, parseInt(req.body.bet, 10) || 10);
  if (!spend(u, bet)) return notEnoughTokens(res);

  const safeLane = Math.floor(Math.random() * 3);
  const choice = parseInt(req.body.choice, 10);
  const win = choice === safeLane;
  const payout = win ? bet * 2 : 0;

  if (win) award(u, payout);
  res.json({ win, safeLane, payout, tokens: u.tokens });
});

app.post("/game/mines", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet: rawBet, action, safeHits } = req.body || {};
  const bet = Math.max(1, parseInt(rawBet, 10) || 10);

  if (action === "hitMine") {
    if (!spend(u, bet)) return notEnoughTokens(res);
    return res.json({ win: false, payout: 0, tokens: u.tokens });
  }

  if (action === "cashOut") {
    if (!spend(u, bet)) return notEnoughTokens(res);
    const mult = 1 + (parseInt(safeHits, 10) || 1) * 0.3;
    const payout = Math.round(bet * mult);
    award(u, payout);
    return res.json({ win: true, mult, payout, tokens: u.tokens });
  }

  res.status(400).json({ error: "Invalid action" });
});

app.post("/game/crash", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet: rawBet, cashedOut, mult } = req.body || {};
  const bet = Math.max(1, parseInt(rawBet, 10) || 10);

  if (!spend(u, bet)) return notEnoughTokens(res);

  let payout = 0;
  if (cashedOut && mult > 1) {
    payout = Math.round(bet * parseFloat(mult));
    award(u, payout);
  }

  res.json({ win: cashedOut, payout, tokens: u.tokens });
});

app.post("/game/plinko", auth, (req, res) => {
  const u = users[req.user.username];
  const { bet: rawBet, mult } = req.body || {};
  const bet = Math.max(1, parseInt(rawBet, 10) || 10);

  if (!spend(u, bet)) return notEnoughTokens(res);

  const multiplier = parseFloat(mult) || 0;
  const payout = Math.round(bet * multiplier);
  if (payout > 0) award(u, payout);

  res.json({ payout, tokens: u.tokens });
});

// ADMIN & OWNER ENDPOINTS
app.get("/admin/users", auth, requireStaff, (req, res) => {
  const list = Object.entries(users).map(([name, u]) => ({
    username: name,
    tokens: u.tokens,
    role: u.role,
    isBanned: !!u.isBanned
  }));
  res.json({ users: list });
});

app.post("/admin/setRole", auth, requireOwner, (req, res) => {
  const { username, role } = req.body || {};
  const u = users[username];
  if (!u) return res.status(404).json({ error: "User not found" });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
  if (username === PERMANENT_OWNER) return res.status(400).json({ error: "Cannot modify permanent owner" });

  u.role = role;
  res.json({ message: "Role updated", username, role });
});

app.post("/admin/setTokens", auth, requireStaff, (req, res) => {
  const me = users[req.user.username];
  const { username, tokens } = req.body || {};
  const u = users[username];
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.role === "owner" && me.role !== "owner") return res.status(403).json({ error: "Unauthorized" });

  const parsed = parseInt(tokens, 10);
  if (Number.isNaN(parsed) || parsed < 0) return res.status(400).json({ error: "Invalid amount" });

  u.tokens = parsed;
  res.json({ message: "Tokens updated", username, tokens: u.tokens });
});

app.post("/admin/toggleBan", auth, requireStaff, (req, res) => {
  const me = users[req.user.username];
  const { username } = req.body || {};
  const u = users[username];

  if (!u) return res.status(404).json({ error: "User not found" });
  if (username === PERMANENT_OWNER) return res.status(400).json({ error: "Cannot ban permanent owner" });
  if (u.role === "owner" && me.role !== "owner") return res.status(403).json({ error: "Unauthorized" });

  u.isBanned = !u.isBanned;
  res.json({ message: u.isBanned ? "User banned" : "User unbanned", isBanned: u.isBanned });
});

app.post("/admin/setPassword", auth, requireStaff, async (req, res) => {
  const me = users[req.user.username];
  const { username, password } = req.body || {};
  const u = users[username];
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.role === "owner" && me.role !== "owner") return res.status(403).json({ error: "Unauthorized" });
  if (!password || password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });

  u.passwordHash = await bcrypt.hash(password, 10);
  res.json({ message: "Password updated", username });
});

app.post("/admin/deleteUser", auth, requireOwner, (req, res) => {
  const { username } = req.body || {};
  if (username === PERMANENT_OWNER) return res.status(400).json({ error: "Cannot delete permanent owner" });
  if (!users[username]) return res.status(404).json({ error: "User not found" });

  delete users[username];
  res.json({ message: "User deleted", username });
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
