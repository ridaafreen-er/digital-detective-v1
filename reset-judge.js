const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { MongoClient } = require("mongodb");

const scrypt = promisify(crypto.scrypt);
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "";
const DATA_FILE = process.env.CASE_ZERO_DATA_FILE
  ? path.resolve(process.env.CASE_ZERO_DATA_FILE)
  : path.join(__dirname, "data.json");

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return Promise.reject(new Error("Run this command in the VS Code integrated terminal so the password can be hidden."));
  }

  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function restore() {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    }

    function onData(character) {
      if (character === "\u0003") {
        restore();
        reject(new Error("Password reset cancelled."));
      } else if (character === "\r" || character === "\n") {
        restore();
        resolve(value);
      } else if (character === "\u007f" || character === "\b") {
        value = value.slice(0, -1);
      } else if (character >= " " && character !== "\u007f") {
        value += character;
      }
    }

    process.stdin.on("data", onData);
  });
}

async function main() {
  if (process.env.DATABASE_URL && !MONGODB_URI) {
    throw new Error("DATABASE_URL is no longer supported. Set MONGODB_URI to use MongoDB.");
  }
  const database = MONGODB_URI ? new MongoClient(MONGODB_URI) : null;
  const databaseName = MONGODB_DB || undefined;
  try {
    let store;
    if (database) {
      await database.connect();
      const db = database.db(databaseName);
      const document = await db.collection("case_zero_state").findOne({ _id: "main" });
      if (!document) throw new Error("No CASE ZERO MongoDB state found. Start the app and create the judge account first.");
      store = document.state;
    } else {
      try {
        store = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") throw new Error(`No CASE ZERO data file found at ${DATA_FILE}.`);
        throw error;
      }
    }
    if (!store.judge || typeof store.judge.username !== "string") {
      throw new Error("There is no judge account to reset. Start the app and create the judge account first.");
    }

    console.log(`Resetting the password for judge account "${store.judge.username}".`);
    console.log("Only the judge password will change; team records and competition data will be preserved.");
    const password = await readHidden("New password (12 characters minimum): ");
    if (password.length < 12) throw new Error("The password must be at least 12 characters.");
    const confirmation = await readHidden("Re-enter new password: ");
    if (password !== confirmation) throw new Error("The passwords do not match. No data was changed.");

    const salt = crypto.randomBytes(16).toString("hex");
    const hash = await scrypt(password, salt, 64);
    store.judge.passwordHash = `${salt}:${hash.toString("hex")}`;

    if (database) {
      const result = await database.db(databaseName).collection("case_zero_state").replaceOne(
        { _id: "main" },
        { _id: "main", state: store, updatedAt: new Date() }
      );
      if (result.matchedCount !== 1) throw new Error("MongoDB CASE ZERO state document is missing.");
    } else {
      const temporaryFile = `${DATA_FILE}.tmp`;
      await fs.writeFile(temporaryFile, JSON.stringify(store, null, 2), { mode: 0o600 });
      await fs.rename(temporaryFile, DATA_FILE);
    }
    console.log("Judge password updated. Sign in with the same username and your new password.");
  } finally {
    if (database) await database.close();
  }
}

main().catch((error) => {
  console.error(`Judge password reset failed: ${error.message}`);
  process.exitCode = 1;
});
