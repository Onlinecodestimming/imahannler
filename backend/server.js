import express from "express";
import cors from "cors";
import { google } from "googleapis";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ===== GOOGLE DRIVE TOKEN SYSTEM =====

function getDriveClient() {
    const key = JSON.parse(process.env.GOOGLE_KEY_JSON);

    const auth = new google.auth.GoogleAuth({
        credentials: key,
        scopes: ["https://www.googleapis.com/auth/drive.file"]
    });

    return google.drive({ version: "v3", auth });
}

const FOLDER_ID = process.env.GOOGLE_FOLDER_ID;
const FILE_NAME = "tokens.json";

async function loadTokens() {
    const drive = getDriveClient();

    const res = await drive.files.list({
        q: `'${FOLDER_ID}' in parents and name='${FILE_NAME}'`,
        fields: "files(id, name)"
    });

    if (!res.data.files.length) {
        console.log("tokens.json not found, creating new file...");
        await saveTokens({});
        return {};
    }

    const fileId = res.data.files[0].id;

    const fileRes = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "json" }
    );

    return fileRes.data || {};
}

async function saveTokens(tokens) {
    const drive = getDriveClient();

    const res = await drive.files.list({
        q: `'${FOLDER_ID}' in parents and name='${FILE_NAME}'`,
        fields: "files(id)"
    });

    const fileContent = Buffer.from(JSON.stringify(tokens, null, 2));

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
                name: FILE_NAME,
                parents: [FOLDER_ID]
            },
            media: {
                mimeType: "application/json",
                body: fileContent
            }
        });
    }
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

// ===== API ROUTES =====

app.get("/tokens/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;
        const tokens = await loadTokens();
        const balance = tokens[userId]?.tokens || 0;
        res.json({ userId, balance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load tokens" });
    }
});

app.post("/tokens/add", async (req, res) => {
    try {
        const { userId, amount } = req.body;
        const newBalance = await applyTokenChange(userId, amount);
        res.json({ userId, balance: newBalance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update tokens" });
    }
});

app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});
