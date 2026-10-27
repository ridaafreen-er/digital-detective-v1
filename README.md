# CASE ZERO: THE BLACKTHORN FILES

A self-hosted, four-round forensic investigation with three-member teams, judge-controlled access, server-enforced competition deadlines, delayed solution reveal, team elimination, batch archives, and an official winner announcement. It uses fictional local evidence artifacts and original synthesized audio.

## Start it on Windows with MongoDB

1. Install and start MongoDB locally, or create a MongoDB Atlas cluster and database user.
2. In VS Code, open **Terminal → New Terminal**, set the MongoDB URI, and start the app:

   ```powershell
   Set-Location -LiteralPath "C:\Users\riasi\OneDrive\Desktop\Digital Detective v1"
   $env:MONGODB_URI = "mongodb://127.0.0.1:27017/case_zero"
   npm start
   ```

3. For MongoDB Atlas, use its private connection URI instead. Keep the URI private; do not paste it into public files or commit it. Optionally set `MONGODB_DB` to select the database name; otherwise the URI's database name is used.
4. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).
5. If a judge account already exists, sign in with its current credentials. For first-time setup, configure a private one-time `CASE_ZERO_SETUP_SECRET` in the server terminal before starting and enter it in the judge setup screen.
6. Up to 100 teams can register. Each team needs a name, exactly three distinct members, and leader credentials. Save its one-time access code.
7. Register all teams for a batch, then select **START ALL REGISTERED TEAMS · 60 MINUTES**. Every registered, non-eliminated team shares one server-controlled deadline, including teams that are not logged in at the time. The start cannot be reset.
8. Teams can sign in after the start and use the remaining shared time. A team may request one judge-approved +15-minute extension. A rejected request may be submitted again; an approved extension applies only to that team's deadline.
9. Teams can revisit unlocked rounds and accepted answers. Future rounds remain locked. The solution opens only after every participating team finishes, is eliminated, or reaches its deadline.
10. After the batch is complete, use **ARCHIVE RESULTS & START NEW BATCH**. The judge archive preserves completed results while active registrations, timer, and team numbering reset. A **DELETE BATCH** action permanently removes a selected archive after confirmation.

## MongoDB storage and migration

When `MONGODB_URI` is configured, CASE ZERO stores the application state in one document in the `case_zero_state` collection. On the first connection, if that collection has no CASE ZERO state document, the app imports the local `data.json` state and leaves the original file untouched. It does not overwrite existing MongoDB state with the JSON file. Continue using the same MongoDB database to retain team registrations, timers, batch archives, and results.

If `MONGODB_URI` is not configured, the app uses local `data.json` storage for development and tests. Set `MONGODB_URI` in the same terminal session when running both `npm start` and `npm run reset-judge`.

To migrate an existing PostgreSQL-only state, export its `case_zero_state.state` JSON to `data.json` before the first start against an empty MongoDB database. Do not start with an empty MongoDB database if it already contains live competition data in another database; point the app at the intended MongoDB database first. Keep a protected backup before migrating.

## Evidence and QR

The evidence panel in a current case file provides the round's fictional reports, clock logs, QR inventory label, email, calendar, audit extracts, transcripts, financial ledger, registry, worksheet, voicemail transcript, and illustrations. Evidence endpoints require an admitted team and only allow current or already-cleared rounds; files are not publicly served from the static asset route.

The round-one QR opens `/scan-er-02.html`, which displays the incident image. Before generating a QR for other devices, set `CASE_ZERO_PUBLIC_URL` to the hosted HTTPS origin or phone-reachable LAN address, then run `npm run generate:evidence-qr`. The localhost default only works on the server computer.

## Deploying the frontend to Vercel

The app's frontend can be hosted on Vercel while its API and database-backed state remain on Render. `vercel.json` forwards every `/api/*` request to `https://digital-detective-v1.onrender.com/api/*`; deploy the latest repository revision so this rewrite is active.

1. Import the repository into Vercel with Framework Preset **Other** and Root Directory `./`.
2. Keep the Render service running and configure its `MONGODB_URI` and, if needed, `MONGODB_DB` and `CASE_ZERO_SETUP_SECRET` environment variables in Render. These backend variables are not needed in Vercel for this setup.
3. Deploy or redeploy the latest commit containing `vercel.json`. Static files are served from `public/`, and direct requests to `/evidence/*` are redirected to `/404`.
4. Verify the deployment by opening `https://<your-vercel-domain>/api/bootstrap`. It should return JSON from the Render API. If it returns `Not found`, make sure Vercel deployed the revision with the `/api/*` rewrite and then redeploy.

## Maintenance

- Stop the server with **Ctrl+C**. Use `npm run dev` for automatic restarts.
- Run syntax checks with `npm run check` and integration tests with `npm test`.
- To reset the judge password, stop the app and run `npm run reset-judge` in a terminal with the same `MONGODB_URI`. It changes only the password and preserves the competition data.

## Competition rules and privacy

- Each browser tab has its own sign-in session.
- MongoDB stores the shared competition state when configured; otherwise `data.json` is used. Refreshing, reconnecting, and signing in do not reset the server-controlled deadline.
- The server enforces submission deadlines, round progression, hints, approvals, extensions, and reveal access. Audio does not affect competition rules.
- Each team has three hints for the entire game; each costs 10 points. There is no public leaderboard.
- Teams can review cleared rounds and accepted answers, but accepted answers remain read-only and future rounds stay restricted.
- Focus-away records are advisory browser signals only. They may produce false positives and cannot detect another device.
- Text-selection and context-menu deterrents cannot prevent screenshots or other capture methods.
- Archived batches preserve scores, submissions, winner records, and team dossier details for the judge. Delete an archive only when it is no longer needed; deletion is permanent.
- Removing a team deletes its active dossier; elimination blocks its access but retains its dossier. Judge controls and private solution information are restricted to the judge account.
- Passwords use salted scrypt hashes. Session cookies are HTTP-only and SameSite strict. Protect and back up the MongoDB database and any local `data.json` copy.
- This is a local competition prototype. It binds to `127.0.0.1` by default; do not expose it to an untrusted network without HTTPS and suitable security controls.

## Sound and accessibility

Original Web Audio effects provide the ambience and restrained interface sounds. Sound starts after a user gesture, can be disabled, and never affects gameplay. Reduced-motion settings are respected.
