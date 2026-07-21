// server.js
import express from 'express';
import jwt from 'jsonwebtoken';

const app = express();
app.use(express.json());

// Fake database (you can change username/password anytime)
const users = {
  rhema: { password: "mypassword", tokens: 100, ownerUnlocked: false }
};

// Secret keys
const JWT_SECRET = "super-secret-jwt";
const OWNER_UNLOCK_CODE = "BIP-OWNER-ACCESS";

// Middleware: verify login token
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

// Login route
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const user = users[username];
  if (!user || user.password !== password) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { username },
    JWT_SECRET,
    { expiresIn: "2h" }
  );

  res.json({ token });
});

// Get balance
app.get('/balance', auth, (req, res) => {
  const user = users[req.user.username];
  res.json({ tokens: user.tokens });
});

// Spin (fake gambling)
app.post('/spin', auth, (req, res) => {
  const user = users[req.user.username];

  if (user.tokens < 10) {
    return res.status(400).json({ error: "Not enough tokens" });
  }

  user.tokens -= 10;

  const win = Math.random() < 0.3;
  const payout = win ? 50 : 0;

  user.tokens += payout;

  res.json({ win, payout, tokens: user.tokens });
});

// Promo code unlocks owner panel
app.post('/promo', auth, (req, res) => {
  const { code } = req.body;
  const user = users[req.user.username];

  if (code === OWNER_UNLOCK_CODE) {
    user.ownerUnlocked = true;
    return res.json({ message: "Owner panel unlocked!" });
  }

  res.status(400).json({ error: "Invalid promo code" });
});

// Owner panel commands
app.post('/owner/command', auth, (req, res) => {
  const user = users[req.user.username];

  if (!user.ownerUnlocked) {
    return res.status(403).json({ error: "Owner panel not unlocked" });
  }

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

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
