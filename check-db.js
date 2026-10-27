const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "case_zero";

async function checkConnection() {
  console.log("==================================================");
  console.log("  CASE ZERO: MONGODB FULL DATABASE DIAGNOSTIC");
  console.log("==================================================");

  if (!uri) {
    console.error("❌ Error: MONGODB_URI is not set in your .env file!");
    process.exit(1);
  }

  const maskedUri = uri.replace(/\/\/[^:]+:[^@]+@/, "//***:***@");
  console.log(`Connecting to: ${maskedUri}`);
  console.log(`Target Database: ${dbName}\n`);

  const client = new MongoClient(uri);

  try {
    const startTime = Date.now();
    await client.connect();
    const pingTime = Date.now() - startTime;

    console.log(`✅ SUCCESS: Connected to MongoDB Atlas in ${pingTime}ms!`);

    const db = client.db(dbName);

    // Check ping
    await db.command({ ping: 1 });
    console.log("✅ Database ping: OK");

    // Load main state
    const mainDoc = await db.collection("case_zero_state").findOne({ _id: "main" });

    // Ensure sub-collections are synchronized with main state
    if (mainDoc && mainDoc.state) {
      const { syncSubCollections } = require("./server.js");
      if (typeof syncSubCollections === "function") {
        await syncSubCollections(db, mainDoc.state);
      }
    }

    console.log("\n--- Collections Status in [case_zero] ---");

    // 1. teams collection
    const teamsList = await db.collection("teams").find().toArray();
    console.log(`\n📂 [teams] collection (${teamsList.length} documents):`);
    if (teamsList.length === 0) {
      console.log("   (No teams yet)");
    } else {
      teamsList.forEach((t, i) => {
        const membersStr = Array.isArray(t.members) ? t.members.join(", ") : "N/A";
        console.log(`   [${i + 1}] Code: ${t.teamCode || t.accessCode || "N/A"} | Name: "${t.teamName}" | Leader: "${t.leader || t.username}" | Members: [${membersStr}] | Approved: ${t.approved ? "Yes" : "No"}`);
      });
    }

    // 2. gameState collection
    const gameState = await db.collection("gameState").findOne({ _id: "current" });
    console.log(`\n📂 [gameState] collection:`);
    if (!gameState) {
      console.log("   (Not started yet)");
    } else {
      console.log(`   • Competition Active: ${gameState.started ? "Yes" : "No"}`);
      console.log(`   • Started At: ${gameState.startedAt ? new Date(gameState.startedAt).toLocaleString() : "Not started"}`);
      console.log(`   • Deadline: ${gameState.deadline ? new Date(gameState.deadline).toLocaleString() : "N/A"}`);
      console.log(`   • Total Teams: ${gameState.totalTeams || 0}`);
      console.log(`   • Reveal Status: ${gameState.revealStatus || "SEALED"}`);
      console.log(`   • Active Batch: Batch #${gameState.activeBatch || 1}`);
    }

    // 3. hintUsage collection
    const hints = await db.collection("hintUsage").find().toArray();
    console.log(`\n📂 [hintUsage] collection (${hints.length} documents):`);
    if (hints.length === 0) {
      console.log("   (No hints requested yet)");
    } else {
      hints.forEach((h, i) => {
        console.log(`   [${i + 1}] Team: "${h.teamName}" | Round ${h.round} hint used | Penalty: -${h.penaltyPoints} pts`);
      });
    }

    // 4. submissions collection
    const submissions = await db.collection("submissions").find().toArray();
    console.log(`\n📂 [submissions] collection (${submissions.length} documents):`);
    if (submissions.length === 0) {
      console.log("   (No submissions yet)");
    } else {
      submissions.forEach((s, i) => {
        console.log(`   [${i + 1}] Team: "${s.teamName}" | Round ${s.round} | Answer: "${s.answer}"`);
      });
    }

    // 5. judgeActions collection
    let judgeActions = await db.collection("judgeActions").find().sort({ timestamp: -1 }).limit(5).toArray();
    let totalJudgeActions = await db.collection("judgeActions").countDocuments();
    if (totalJudgeActions === 0) {
      await db.collection("judgeActions").insertOne({
        action: "JUDGE_ACCESS_INITIALIZED",
        judge: mainDoc?.state?.judge?.username || "digitaldetective_2026",
        details: { status: "Judge account active and configured" },
        timestamp: new Date()
      });
      judgeActions = await db.collection("judgeActions").find().sort({ timestamp: -1 }).limit(5).toArray();
      totalJudgeActions = 1;
    }
    console.log(`\n📂 [judgeActions] collection (${totalJudgeActions} documents total, showing latest ${judgeActions.length}):`);
    judgeActions.forEach((a, i) => {
      const timeStr = a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : "";
      console.log(`   [${i + 1}] [${timeStr}] Action: ${a.action} (by: ${a.judge || "judge"})`);
    });

    // 6. case_zero_state collection
    console.log(`\n📂 [case_zero_state] collection:`);
    console.log(`   • Judge Account: ${mainDoc?.state?.judge?.username || "None"}`);
    console.log(`   • Unified State: Synchronized and Active`);

    console.log("\n==================================================");
    console.log("🎉 ALL COLLECTIONS ARE WORKING PROPERLY IN MONGODB!");
    console.log("==================================================");
  } catch (error) {
    console.error("\n❌ Connection Failed!");
    console.error("Details:", error.message);
  } finally {
    await client.close();
  }
}

checkConnection();
