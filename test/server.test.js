const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const setupSecret = "private-case-zero-test-secret";

async function availablePort() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer(t, dataFile) {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DATABASE_URL: "",
    MONGODB_URI: "",
    MONGODB_DB: "",
    CASE_ZERO_DATA_FILE: dataFile,
    CASE_ZERO_SETUP_SECRET: setupSecret
  };
  let child = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });

  async function call(endpoint, { method = "GET", body, cookie, sessionToken } = {}) {
    const response = await fetch(`${origin}${endpoint}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(sessionToken !== undefined ? { "X-Case-Zero-Session": sessionToken } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const responseText = await response.text();
    const contentType = response.headers.get("Content-Type") || "";
    const result = contentType.includes("application/json")
      ? JSON.parse(responseText)
      : responseText;
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("cz_session="));
    return {
      status: response.status,
      result,
      cookie: setCookie && setCookie.split(";")[0],
      sessionToken: response.headers.get("X-Case-Zero-Session")
    };
  }

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await call("/api/bootstrap")).status === 200) { ready = true; break; }
    } catch { /* Wait for the test server to bind its port. */ }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  assert.equal(ready, true, `Server failed to start. ${logs}`);

  return {
    call,
    origin,
    env,
    async restart() {
      child.kill();
      await once(child, "exit");
      child = spawn(process.execPath, [path.join(projectRoot, "server.js")], {
        cwd: projectRoot,
        env,
        stdio: "ignore"
      });
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          if ((await call("/api/bootstrap")).status === 200) return;
        } catch { /* Wait for the restarted server to bind its port. */ }
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      assert.fail("Server did not restart.");
    }
  };
}

test("browser tab sessions keep judge and team access independent", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-zero-tab-sessions-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { call, origin } = await startServer(t, path.join(directory, "data.json"));
  const homepage = await fetch(origin);
  const homepageMarkup = await homepage.text();
  assert.equal(homepage.status, 200);
  assert.match(homepageMarkup, /CASE ZERO: THE BLACKTHORN FILES · HALLOWEEN EDITION/);
  assert.match(homepageMarkup, /class="opening-edition">HALLOWEEN EDITION/);
  assert.match(homepageMarkup, /class="halloween-drips"/);
  assert.match(homepageMarkup, /class="horror-skeletons"/);
  assert.match(homepageMarkup, /💀/);
  const themeResponse = await fetch(`${origin}/styles.css`);
  const themeStyles = await themeResponse.text();
  assert.match(themeStyles, /\.halloween-drips span/);
  assert.match(themeStyles, /--display:\s*"Algerian"/);
  assert.match(themeStyles, /--drip-x/);
  assert.match(themeStyles, /@keyframes blood-fall/);
  assert.match(themeStyles, /@keyframes skeleton-drift/);

  const setup = await call("/api/judge/setup", {
    method: "POST",
    body: { setupSecret, username: "tabjudge", password: "a-long-private-password" }
  });
  assert.equal(setup.status, 201);
  assert.match(setup.sessionToken, /^[a-f0-9]{64}$/);

  assert.equal((await call("/api/auth/logout", {
    method: "POST",
    body: {},
    sessionToken: setup.sessionToken
  })).status, 200);
  const judgeLogin = await call("/api/auth/judge/login", {
    method: "POST",
    body: { username: "tabjudge", password: "a-long-private-password" }
  });
  assert.equal(judgeLogin.status, 200, "A judge can sign in from the Judge Access form.");
  assert.match(judgeLogin.sessionToken, /^[a-f0-9]{64}$/);
  assert.equal((await call("/api/state", { sessionToken: judgeLogin.sessionToken })).result.role, "judge");

  const registration = await call("/api/auth/team/register", {
    method: "POST",
    body: {
      teamName: "Independent Tabs",
      username: "tabs_lead",
      password: "a-strong-team-password",
      members: ["Investigator One", "Investigator Two", "Investigator Three"]
    }
  });
  assert.equal(registration.status, 201);
  assert.match(registration.sessionToken, /^[a-f0-9]{64}$/);
  assert.notEqual(registration.sessionToken, setup.sessionToken);

  const judgeState = await call("/api/state", { sessionToken: judgeLogin.sessionToken });
  const teamState = await call("/api/state", { sessionToken: registration.sessionToken });
  assert.equal(judgeState.result.role, "judge");
  assert.equal(teamState.result.role, "team");

  assert.equal((await call("/api/auth/logout", {
    method: "POST",
    body: {},
    sessionToken: registration.sessionToken
  })).status, 200);
  const teamLogin = await call("/api/auth/team/login", {
    method: "POST",
    body: {
      username: "tabs_lead",
      accessCode: registration.result.accessCode,
      password: "a-strong-team-password"
    }
  });
  assert.equal(teamLogin.status, 200, "Registered teams can sign in again with their credentials.");
  assert.equal((await call("/api/state", { sessionToken: teamLogin.sessionToken })).result.role, "team");

  assert.equal((await call("/api/auth/logout", {
    method: "POST",
    body: {},
    sessionToken: setup.sessionToken
  })).status, 200);
  assert.equal((await call("/api/state", { sessionToken: setup.sessionToken })).status, 401);
  assert.equal((await call("/api/state", { sessionToken: teamLogin.sessionToken })).result.role, "team");
});

test("registration accepts up to 100 teams and rejects team 101", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-zero-team-limit-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dataFile = path.join(directory, "data.json");
  const { call } = await startServer(t, dataFile);
  const register = (teamName, username) => call("/api/auth/team/register", {
    method: "POST",
    body: {
      teamName,
      username,
      password: "a-strong-team-password",
      members: [`${teamName} One`, `${teamName} Two`, `${teamName} Three`]
    }
  });

  const first = await register("Limit Team 1", "limit_lead_1");
  assert.equal(first.status, 201);
  const savedStore = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const template = savedStore.teams[0];
  for (let number = 2; number <= 99; number += 1) {
    savedStore.teams.push({
      ...template,
      id: `team-limit-${number}`,
      teamNumber: number,
      teamName: `Limit Team ${number}`,
      username: `limit_lead_${number}`,
      accessCode: `LIMIT${String(number).padStart(5, "0")}`
    });
  }
  savedStore.nextTeamNumber = 100;
  await fs.writeFile(dataFile, JSON.stringify(savedStore));

  const beforeFinalRegistration = await call("/api/bootstrap");
  assert.equal(beforeFinalRegistration.result.maxTeams, 100);
  assert.equal(beforeFinalRegistration.result.registeredTeamCount, 99);
  const hundredth = await register("Limit Team 100", "limit_lead_100");
  assert.equal(hundredth.status, 201);
  assert.equal(hundredth.result.teamNumber, 100);

  const fullBootstrap = await call("/api/bootstrap");
  assert.equal(fullBootstrap.result.registeredTeamCount, 100);
  const overLimit = await register("Limit Team 101", "limit_lead_101");
  assert.equal(overLimit.status, 409);
  assert.match(overLimit.result.error, /limit of 100 registered teams/);
  const finalStore = JSON.parse(await fs.readFile(dataFile, "utf8"));
  assert.equal(finalStore.teams.length, 100, "A rejected registration must not alter saved team records.");
});

test("shared start, late login, extension review, and accepted-round history work together", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-zero-shared-start-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { call, origin } = await startServer(t, path.join(directory, "data.json"));

  const scanPage = await fetch(`${origin}/scan-er-02.html`);
  assert.equal(scanPage.status, 200);
  assert.match(await scanPage.text(), /images\/er-02-incident-report\.png/);
  const incidentImage = await fetch(`${origin}/images/er-02-incident-report.png`);
  assert.equal(incidentImage.status, 200);
  assert.match(incidentImage.headers.get("Content-Type"), /image\/png/i);

  const setup = await call("/api/judge/setup", {
    method: "POST",
    body: { setupSecret, username: "sharedjudge", password: "a-long-private-password" }
  });
  const register = (teamName, username) => call("/api/auth/team/register", {
    method: "POST",
    body: {
      teamName,
      username,
      password: "a-strong-team-password",
      members: [`${teamName} One`, `${teamName} Two`, `${teamName} Three`]
    }
  });
  const first = await register("Shared One", "shared_one");
  let second = await register("Shared Two", "shared_two");
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal((await call("/api/state", { sessionToken: setup.sessionToken })).result.competition.loggedInTeamCount, 2);
  assert.equal((await call("/api/auth/logout", {
    method: "POST",
    sessionToken: second.sessionToken,
    body: {}
  })).status, 200);
  let preStartJudgeState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  assert.equal(preStartJudgeState.competition.loggedInTeamCount, 1);
  assert.equal(preStartJudgeState.competition.registeredTeamCount, 2);

  const started = await call("/api/judge/start-for-all", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: {}
  });
  assert.equal(started.status, 200);
  assert.equal(started.result.participatingTeams, 2);
  assert.equal(started.result.deadline - started.result.startedAt, 60 * 60 * 1000);
  assert.equal((await call("/api/judge/start-for-all", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: {}
  })).status, 409, "A repeated shared start must never reset the timer.");
  second = await call("/api/auth/team/login", {
    method: "POST",
    body: {
      username: "shared_two",
      accessCode: second.result.accessCode,
      password: "a-strong-team-password"
    }
  });
  assert.equal(second.status, 200);
  const secondState = (await call("/api/state", { sessionToken: second.sessionToken })).result;
  assert.equal(secondState.team.deadline, started.result.deadline,
    "A registered team that was offline when the judge started is still included in the shared timer.");

  let judgeState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  const late = await register("Shared Late", "shared_late");
  let lateState = (await call("/api/state", { sessionToken: late.sessionToken })).result;
  assert.equal(lateState.round, null, "Late registrations still require judge approval.");
  judgeState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  const lateTeamId = judgeState.teams.find((team) => team.teamName === "Shared Late").id;
  assert.equal((await call("/api/judge/approve-team", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: { teamId: lateTeamId, approved: true }
  })).status, 200);
  lateState = (await call("/api/state", { sessionToken: late.sessionToken })).result;
  assert.equal(lateState.team.deadline, started.result.deadline,
    "A judge-approved late team joins the original shared deadline.");
  assert.equal(lateState.team.startedAt, started.result.startedAt);

  const requestExtension = () => call("/api/team/request-extension", {
    method: "POST",
    sessionToken: first.sessionToken,
    body: {}
  });
  assert.equal((await requestExtension()).status, 200);
  judgeState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  const firstId = judgeState.teams.find((team) => team.teamName === "Shared One").id;
  assert.equal(judgeState.teams.find((team) => team.id === firstId).extensionRequest.status, "pending");

  const decide = (decision) => call("/api/judge/extension-decision", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: { teamId: firstId, decision }
  });
  assert.equal((await decide("reject")).result.status, "rejected");
  assert.equal((await requestExtension()).status, 200, "A rejected extension can be requested again.");
  const approved = await decide("approve");
  assert.equal(approved.status, 200);
  assert.equal(approved.result.deadline, started.result.deadline + 15 * 60 * 1000);
  assert.equal((await requestExtension()).status, 409, "A team cannot receive a second extension.");

  const current = await call("/api/team/submit", {
    method: "POST",
    sessionToken: first.sessionToken,
    body: { round: 0, answer: "11:15" }
  });
  assert.equal(current.result.correct, true);
  const history = (await call("/api/state", { sessionToken: first.sessionToken })).result;
  assert.equal(history.team.progress, 1);
  assert.equal(history.team.unlockedRounds.length, 1);
  assert.equal(history.team.unlockedRounds[0].submission.answer, "11:15");
  assert.equal(history.team.deadline, approved.result.deadline);
  judgeState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  assert.equal(judgeState.competition.deadline, started.result.deadline,
    "An individual extension does not change the shared competition deadline.");

  const dataFile = path.join(directory, "data.json");
  const persisted = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const lateTeamData = persisted.teams.find((team) => team.teamName === "Shared Late");
  lateTeamData.deadline = Date.now() - 1;
  await fs.writeFile(dataFile, JSON.stringify(persisted));
  judgeState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  assert.equal(judgeState.revealReady, false,
    "One team's timeout does not reveal the solution while other participating teams still have time.");
  const refreshed = JSON.parse(await fs.readFile(dataFile, "utf8"));
  for (const team of refreshed.teams) team.deadline = Date.now() - 1;
  await fs.writeFile(dataFile, JSON.stringify(refreshed));
  judgeState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  assert.equal(judgeState.revealReady, true,
    "The solution becomes available when every participating team is complete, eliminated, or out of time.");
});

test("judge can archive a completed batch and start fresh registrations", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-zero-new-batch-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dataFile = path.join(directory, "data.json");
  const { call } = await startServer(t, dataFile);
  const setup = await call("/api/judge/setup", {
    method: "POST",
    body: { setupSecret, username: "batchjudge", password: "a-long-private-password" }
  });
  const team = await call("/api/auth/team/register", {
    method: "POST",
    body: {
      teamName: "First Batch Team",
      username: "first_batch_lead",
      password: "a-strong-team-password",
      members: ["Analyst One", "Analyst Two", "Analyst Three"]
    }
  });
  const preStart = await call("/api/judge/start-new-batch", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: {}
  });
  assert.equal(preStart.status, 409, "An active/unstarted batch must not be archived.");

  const started = await call("/api/judge/start-for-all", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: {}
  });
  assert.equal(started.status, 200);
  assert.equal((await call("/api/judge/start-new-batch", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: {}
  })).status, 409, "A batch cannot be archived while the competition is active.");

  const savedStore = JSON.parse(await fs.readFile(dataFile, "utf8"));
  savedStore.competition.deadline = Date.now() - 1;
  savedStore.teams[0].deadline = Date.now() - 1;
  savedStore.teams[0].submissions = [{ round: 1, answer: "11:15", acceptedAt: Date.now() - 1000 }];
  await fs.writeFile(dataFile, JSON.stringify(savedStore));
  assert.equal((await call("/api/state", { sessionToken: setup.sessionToken })).result.revealReady, true);

  const archived = await call("/api/judge/start-new-batch", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: {}
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.result.archivedBatchNumber, 1);
  assert.equal(archived.result.archivedTeamCount, 1);

  const freshState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  assert.equal(freshState.competition.startedAt, null);
  assert.equal(freshState.competition.deadline, null);
  assert.equal(freshState.teams.length, 0);
  assert.equal(freshState.winner, null);
  assert.equal(freshState.archivedBatches.length, 1);
  assert.equal(freshState.archivedBatches[0].teams[0].teamName, "First Batch Team");
  assert.equal(freshState.archivedBatches[0].teams[0].score, 25);
  assert.equal("passwordHash" in freshState.archivedBatches[0].teams[0], false);
  assert.equal("accessCode" in freshState.archivedBatches[0].teams[0], false);
  assert.equal((await call("/api/judge/delete-archived-batch", {
    method: "POST",
    sessionToken: team.sessionToken,
    body: { batchNumber: 1 }
  })).status, 401, "Only the judge can delete archived batches.");
  assert.equal((await call("/api/state", { sessionToken: team.sessionToken })).status, 401,
    "Old team sessions are invalidated when the new batch begins.");

  assert.equal((await call("/api/judge/delete-archived-batch", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: { batchNumber: "invalid" }
  })).status, 400);
  assert.equal((await call("/api/judge/delete-archived-batch", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: { batchNumber: 99 }
  })).status, 404);

  const nextTeam = await call("/api/auth/team/register", {
    method: "POST",
    body: {
      teamName: "Second Batch Team",
      username: "second_batch_lead",
      password: "a-strong-team-password",
      members: ["Analyst Four", "Analyst Five", "Analyst Six"]
    }
  });
  assert.equal(nextTeam.status, 201);
  assert.equal(nextTeam.result.teamNumber, 1, "New batch team numbering starts over.");
  assert.equal((await call("/api/auth/judge/login", {
    method: "POST",
    body: { username: "batchjudge", password: "a-long-private-password" }
  })).status, 200, "The judge login remains available between batches.");

  const nextBatchStarted = await call("/api/judge/start-for-all", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: {}
  });
  assert.equal(nextBatchStarted.status, 200);
  assert.equal((await call("/api/state", { sessionToken: setup.sessionToken })).result.teams.length, 1,
    "Deleting archived records does not remove current batch teams.");
  assert.equal((await call("/api/judge/delete-archived-batch", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: { batchNumber: 1 }
  })).status, 200, "An archived batch can be deleted without affecting the active competition.");
  const afterDelete = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  assert.equal(afterDelete.archivedBatches.length, 0);
  assert.equal(afterDelete.competition.startedAt, nextBatchStarted.result.startedAt);
});

test("judge can permanently remove a team without changing other teams' timers", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-zero-remove-team-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { call } = await startServer(t, path.join(directory, "data.json"));

  const setup = await call("/api/judge/setup", {
    method: "POST",
    body: { setupSecret, username: "removejudge", password: "a-long-private-password" }
  });
  const judgeToken = setup.sessionToken;

  async function register(teamName, username) {
    return call("/api/auth/team/register", {
      method: "POST",
      body: {
        teamName,
        username,
        password: "a-strong-team-password",
        members: [`${teamName} One`, `${teamName} Two`, `${teamName} Three`]
      }
    });
  }

  const activeTeam = await register("Active Unit", "active_lead");
  const pendingTeam = await register("Pending Unit", "pending_lead");
  assert.equal(activeTeam.status, 201);
  assert.equal(pendingTeam.status, 201);

  let judgeState = (await call("/api/state", { sessionToken: judgeToken })).result;
  const activeTeamId = judgeState.teams[0].id;
  assert.equal((await call("/api/judge/approve-team", {
    method: "POST",
    sessionToken: judgeToken,
    body: { teamId: judgeState.teams[0].id, approved: true }
  })).status, 200);
  const started = await call("/api/judge/start", {
    method: "POST",
    sessionToken: judgeToken,
    body: {}
  });
  assert.equal(started.status, 200);

  const removed = await call("/api/judge/remove-team", {
    method: "POST",
    sessionToken: judgeToken,
    body: { teamId: activeTeamId }
  });
  assert.equal(removed.status, 200);
  assert.equal((await call("/api/state", { sessionToken: activeTeam.sessionToken })).status, 401,
    "Removing a team invalidates its active tab session.");

  judgeState = (await call("/api/state", { sessionToken: judgeToken })).result;
  assert.equal(judgeState.teams.length, 1);
  assert.equal(judgeState.teams[0].teamName, "Pending Unit");
  assert.equal(judgeState.competition.participatingTeams, 0,
    "The removed active team is excluded from the participant count and reveal checks.");
  assert.equal(judgeState.competition.deadline, started.result.competition.deadline,
    "Removing one team does not reset the competition timer.");

  const laterTeam = await register("Later Unit", "later_lead");
  assert.equal(laterTeam.status, 201);
  assert.equal(laterTeam.result.teamNumber, 3, "Removed team numbers are not reused.");
  const persisted = JSON.parse(await fs.readFile(path.join(directory, "data.json"), "utf8"));
  assert.deepEqual(persisted.competition.participantIds, []);
  assert.equal(persisted.teams.some((team) => team.id === activeTeamId), false);
});

test("team evidence artifacts are viewable, downloadable, and round-gated", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-zero-evidence-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { call } = await startServer(t, path.join(directory, "data.json"));

  const setup = await call("/api/judge/setup", {
    method: "POST",
    body: { setupSecret, username: "evidencejudge", password: "a-long-private-password" }
  });
  const registered = await call("/api/auth/team/register", {
    method: "POST",
    body: {
      teamName: "Evidence Review",
      username: "evidence_lead",
      password: "a-strong-team-password",
      members: ["Analyst One", "Analyst Two", "Analyst Three"]
    }
  });

  assert.equal((await call("/api/evidence/round-1/scene-report.txt")).status, 401,
    "Evidence cannot be read without team authentication.");
  assert.equal((await call("/evidence/round-1/scene-report.txt")).status, 404,
    "Evidence is not directly exposed by the static-file server.");
  assert.equal((await call("/api/evidence/round-1/scene-report.txt", {
    sessionToken: registered.sessionToken
  })).status, 403, "A team cannot read evidence before judge approval.");

  const judgeState = (await call("/api/state", { sessionToken: setup.sessionToken })).result;
  assert.equal((await call("/api/judge/approve-team", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: { teamId: judgeState.teams[0].id, approved: true }
  })).status, 200);
  assert.equal((await call("/api/judge/start", {
    method: "POST",
    sessionToken: setup.sessionToken,
    body: {}
  })).status, 200);

  const report = await call("/api/evidence/round-1/scene-report.txt", {
    sessionToken: registered.sessionToken
  });
  assert.equal(report.status, 200);
  assert.match(report.result, /report time records discovery/i);

  const clockDiagnostic = await call("/api/evidence/round-1/device-clock.log", {
    sessionToken: registered.sessionToken
  });
  assert.equal(clockDiagnostic.status, 200);
  assert.doesNotMatch(clockDiagnostic.result, /23:15\s+REF/,
    "The calibration evidence does not directly print the corrected event time.");

  const qr = await call("/api/evidence/round-1/qr-inventory.svg", {
    sessionToken: registered.sessionToken
  });
  assert.equal(qr.status, 200);
  assert.match(qr.result, /<svg/i);
  assert.equal((await call("/api/evidence/round-1/not-an-evidence-file.txt", {
    sessionToken: registered.sessionToken
  })).status, 404);
  assert.equal((await call("/api/evidence/round-2/mail-07.eml", {
    sessionToken: registered.sessionToken
  })).status, 403, "Future-round artifacts remain restricted.");

  assert.equal((await call("/api/team/submit", {
    method: "POST",
    sessionToken: registered.sessionToken,
    body: { round: 0, answer: "11:15" }
  })).result.correct, true);
  assert.equal((await call("/api/evidence/round-2/mail-07.eml", {
    sessionToken: registered.sessionToken
  })).status, 200, "Submitting a round unlocks the next round's evidence artifacts.");

  const calendar = await call("/api/evidence/round-2/adrian-calendar.txt", {
    sessionToken: registered.sessionToken
  });
  assert.equal(calendar.status, 200);
  assert.doesNotMatch(calendar.result, /0417/,
    "The calendar corroborates the encoded email subject without printing the answer.");
  assert.equal((await call("/api/team/submit", {
    method: "POST",
    sessionToken: registered.sessionToken,
    body: { round: 1, answer: "0417" }
  })).result.correct, true);

  const roster = await call("/api/evidence/round-3/authorization-roster.txt", {
    sessionToken: registered.sessionToken
  });
  assert.equal(roster.status, 200,
    "The round-three credential cross-reference is present and unlocked.");
  const interviews = await call("/api/evidence/round-3/interview-transcripts.txt", {
    sessionToken: registered.sessionToken
  });
  assert.equal(interviews.status, 200);
  assert.doesNotMatch(interviews.result, /V\.HALE as the writer/i,
    "Interview files direct teams to verify statements without stating the record conclusion.");
  assert.equal((await call("/api/team/submit", {
    method: "POST",
    sessionToken: registered.sessionToken,
    body: { round: 2, answer: "VICTOR HALE" }
  })).result.correct, true);

  const worksheet = await call("/api/evidence/round-4/verdict-worksheet.txt", {
    sessionToken: registered.sessionToken
  });
  assert.equal(worksheet.status, 200,
    "The final-verdict worksheet is available in the unlocked final round.");
  assert.doesNotMatch(worksheet.result, /Victor Hale|11:15/,
    "The final worksheet guides evidence synthesis without stating the solution.");
  const finalIndex = await call("/api/evidence/round-4/final-evidence-index.txt", {
    sessionToken: registered.sessionToken
  });
  assert.equal(finalIndex.status, 200);
  assert.doesNotMatch(finalIndex.result, /Victor Hale|11:15/,
    "The final evidence index does not print the culprit or corrected time.");
});

test("judge can admit late teams, eliminate teams, clear team history, and retain the game", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-zero-admin-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dataFile = path.join(directory, "data.json");
  const server = await startServer(t, dataFile);
  const { call } = server;

  const setup = await call("/api/judge/setup", {
    method: "POST",
    body: { setupSecret, username: "nightjudge", password: "a-long-private-password" }
  });
  assert.equal(setup.status, 201);
  const judgeCookie = setup.cookie;

  async function register(teamName, username) {
    return call("/api/auth/team/register", {
      method: "POST",
      body: {
        teamName,
        username,
        password: "a-strong-team-password",
        members: [`${teamName} One`, `${teamName} Two`, `${teamName} Three`]
      }
    });
  }

  const firstTeam = await register("Signal Keepers", "signal_lead");
  const secondTeam = await register("Night Archive", "night_lead");
  assert.equal(firstTeam.status, 201);
  assert.equal(firstTeam.result.teamNumber, 1);
  assert.equal(secondTeam.result.teamNumber, 2);

  let judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  for (const team of judgeState.teams) {
    assert.equal((await call("/api/judge/approve-team", {
      method: "POST",
      cookie: judgeCookie,
      body: { teamId: team.id, approved: true }
    })).status, 200);
  }

  const started = await call("/api/judge/start", { method: "POST", cookie: judgeCookie, body: {} });
  assert.equal(started.status, 200);
  assert.equal(started.result.competition.deadline - started.result.competition.startedAt, 60 * 60 * 1000);
  const sharedDeadline = started.result.competition.deadline;
  const focusEventId = "c1f84610-1c62-4d17-9e7a-f3772d6e8150";
  assert.equal((await call("/api/team/focus-event", {
    method: "POST",
    body: { eventId: focusEventId, phase: "away", source: "tab-hidden" }
  })).status, 401, "Unauthenticated clients cannot report focus events.");
  assert.equal((await call("/api/team/focus-event", {
    method: "POST",
    cookie: firstTeam.cookie,
    body: { eventId: focusEventId, phase: "away", source: "tab-hidden" }
  })).status, 200);
  judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  assert.equal(judgeState.teams[0].focusEvents.length, 1, "Focus events are visible in judge dossiers.");
  assert.equal(judgeState.teams[0].focusEvents[0].source, "tab-hidden");
  const teamView = (await call("/api/state", { cookie: firstTeam.cookie })).result;
  assert.equal(teamView.team.focusEvents, undefined, "Focus logs are not exposed to team accounts.");
  assert.equal(teamView.competition.deadline, sharedDeadline, "Focus reporting cannot change the competition timer.");

  const lateTeam = await register("Late Arrivals", "late_lead");
  assert.equal(lateTeam.status, 201, "Registration remains open after the first competition start.");
  assert.equal(lateTeam.result.teamNumber, 3);
  let lateState = (await call("/api/state", { cookie: lateTeam.cookie })).result;
  assert.equal(lateState.round, null, "A late team cannot access the case before judge approval.");

  judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  const admitted = await call("/api/judge/approve-team", {
    method: "POST",
    cookie: judgeCookie,
    body: { teamId: judgeState.teams[2].id, approved: true }
  });
  assert.equal(admitted.status, 200);
  assert.equal(admitted.result.deadline, sharedDeadline, "A late team shares the original competition deadline.");
  assert.equal(admitted.result.startedAt, started.result.competition.startedAt);
  assert.equal((await call("/api/state", { cookie: judgeCookie })).result.competition.deadline, sharedDeadline);
  lateState = (await call("/api/state", { cookie: lateTeam.cookie })).result;
  assert.equal(lateState.competition.deadline, admitted.result.deadline);
  assert.equal(lateState.round.title, "THE SILENT STATION");

  const hint = await call("/api/team/hint", { method: "POST", cookie: lateTeam.cookie, body: {} });
  assert.equal(hint.status, 200);
  assert.equal(hint.result.penalty, 10);
  const hintState = (await call("/api/state", { cookie: lateTeam.cookie })).result;
  assert.equal(hintState.hints[0].text, hint.result.hint);
  assert.equal(hintState.team.hintsUsed, 1);
  assert.equal((await call("/api/team/hint", { method: "POST", cookie: lateTeam.cookie, body: {} })).status, 409);

  judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  const eliminated = await call("/api/judge/eliminate-team", {
    method: "POST",
    cookie: judgeCookie,
    body: { teamId: judgeState.teams[1].id }
  });
  assert.equal(eliminated.status, 200);
  assert.equal((await call("/api/state", { cookie: secondTeam.cookie })).status, 403);
  assert.equal((await call("/api/team/focus-event", {
    method: "POST",
    cookie: secondTeam.cookie,
    body: { eventId: "d93129f3-0da7-4822-a32b-09e0df74bafd", phase: "away", source: "window-blur" }
  })).status, 403, "Eliminated teams cannot create new focus-away records.");
  judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  assert.equal(judgeState.teams[1].eliminated, true, "The judge retains the eliminated team's dossier.");

  const answers = ["11:15", "0417", "VICTOR HALE"];
  const finalVerdict = {
    who: "Victor Hale",
    what: "Murder of Adrian Cross staged as suicide",
    when: "11:15 PM fatal event; body discovered at 11:47 PM",
    how: "Confrontation in Lab 4 and altered audit export",
    why: "Prevent exposure of falsified research and diverted funds",
    evidence: "PX-03, FIN-09, AUD-ORIG, SC-01",
    rejected: "Marcus Reed caused the camera outage but did not alter the audit or have the financial motive."
  };
  for (let round = 0; round < 4; round += 1) {
    const response = await call("/api/team/submit", {
      method: "POST",
      cookie: lateTeam.cookie,
      body: round < 3 ? { round, answer: answers[round] } : { round, verdict: finalVerdict }
    });
    assert.equal(response.result.correct, true, `Late team round ${round + 1} should accept its answer before the shared deadline.`);
    if (round === 0) {
      assert.equal((await call("/api/team/submit", {
        method: "POST",
        cookie: lateTeam.cookie,
        body: { round, answer: answers[round] }
      })).status, 409, "Accepted rounds remain locked.");
    }
  }

  const persisted = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const expiredAt = Date.now() - 1;
  for (const team of persisted.teams) {
    if ((persisted.competition.participantIds || []).includes(team.id)) team.deadline = expiredAt;
  }
  persisted.competition.deadline = expiredAt;
  await fs.writeFile(dataFile, JSON.stringify(persisted));
  assert.equal((await call("/api/team/focus-event", {
    method: "POST",
    cookie: firstTeam.cookie,
    body: { eventId: focusEventId, phase: "return", source: "tab-hidden" }
  })).status, 200, "A returning event can close after the team's timer expires.");
  judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  assert.ok(judgeState.teams[0].focusEvents[0].returnedAt);
  assert.ok(judgeState.teams[0].focusEvents[0].durationMs >= 0);
  assert.equal((await call("/api/team/focus-event", {
    method: "POST",
    cookie: firstTeam.cookie,
    body: { eventId: "b82287d2-21ed-442b-a772-28a53f22c0ef", phase: "away", source: "tab-hidden" }
  })).status, 409, "Teams cannot create focus-away records after their deadline.");
  assert.equal((await call("/api/team/submit", {
    method: "POST",
    cookie: firstTeam.cookie,
    body: { round: 0, answer: "11:15" }
  })).status, 410, "The initial team's original deadline remains enforced.");

  assert.equal((await call("/api/team/submit", {
    method: "POST",
    cookie: lateTeam.cookie,
    body: { round: 3, verdict: finalVerdict }
  })).status, 410, "Late teams are also bound by the original shared deadline.");
  assert.equal((await call("/api/state", { cookie: lateTeam.cookie })).result.revealReady, true);
  assert.equal((await call("/api/state", { cookie: lateTeam.cookie })).result.reveal.culprit, "Victor Hale");

  judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  assert.equal((await call("/api/judge/winner", {
    method: "POST",
    cookie: judgeCookie,
    body: { teamId: judgeState.teams[1].id, rationale: "Eliminated team must not win." }
  })).status, 404);
  assert.equal((await call("/api/judge/winner", {
    method: "POST",
    cookie: judgeCookie,
    body: { teamId: judgeState.teams[2].id, rationale: "Completed all four rounds." }
  })).status, 200);

  const cleared = await call("/api/judge/clear-teams", {
    method: "POST",
    cookie: judgeCookie,
    body: {}
  });
  assert.equal(cleared.status, 200);
  judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  assert.equal(judgeState.teams.length, 0);
  assert.equal(judgeState.competition.startedAt, started.result.competition.startedAt);
  assert.equal(judgeState.winner, null);

  const replacement = await register("Fresh Start", "fresh_lead");
  assert.equal(replacement.status, 201);
  assert.equal(replacement.result.teamNumber, 1, "Clearing team history resets team numbering.");
  judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  const replacementApproval = await call("/api/judge/approve-team", {
    method: "POST",
    cookie: judgeCookie,
    body: { teamId: judgeState.teams[0].id, approved: true }
  });
  assert.equal(replacementApproval.status, 409, "A cleared, newly registered team cannot join after the shared deadline.");
});

test("team-specific deadlines and reveal authorization survive a server restart", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-zero-expiry-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const dataFile = path.join(directory, "data.json");
  const server = await startServer(t, dataFile);
  const { call } = server;

  const setup = await call("/api/judge/setup", {
    method: "POST",
    body: { setupSecret, username: "expiryjudge", password: "another-private-password" }
  });
  const judgeCookie = setup.cookie;
  const registered = await call("/api/auth/team/register", {
    method: "POST",
    body: {
      teamName: "Deadline Watch",
      username: "deadline_lead",
      password: "a-strong-team-password",
      members: ["One", "Two", "Three"]
    }
  });
  let judgeState = (await call("/api/state", { cookie: judgeCookie })).result;
  assert.equal((await call("/api/judge/approve-team", {
    method: "POST",
    cookie: judgeCookie,
    body: { teamId: judgeState.teams[0].id, approved: true }
  })).status, 200);
  assert.equal((await call("/api/judge/start", { method: "POST", cookie: judgeCookie, body: {} })).status, 200);

  const persisted = JSON.parse(await fs.readFile(dataFile, "utf8"));
  persisted.teams[0].deadline = Date.now() - 1;
  persisted.competition.deadline = Date.now() - 1;
  await fs.writeFile(dataFile, JSON.stringify(persisted));
  await server.restart();

  const teamLogin = await call("/api/auth/team/login", {
    method: "POST",
    body: { username: "deadline_lead", accessCode: registered.result.accessCode, password: "a-strong-team-password" }
  });
  const teamState = (await call("/api/state", { cookie: teamLogin.cookie })).result;
  assert.equal(teamState.revealReady, true);
  assert.equal(teamState.reveal.culprit, "Victor Hale");
  assert.equal(teamState.team.progress, 0);
});
