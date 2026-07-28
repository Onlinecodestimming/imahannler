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

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  })
);

app.use(express.json());

// JSON file path
const dataFilePath = path.resolve(process.env.DATA_FILE);

// Read users
function readUsers() {
  try {
    const raw = fs.readFileSync(dataFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.users || [];
  } catch (err) {
    console.error("Error reading users:", err);
    return [];
  }
}

// Write users
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
  return readUsers().find((u) => u.username === username);
}

function upsertUser(user) {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === user.username);
  if (idx === -1) users.push(user);
  else users[idx] = user;
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

// Routes

app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// Owner login
app.post("/owner-login", (req, res) => {
  const { username } = req.body;
  if (!isValidUsername(username))
    return res.status(400).json({ success: false, message: "Invalid username." });

  if (username === process.env.OWNER_USERNAME)
    return res.json({ success: true, message: "Owner access granted." });

  return res.status(401).json({ success: false, message: "Access denied." });
});

// Owner panel
app.get("/owner-panel", (req, res) => {
  const { username } = req.query;
  if (username !== process.env.OWNER_USERNAME)
    return res.status(403).json({ success: false, message: "Forbidden." });

  const users = readUsers();
  const totalUsers = users.length;
  const totalTokens = users.reduce((sum, u) => sum + u.tokens, 0);

  res.json({
    success: true,
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

// Register
app.post("/user/register", (req, res) => {
  const { username } = req.body;
  if (!isValidUsername(username))
    return res.status(400).json({ success: false, message: "Invalid username." });

  if (findUser(username))
    return res.status(409).json({ success: false, message: "User exists." });

  const newUser = { username, tokens: 1000 };
  upsertUser(newUser);

  res.json({ success: true, user: newUser });
});

// Login
app.post("/user/login", (req, res) => {
  const { username } = req.body;
  if (!isValidUsername(username))
    return res.status(400).json({ success: false, message: "Invalid username." });

  const user = findUser(username);
  if (!user)
    return res.status(404).json({ success: false, message: "User not found." });

  res.json({ success: true, user });
});

// Get tokens
app.get("/user/tokens", (req, res) => {
  const { username } = req.query;
  const user = findUser(username);
  if (!user)
    return res.status(404).json({ success: false });

  res.json({ success: true, tokens: user.tokens });
});

// Bet
app.post("/user/bet", (req, res) => {
  const { username, amount } = req.body;
  const user = findUser(username);

  if (!user)
    return res.status(404).json({ success: false, message: "User not found." });

  if (amount <= 0 || amount > user.tokens)
    return res.status(400).json({ success: false, message: "Invalid bet." });

  const win = Math.random() < 0.5;
  user.tokens += win ? amount : -amount;

  upsertUser(user);

  res.json({
    success: true,
    result: win ? "win" : "lose",
    tokens: user.tokens,
    message: win
      ? `You won ${amount} tokens!`
      : `You lost ${amount} tokens.`
  });
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("Backend running on port", port));
