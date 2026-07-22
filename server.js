import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// The one permanent owner account. This username always holds the owner
// role no matter what — it can't be demoted through the admin panel.
const PERMANENT_OWNER = "feqrgod";

const STARTING_TOKENS = 100;
const ROLES = ["user", "vip", "admin", "owner"];

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory users
// Structure: { username: { passwordHash, tokens, role } }
// NOTE: this resets whenever the Render service restarts/redeploys, since
// there's no database — that's expected for this project, just flagging it.
const users = {};

function rankOf(role) {
  const idx = ROLES.indexOf(role);
  return idx === -1 ? 0 : idx;
}

function isStaff(role) {
  return role === "admin" || role === "owner";
}

// Auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
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
    return res.status(403).json({ error: "Only the owner can do this" });
  }
  next();
}

// SIGNUP
app.post("/signup", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: "Missing fields" });
  if (username.length < 3 || username.length > 20)
    return res.status(400).json({ error: "Username must be 3-20 characters" });
  if (password.length < 4)
    return res.status(400).json({ error: "Password must be at least 4 characters" });
  if (users[username])
    return res.status(400).json({ error: "User already exists" });

  const passwordHash = await bcrypt.hash(password, 10);

  users[username] = {
    passwordHash,
    tokens: STARTING_TOKENS,
    role: username === PERMANENT_OWNER ? "owner" : "user"
  };

  res.json({ message: "Account created" });
});

// LOGIN
app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const u = users[username];
  if (!u) return res.status(401).json({ error: "Invalid username or password" });

  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid username or password" });

  // Make sure the permanent owner always actually has the owner role,
  // even if something odd happened to it before.
  if (username === PERMANENT_OWNER && u.role !== "owner") {
    u.role = "owner";
  }

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, username, tokens: u.tokens, role: u.role });
});

// ME
app.get("/me", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  res.json({
    username: req.user.username,
    tokens: u.tokens,
    role: u.role
  });
});

// BALANCE
app.get("/balance", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });
  res.json({ tokens: u.tokens });
});

function spend(u, amount) {
  // Returns true if the user could afford it and it was deducted.
  if (u.tokens < amount) return false;
  u.tokens -= amount;
  return true;
}

function award(u, amount) {
  u.tokens += Math.round(amount);
  if (u.tokens < 0) u.tokens = 0;
}

// Shared "not enough tokens" responder
function notEnoughTokens(res) {
  return res.status(400).json({ error: "Not enough tokens" });
}

// ---------- GAME ENDPOINTS ----------
// All outcomes are decided server-side so the client can never just send
// an arbitrary delta to credit itself tokens.

// SPIN WHEEL — bet flat 10, ~30% chance to win 4x bet
app.post("/game/spin", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const win = Math.random() < 0.3;
  const payout = win ? bet * 4 : 0;
  if (win) award(u, payout);

  res.json({ win, payout, tokens: u.tokens });
});

// SLOTS — bet flat 10, 3 reels, jackpot on triple match (4x), any pair (1.5x)
app.post("/game/slots", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const icons = ["cherry", "star", "gem", "seven"];
  const weights = [0.4, 0.3, 0.2, 0.1]; // seven is rarest
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

// BLACKJACK — server holds authoritative deck/hands per user
const blackjackGames = {};

function newDeck() {
  const values = [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 11];
  let deck = [];
  for (let i = 0; i < 4; i++) deck = deck.concat(values);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function handTotal(hand) {
  let sum = hand.reduce((a, b) => a + b, 0);
  let aces = hand.filter((v) => v === 11).length;
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces--;
  }
  return sum;
}

app.post("/game/blackjack/deal", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const deck = newDeck();
  const player = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];

  blackjackGames[req.user.username] = { deck, player, dealer, bet, done: false };

  const playerTotal = handTotal(player);
  const blackjack = playerTotal === 21;

  if (blackjack) {
    const payout = Math.round(bet * 2.5);
    award(u, payout);
    blackjackGames[req.user.username].done = true;
    return res.json({
      player, dealer, playerTotal, dealerTotal: handTotal(dealer),
      status: "blackjack", payout, tokens: u.tokens
    });
  }

  res.json({
    player,
    dealerUpcard: dealer[0],
    playerTotal,
    status: "in-progress",
    tokens: u.tokens
  });
});

app.post("/game/blackjack/hit", auth, (req, res) => {
  const u = users[req.user.username];
  const game = blackjackGames[req.user.username];
  if (!u || !game || game.done) return res.status(400).json({ error: "No active hand" });

  game.player.push(game.deck.pop());
  const playerTotal = handTotal(game.player);

  if (playerTotal > 21) {
    game.done = true;
    return res.json({
      player: game.player, dealer: game.dealer, playerTotal,
      dealerTotal: handTotal(game.dealer), status: "bust", tokens: u.tokens
    });
  }

  res.json({ player: game.player, playerTotal, status: "in-progress", tokens: u.tokens });
});

