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
const TOKENS_FILE = "tokens.json";
const USERS_FILE = "users.json";

// ===== GENERIC DRIVE FILE LOAD/SAVE =====

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
    return await
