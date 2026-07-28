import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// CORS
app.use(
  cors({
    origin: "*", // later restrict to your InfinityFree domain
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json());

// Data file
const dataFilePath = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(__dirname, "data", "users.json");

const dataDir = path.dirname(dataFilePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readUsers() {
  try {
    if (!fs.existsSync(dataFilePath)) {
      fs.writeFileSync(dataFilePath, JSON.stringify({ users: [] }, null, 2));
    }
    const raw = fs.readFileSync(dataFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.users || [];
  } catch (err) {
    console.error("Error reading users:", err);
    return [];
  }
}

function writeUsers(users) {
  try {
    fs.writeFileSync(
      dataFilePath,
      JSON.stringify({ users }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("Error writing users:", err);
  }
}

function findUser(username) {
  const users = readUsers();
  return users.find((u) => u.username === username);
}

function upsertUser(user) {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === user.username);
  if (idx === -1) {
    users.push(user);
  } else {
    users[idx] = user;
  }
  writeUsers(users);
}

function isValidUsername(username) {
  return (
    typeof username === "string" &&
    username.length >= 3 &&
    username.length <= 20 &&
    /^[a-zA-Z0-9_]+$/.test(username)
  );
}

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Gambling backend running" });
});

// Owner login
app.post("/owner-login", (req, res) => {
  const { username } = req.body;

  if (!username || !isValidUsername(username)) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid username. Use 3–20 characters, letters/numbers/underscore only."
    });
  }

  const ownerUsername = process.env.OWNER_USERNAME;
  if (!ownerUsername) {
    return res.status(500).json({
      success: false,
      message: "Server configuration error: owner username not set."
    });
  }

  if (username === ownerUsername) {
    return res.json({
      success: true,
      message: "Owner access granted.",
      token: "owner-" + username
    });
  }

  return res.status(401).json({
    success: false,
    message: "Access denied: invalid owner username."
  });
});

// Owner panel
app.get("/owner-panel", (req, res) => {
  const { username } = req.query;
  const ownerUsername = process.env.OWNER_USERNAME;

  if (!username || !isValidUsername(username)) {
    return res.status(400).json({
      success: false,
      message: "Valid username query parameter is required."
    });
  }

  if (username !== ownerUsername) {
    return res.status(403).json({
      success: false,
      message: "Forbidden: only the owner can access this route."
    });
  }

  const users = readUsers();
  const totalUsers = users.length;
  const totalTokens = users.reduce((sum, u) => sum + (u.tokens || 0), 0);

  return res.json({
    success: true,
    message: "Owner panel data fetched successfully.",
    data: {
      totalUsers,
      totalTokens,
      siteBalance: totalTokens,
      controls: [
        "Toggle maintenance mode",
        "Adjust house edge",
        "View recent bets",
        "Ban user (mock)"
      ]
    }
  });
});

// User register
app.post("/user/register", (req, res) => {
  const { username } = req.body;

  if (!username || !isValidUsername(username)) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid username. Use 3–20 characters, letters/numbers/underscore only."
    });
  }

  const existing = findUser(username);
  if (existing) {
    return res.status(409).json({
      success: false,
      message: "Username already exists."
    });
  }

  const newUser = {
    username,
    tokens: 1000
  };

  upsertUser(newUser);

  return res.json({
    success: true,
    message: "User registered successfully.",
    user: newUser
  });
});

// User login
app.post("/user/login", (req, res) => {
  const { username } = req.body;

  if (!username || !isValidUsername(username)) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid username. Use 3–20 characters, letters/numbers/underscore only."
    });
  }

  const user = findUser(username);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found. Please register first."
    });
  }

  return res.json({
    success: true,
    message: "Login successful.",
    user
  });
});

// Get tokens
app.get("/user/tokens", (req, res) => {
  const { username } = req.query;

  if (!username || !isValidUsername(username)) {
    return res.status(400).json({
      success: false,
      message: "Valid username query parameter is required."
    });
  }

  const user = findUser(username);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found."
    });
  }

  return res.json({
    success: true,
    tokens: user.tokens
  });
});

// Bet
app.post("/user/bet", (req, res) => {
  const { username, amount } = req.body;

  if (!username || !isValidUsername(username)) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid username. Use 3–20 characters, letters/numbers/underscore only."
    });
  }

  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Bet amount must be a positive number."
    });
  }

  const user = findUser(username);
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found."
    });
  }

  if (amount > user.tokens) {
    return res.status(400).json({
      success: false,
      message: "Insufficient tokens for this bet."
    });
  }

  const win = Math.random() < 0.5;
  if (win) {
    user.tokens += amount;
  } else {
    user.tokens -= amount;
  }

  upsertUser(user);

  return res.json({
    success: true,
    result: win ? "win" : "lose",
    tokens: user.tokens,
    message: win
      ? `You won ${amount} tokens!`
      : `You lost ${amount} tokens. Better luck next time.`
  });
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
