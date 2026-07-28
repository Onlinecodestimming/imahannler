import express from "express";
import cors from "cors";
import { google } from "googleapis";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ===== GOOGLE DRIVE AUTH =====

function getDriveClient() {
    const key = JSON.parse(process.env.GOOGLE_KEY_JSON);

    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ["https://www.googleapis.com/auth/drive.file"]
    });

    return google.drive({ version: "v3", auth });
}

const FOLDER_ID = process.env.GOOGLE_FOLDER_ID;
const TOKENS_FILE = "tokens.json";
const USERS_FILE = "users.json";

// ===== GENERIC LOAD/SAVE =====

async function loadFile(name) {
    const drive = getDriveClient();

    const res = await drive.files.list({
        q: `'${FOLDER_ID}' in parents and name='${name}'`,
        fields: "files(id)"
    });

    if (!res.data.files.length) {
        await saveFile(name, {});
        return {};
    }

    const fileId = res.data.files[0].id;

    const fileRes = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "json" }
    );

    return fileRes.data || {};
}

async function saveFile(name, data) {
    const drive = getDriveClient();

    const res = await drive.files.list({
        q: `'${FOLDER_ID}' in parents and name='${name}'`,
        fields: "files(id)"
    });

    const fileContent = Buffer.from(JSON.stringify(data, null, 2));

    if (res.data.files.length) {
        const fileId = res.data.files[0].id;

        await drive.files.update({
            fileId,
            media: {
                mimeType: "application/json",
                body: fileContent
            }
        });
    } else {
        await drive.files.create({
            requestBody: {
                name,
                parents: [FOLDER_ID]
            },
            media: {
                mimeType: "application/json",
                body: fileContent
            }
        });
    }
}

// ===== USER SYSTEM =====

async function loadUsers() {
    return await loadFile(USERS_FILE);
}

async function saveUsers(users) {
    return await saveFile(USERS_FILE, users);
}

// ===== TOKEN SYSTEM =====

async function loadTokens() {
    return await loadFile(TOKENS_FILE);
}

async function saveTokens(tokens) {
    return await saveFile(TOKENS_FILE, tokens);
}

async function applyTokenChange(userId, amount) {
    const tokens = await loadTokens();

    if (!tokens[userId]) {
        tokens[userId] = { tokens: 0 };
    }

    tokens[userId].tokens += amount;

    await saveTokens(tokens);

    return tokens[userId].tokens;
}

// ===== ROUTES =====

// Register
app.post("/auth/register", async (req, res) => {
    try {
        const { username, password } = req.body;

        const users = await loadUsers();

        if (users[username]) {
            return res.status(400).json({ error: "User already exists" });
        }

        users[username] = { password, createdAt: Date.now() };
        await saveUsers(users);

        await applyTokenChange(username, 100);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Register failed" });
    }
});

// Login
app.post("/auth/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        const users = await loadUsers();

        if (!users[username] || users[username].password !== password) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Login failed" });
    }
});

// Get balance
app.get("/tokens/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const tokens = await loadTokens();
        const balance = tokens[userId]?.tokens || 0;
        res.json({ userId, balance });
    } catch (err) {
        res.status(500).json({ error: "Failed to load tokens" });
    }
});

// Add tokens
app.post("/tokens/add", async (req, res) => {
    try {
        const { userId, amount } = req.body;
        const newBalance = await applyTokenChange(userId, amount);
        res.json({ userId, balance: newBalance });
    } catch (err) {
        res.status(500).json({ error: "Failed to update tokens" });
    }
});

app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});