app.post("/game/blackjack/stand", auth, (req, res) => {
  const u = users[req.user.username];
  const game = blackjackGames[req.user.username];
  if (!u || !game || game.done) return res.status(400).json({ error: "No active hand" });

  while (handTotal(game.dealer) < 17) game.dealer.push(game.deck.pop());

  const playerTotal = handTotal(game.player);
  const dealerTotal = handTotal(game.dealer);
  let status, payout;

  if (dealerTotal > 21 || playerTotal > dealerTotal) {
    status = "win";
    payout = game.bet * 2;
  } else if (playerTotal < dealerTotal) {
    status = "lose";
    payout = 0;
  } else {
    status = "push";
    payout = game.bet;
  }

  if (payout > 0) award(u, payout);
  game.done = true;

  res.json({ player: game.player, dealer: game.dealer, playerTotal, dealerTotal, status, payout, tokens: u.tokens });
});

// DICE — pick a number 1-6, guess over/under, bet flat 10
app.post("/game/dice", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  const { guess } = req.body || {}; // "over" | "under" | number 1-6 for exact
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

// COINFLIP — pick heads/tails, bet flat 10, 2x payout
app.post("/game/coinflip", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  const { guess } = req.body || {}; // "heads" | "tails"
  if (guess !== "heads" && guess !== "tails")
    return res.status(400).json({ error: "Pick heads or tails" });

  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const result = Math.random() < 0.5 ? "heads" : "tails";
  const win = guess === result;
  const payout = win ? bet * 2 : 0;
  if (win) award(u, payout);

  res.json({ result, win, payout, tokens: u.tokens });
});

// ROULETTE — bet on red/black/green, flat bet 10
app.post("/game/roulette", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  const { guess } = req.body || {}; // "red" | "black" | "green"
  if (!["red", "black", "green"].includes(guess))
    return res.status(400).json({ error: "Pick red, black, or green" });

  const bet = 10;
  if (!spend(u, bet)) return notEnoughTokens(res);

  const roll = Math.floor(Math.random() * 37); // 0-36, European wheel style
  let color;
  if (roll === 0) color = "green";
  else color = roll % 2 === 0 ? "black" : "red";

  const win = guess === color;
  const payout = win ? (color === "green" ? bet * 14 : bet * 2) : 0;
  if (win) award(u, payout);

  res.json({ roll, color, win, payout, tokens: u.tokens });
});

// ---------- ADMIN / OWNER ----------

// List users (no password hashes ever sent to the client)
app.get("/admin/users", auth, requireStaff, (req, res) => {
  const list = Object.entries(users).map(([name, u]) => ({
    username: name,
    tokens: u.tokens,
    role: u.role
  }));
  res.json({ users: list });
});

// Set role — only owner, and the permanent owner account can't be demoted
app.post("/admin/setRole", auth, requireOwner, (req, res) => {
  const { username, role } = req.body || {};
  const u = users[username];
  if (!u) return res.status(404).json({ error: "User not found" });
  if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
  if (username === PERMANENT_OWNER)
    return res.status(400).json({ error: `${PERMANENT_OWNER} is the permanent owner and can't be changed` });

  u.role = role;
  res.json({ message: "Role updated", username, role });
});

// Set tokens — admins and owner. Admins can't touch owner's tokens.
app.post("/admin/setTokens", auth, requireStaff, (req, res) => {
  const me = users[req.user.username];
  const { username, tokens } = req.body || {};
  const u = users[username];
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.role === "owner" && me.role !== "owner")
    return res.status(403).json({ error: "Only the owner can edit the owner's tokens" });

  const parsed = parseInt(tokens, 10);
  if (Number.isNaN(parsed) || parsed < 0)
    return res.status(400).json({ error: "Tokens must be a non-negative number" });

  u.tokens = parsed;
  res.json({ message: "Tokens updated", username, tokens: u.tokens });
});

// Reset a user's password — admins and owner. Admins can't touch owner's password.
app.post("/admin/setPassword", auth, requireStaff, async (req, res) => {
  const me = users[req.user.username];
  const { username, password } = req.body || {};
  const u = users[username];
  if (!u) return res.status(404).json({ error: "User not found" });
  if (u.role === "owner" && me.role !== "owner")
    return res.status(403).json({ error: "Only the owner can reset the owner's password" });
  if (!password || password.length < 4)
    return res.status(400).json({ error: "Password must be at least 4 characters" });

  u.passwordHash = await bcrypt.hash(password, 10);
  res.json({ message: "Password updated", username });
});

// Delete a user — owner only, can't delete self/permanent owner
app.post("/admin/deleteUser", auth, requireOwner, (req, res) => {
  const { username } = req.body || {};
  if (username === PERMANENT_OWNER)
    return res.status(400).json({ error: "Can't delete the permanent owner" });
  if (!users[username]) return res.status(404).json({ error: "User not found" });

  delete users[username];
  delete blackjackGames[username];
  res.json({ message: "User deleted", username });
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
