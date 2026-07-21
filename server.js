import express from "express";
import jwt from "jsonwebtoken";

const app = express();
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// In-memory user database
const users = {}; // { username: { password, tokens, ownerUnlocked } }

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
const OWNER_UNLOCK_CODE = process.env.OWNER_UNLOCK_CODE || "BIP-OWNER-ACCESS";

// Middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Not logged in" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
}

// SIGNUP
app.post("/signup", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: "Missing username or password" });

  if (users[username])
    return res.status(400).json({ error: "User already exists" });

  users[username] = {
    password,
    tokens: 100,
    ownerUnlocked: false
  };

  res.json({ message: "User created successfully" });
});

// LOGIN
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const user = users[username];
  if (!user || user.password !== password)
    return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "2h" });
  res.json({ token });
});

// BALANCE
app.get("/balance", auth, (req, res) => {
  const user = users[req.user.username];
  res.json({ tokens: user.tokens });
});

// SPIN
app.post("/spin", auth, (req, res) => {
  const user = users[req.user.username];

  if (user.tokens < 10)
    return res.status(400).json({ error: "Not enough tokens" });

  user.tokens -= 10;

  const win = Math.random() < 0.3;
  const payout = win ? 50 : 0;

  user.tokens += payout;

  res.json({ win, payout, tokens: user.tokens });
});

// PROMO
app.post("/promo", auth, (req, res) => {
  const { code } = req.body;
  const user = users[req.user.username];

  if (code === OWNER_UNLOCK_CODE) {
    user.ownerUnlocked = true;
    return res.json({ message: "Owner panel unlocked!" });
  }

  res.status(400).json({ error: "Invalid promo code" });
});

// OWNER COMMANDS
app.post("/owner/command", auth, (req, res) => {
  const user = users[req.user.username];

  if (!user.ownerUnlocked)
    return res.status(403).json({ error: "Owner panel not unlocked" });

  const { command, amount } = req.body;

  switch (command) {
    case "add_tokens":
      user.tokens += amount;
      return res.json({ message: "Tokens added", tokens: user.tokens });

    case "reset_tokens":
      user.tokens = 0;
      return res.json({ message: "Tokens reset", tokens: user.tokens });

    case "bonus":
      user.tokens += 500;
      return res.json({ message: "Bonus applied", tokens: user.tokens });

    default:
      return res.status(400).json({ error: "Unknown command" });
  }
});

// HEALTH CHECK
app.get("/", (req, res) => res.send("ok"));

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
