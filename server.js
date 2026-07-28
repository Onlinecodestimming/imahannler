import { google } from "googleapis";

// Load Google Drive client
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

// Download tokens.json from Google Drive
async function loadTokens() {
    const drive = getDriveClient();

    // Find the file inside the folder
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

// Upload tokens.json to Google Drive
async function saveTokens(tokens) {
    const drive = getDriveClient();

    // Check if file exists
    const res = await drive.files.list({
        q: `'${FOLDER_ID}' in parents and name='${FILE_NAME}'`,
        fields: "files(id)"
    });

    const fileContent = Buffer.from(JSON.stringify(tokens, null, 2));

    if (res.data.files.length) {
        // Update existing file
        const fileId = res.data.files[0].id;

        await drive.files.update({
            fileId,
            media: {
                mimeType: "application/json",
                body: fileContent
            }
        });

    } else {
        // Create new file
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

// Apply token changes
async function applyTokenChange(userId, amount) {
    const tokens = await loadTokens();

    if (!tokens[userId]) {
        tokens[userId] = { tokens: 0 };
    }

    tokens[userId].tokens += amount;

    await saveTokens(tokens);

    return tokens[userId].tokens;
}

// Example Express route
app.post("/addTokens", async (req, res) => {
    const { userId, amount } = req.body;

    const newBalance = await applyTokenChange(userId, amount);

    res.json({ balance: newBalance });
});
