import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In-memory users
// Structure: { username: { password, tokens, role } }
const users = {};

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

// SIGNUP
app.post("/signup", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Missing fields" });
  if (users[username])
    return res.status(400).json({ error: "User exists" });

  users[username] = {
    password,
    tokens: 100,
    role: "user"
  };

  res.json({ message: "User created" });
});

// LOGIN
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const u = users[username];
  if (!u || u.password !== password)
    return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ username }, JWT_SECRET);
  res.json({ token });
});

// BALANCE
app.get("/balance", auth, (req, res) => {
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });
  res.json({ tokens: u.tokens });
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

// GAME TOKEN DELTA
app.post("/game/apply", auth, (req, res) => {
  const { delta } = req.body;
  const u = users[req.user.username];
  if (!u) return res.status(404).json({ error: "User not found" });

  u.tokens += Number(delta || 0);
  if (u.tokens < 0) u.tokens = 0;

  res.json({ tokens: u.tokens });
});

// ADMIN JSON API: list users
app.get("/admin/users", auth, (req, res) => {
  const me = users[req.user.username];
  if (!["owner", "admin"].includes(me?.role))
    return res.status(403).json({ error: "Not authorized" });

  const list = Object.entries(users).map(([name, u]) => ({
    username: name,
    password: u.password,
    tokens: u.tokens,
    role: u.role
  }));

  res.json({ users: list });
});

// ADMIN JSON API: set role
app.post("/admin/setRole", auth, (req, res) => {
  const me = users[req.user.username];
  if (me?.role !== "owner")
    return res.status(403).json({ error: "Only owner can change roles" });

  const { username, role } = req.body;
  const u = users[username];
  if (!u) return res.status(404).json({ error: "User not found" });

  u.role = role;
  res.json({ message: "Role updated", username, role });
});

// HTML ADMIN PANEL
app.get("/admin", auth, (req, res) => {
  const me = users[req.user.username];
  if (!["owner", "admin"].includes(me?.role))
    return res.status(403).send("Not authorized");

  let html = `
  <html>
  <head>
    <title>Admin Panel</title>
    <style>
      body { background:#111; color:white; font-family:Arial; }
      table { width:100%; border-collapse:collapse; margin-top:20px; }
      th, td { border:1px solid #444; padding:10px; }
      input, select { padding:6px; margin:4px; }
      button { padding:6px 10px; margin:4px; background:#d4af37; border:none; cursor:pointer; }
      h1 { color:#d4af37; }
    </style>
  </head>
  <body>
    <h1>Admin Panel</h1>
    <table>
      <tr>
        <th>Username</th>
        <th>Password</th>
        <th>Tokens</th>
        <th>Role</th>
        <th>Actions</th>
      </tr>
  `;

  for (const [name, u] of Object.entries(users)) {
    html += `
      <tr>
        <td>${name}</td>
        <td>${u.password}</td>
        <td>${u.tokens}</td>
        <td>${u.role}</td>
        <td>
          <form method="POST" action="/admin/updateRole" style="display:inline;">
            <input type="hidden" name="username" value="${name}">
            <select name="role">
              <option value="user">user</option>
              <option value="vip">vip</option>
              <option value="admin">admin</option>
              <option value="owner">owner</option>
            </select>
            <button type="submit">Set Role</button>
          </form>

          <form method="POST" action="/admin/updateTokens" style="display:inline;">
            <input type="hidden" name="username" value="${name}">
            <input type="number" name="tokens" value="${u.tokens}">
            <button type="submit">Set Tokens</button>
          </form>

          <form method="POST" action="/admin/resetPass" style="display:inline;">
            <input type="hidden" name="username" value="${name}">
            <input type="text" name="password" placeholder="new pass">
            <button type="submit">Reset Pass</button>
          </form>

          <form method="POST" action="/admin/deleteUser" style="display:inline;">
            <input type="hidden" name="username" value="${name}">
            <button type="submit">Delete</button>
          </form>
        </td>
      </tr>
    `;
  }

  html += `
    </table>
  </body>
  </html>
  `;

  res.send(html);
});

// ADMIN FORM HANDLERS
app.post("/admin/updateRole", auth, (req, res) => {
  const me = users[req.user.username];
  if (me?.role !== "owner") return res.status(403).send("Only owner");

  const { username, role } = req.body;
  const u = users[username];
  if (!u) return res.status(404).send("User not found");

  u.role = role;
  res.redirect("/admin");
});

app.post("/admin/updateTokens", auth, (req, res) => {
  const me = users[req.user.username];
  if (!["owner", "admin"].includes(me?.role))
    return res.status(403).send("Not allowed");

  const { username, tokens } = req.body;
  const u = users[username];
  if (!u) return res.status(404).send("User not found");

  u.tokens = parseInt(tokens || "0", 10);
  res.redirect("/admin");
});

app.post("/admin/resetPass", auth, (req, res) => {
  const me = users[req.user.username];
  if (!["owner", "admin"].includes(me?.role))
    return res.status(403).send("Not allowed");

  const { username, password } = req.body;
  const u = users[username];
  if (!u) return res.status(404).send("User not found");

  u.password = password;
  res.redirect("/admin");
});

app.post("/admin/deleteUser", auth, (req, res) => {
  const me = users[req.user.username];
  if (me?.role !== "owner") return res.status(403).send("Only owner");

  const { username } = req.body;
  delete users[username];
  res.redirect("/admin");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
