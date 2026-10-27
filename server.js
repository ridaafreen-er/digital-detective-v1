const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util'),scrypt=promisify(crypto.scrypt),ROOT=__dirname,PUBLIC=path.join(ROOT,'public');
const DATA_FILE=process.env.CASE_ZERO_DATA_FILE?path.resolve(process.env.CASE_ZERO_DATA_FILE):path.join(ROOT,'data.json');
const { MongoClient } = require("mongodb");
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "";
let database = MONGODB_URI ? new MongoClient(MONGODB_URI) : null;
let stateCollection;
const HOST=process.env.HOST||'127.0.0.1',PORT=Number(process.env.PORT||3000),COMPETITION_MS=3600000,SESSION_MS=43200000,SETUP_SECRET=process.env.CASE_ZERO_SETUP_SECRET||'',MAX_TEAMS=100;
const sessions=new Map(),attempts=new Map(),answerAttempts=new Map();let store,queue=Promise.resolve(),saveQueue=Promise.resolve();
const roundData=[
{title:'THE SILENT STATION',file:'R1 / SCENE REGISTER',briefing:"At 11:47 PM the official report records Adrian Cross's discovery in Lab 4. The archive copy has been reconstructed from scene records.",evidence:['SC-01 · Security called the medical team at 11:47 PM.','PX-03 · Condensation shadow over the wristwatch fixes the impact at 11:15 PM.','ER-02 · QR inventory copy exported at 11:16 PM; the official report says it was created at 11:47 PM.','Witness note: the corridor clock ran seven minutes fast.'],question:'What is the corrected time of the fatal event? Enter HH:MM.',hint:'Separate discovery time from the time fixed by the photograph, then account for the clock offset.',answer:'11:15'},
{title:'THE GHOST IN THE MACHINE',file:'R2 / AUDIT TRAIL',briefing:'Three systems recorded the night in different time bases. The original audit survives beside a modified export.',evidence:['LOG-11 · Lab credential V. HALE entered 23:08 institute time; terminal ran seven minutes fast.','CCTV-04 · Camera 4 outage began 23:10 server time; maintenance ticket uploaded 23:29.','MAN-02 · Export hash differs from original audit hash; modification time is 23:31.','MAIL-07 · Encrypted subject key is the room number on Adrian’s calendar: 0417.'],question:'Which four-digit room key authenticates the original audit?',hint:'Cross-reference the calendar evidence; no brute force or unstated cipher is needed.',answer:'0417'},
{title:"THE WITNESS WHO WASN'T THERE",file:'R3 / STATEMENT MATRIX',briefing:'Five people concealed something that night. A lie is not proof of murder; compare each account against independent records.',evidence:['INT-01 Voss: argued over authorship; lab badge places her in the library at 23:02.','INT-02 Reed: denied a camera restart; signed maintenance order M-14 at 23:24.','INT-03 Sophie Cross: hid a 22:51 call asking Adrian to leave town.','INT-04 Hayes: deleted a message about falsified samples; bench ledger places him in Annex B.','FIN-09 Hale’s shell-company transfer matches the falsified grant tranche; his badge and altered export overlap the death window.'],question:'Whose account is contradicted by independent access and financial records? Enter the full name.',hint:'Require motive, opportunity, and evidence tampering to converge; an embarrassing secret alone is not decisive.',answer:'VICTOR HALE'},
{title:'THE LAST TRANSMISSION',file:'R4 / FINAL VERDICT',briefing:'The original audit fragment records the archive export command under Hale’s credential at 23:24 server time. Submit your complete evidence-based verdict.',evidence:['AUD-ORIG · Hale’s credential altered the export after the camera outage.','FIN-09 · The transfer would be exposed by Adrian’s original grant ledger.','PX-03 + SC-01 · Fatal event at 11:15 PM; body discovered at 11:47 PM.','M-14 · Reed’s maintenance action explains the outage but not the altered export or financial motive.'],question:'Submit WHO, WHAT, WHEN, HOW, WHY, supporting evidence IDs, and a competing theory rejected.',hint:'Build a chain from independent records. Explain why the security outage alone does not identify the killer.',answer:'VICTOR HALE'}];
const evidenceFiles={
  1:['scene-report.txt','device-clock.log','qr-inventory-label.txt','scene-photo.svg','qr-inventory.svg'],
  2:['account-access.log','mail-07.eml','adrian-calendar.txt','audit-integrity.txt'],
  3:['interview-transcripts.txt','cross-chat.txt','transfer-ledger.csv','entity-registry.txt','authorization-roster.txt','suspect-contact-sheet.svg'],
  4:['audit-fragment.log','final-evidence-index.txt','verdict-worksheet.txt','voice-transcript.txt','checksum-manifest.txt']
};
roundData[0].evidence=[
  'SC-01 · Dispatch records the discovery call; it does not establish when the injury occurred.',
  'PX-03 · The recovered watch stopped while the lab wall clock displayed 23:22.',
  'ER-02 · The inventory label records when a QR copy was exported; compare it with the incident report.',
  'Clock diagnostic · The wall clock was not synchronized; use the calibration log before reading PX-03.'
];
roundData[0].hint='PX-03 shows a device-clock reading. Find the stable offset in device-clock.log, correct the displayed time, and keep discovery time separate.';
roundData[1].evidence=[
  'LOG-11 · Compare badge and camera records only after identifying each system’s time base.',
  'CCTV-04 · A camera outage and the maintenance ticket are separate events; neither identifies who changed the archive.',
  'MAN-02 · The replacement export differs from the immutable audit; compare its author and modification sequence.',
  'MAIL-07 · The subject is preserved in MIME quoted-printable form. Decode it, then check CAL-04 independently.'
];
roundData[1].hint='Open MAIL-07 and decode its MIME Q-encoded subject as text bytes. Use CAL-04 as a cross-check; do not treat the email as a live password.';
roundData[2].evidence=[
  'INT-01–04 · Each statement contains a concealed fact; compare each with independent access, call, maintenance, or bench records.',
  'INT-05 · Hale denies two events. Check those claims against LOG-11 and AUDIT-ORIG rather than treating the interview itself as proof.',
  'FIN-09 · The ledger lists a grant transfer and an authorization code. Use entity-registry.txt to determine what the records establish.',
  'AUDIT-INTEGRITY · A modified export is evidence of tampering; identify the writer from the original record.'
];
roundData[2].hint='Build a three-part comparison: access and timeline, the original audit writer, and the transfer beneficiary. Then eliminate statements contradicted by independent records.';
roundData[3].briefing='The evidence from the four rounds must now be assembled into a defensible verdict. Revisit the scene timing, decoded archive reference, independent statements, access records, and financial trail. No single file is a complete solution.';
roundData[3].evidence=[
  'AUD-ORIG · Use the immutable event order and distinguish reference-server time from the lab terminal clock.',
  'FIN-09 · Trace the transfer beneficiary through the entity registry; a payment alone establishes neither access nor the act.',
  'PX-03 + SC-01 · Reconcile the photographed device time with its clock calibration; discovery time is a separate event.',
  'M-14 + CCTV-04 · The maintenance action explains a camera gap. Decide whether it also explains the independent archive and financial records.'
];
roundData[3].question='Build a complete verdict from evidence across all four rounds: identify the responsible person, describe the crime and timeline, explain method and motive, cite PX-03, FIN-09, and AUD-ORIG, and rebut one competing theory.';
roundData[3].hint='Use the verdict worksheet to structure your reasoning. Your evidence should connect opportunity, action, motive, and timeline; distinguish direct records from inference.';
const officialReveal={title:'THE CASE FILE UNSEALED',culprit:'Victor Hale',narrative:'Adrian Cross discovered that institute research results had been falsified and grant money diverted through a shell company tied to director Victor Hale. Adrian planned to expose the original records. Hale confronted him in Lab 4 and killed him at approximately 11:15 PM. He used Reed’s camera maintenance outage as cover, altered the exported audit, and staged the scene as a suicide. The body was discovered at 11:47 PM. Three days later, an anonymous sender supplied the damaged records so investigators could reconstruct the night.',timeline:['22:51 — Sophie calls Adrian urging him to leave; her secret is unrelated to the killing.','23:02 — Voss is logged in the library after an authorship dispute.','23:08 — Hale’s credential enters Lab 4; terminal clock is seven minutes fast.','23:10 — Camera 4 outage begins under Reed’s maintenance order.','23:15 — Corrected fatal event, established by PX-03 and clock calibration.','23:24 — Hale alters the exported audit after the fatal event; the original hash exposes the change.','23:31 — Modified export is recorded; it is not the original event time.','23:47 — Security discovers Adrian; this is discovery time, not time of death.'],suspects:['Elena Voss — concealed an authorship dispute; library access rebuts opportunity.','Marcus Reed — concealed an unauthorized maintenance restart; M-14 explains the camera outage, not murder or export alteration.','Sophie Cross — concealed a plea for Adrian to leave; call metadata places her elsewhere.','Daniel Hayes — hid sample falsification; Annex B ledger rebuts opportunity.','Victor Hale — concealed grant diversion, entered Lab 4, and altered the audit after the death.'],clues:['SC-01 establishes discovery at 11:47 PM.','PX-03 establishes the fatal event at 11:15 PM with the +7 minute clock offset.','ER-02 and MAN-02 show the official inventory/export chronology was altered.','LOG-11 links Hale’s credential to Lab 4; CCTV-04/M-14 explain outage but do not identify the killer.','MAIL-07 and the original audit key 0417 reveal the authentic record.','FIN-09 establishes motive; AUD-ORIG links Hale to the cover-up.','Red herrings: Voss’s authorship dispute, Reed’s maintenance action, Sophie’s call, and Hayes’s sample falsification are authentic secrets, not proof of murder.'],verdict:{who:'Victor Hale',what:'Murder of Adrian Cross staged as suicide',when:'Fatal event ~11:15 PM; discovery 11:47 PM',how:'Confrontation in Lab 4, camera outage cover, altered audit export',why:'Prevent exposure of falsified research and diverted grant funds',evidence:'PX-03, SC-01, LOG-11, CCTV-04, MAN-02, AUD-ORIG, FIN-09',rejected:'Marcus Reed: M-14 explains the outage but not the financial motive, Lab 4 entry, and post-event export alteration.'}};
function blank(){return{judge:null,teams:[],nextTeamNumber:1,winner:null,competition:{startedAt:null,deadline:null,participantIds:[]},sessions:{}}}
function normalizeStore(p){let d={...blank(),...p};d.competition={...blank().competition,...(p.competition||{})};d.teams=(p.teams||[]).map((t,i)=>({...t,teamNumber:t.teamNumber||i+1,approved:t.approved??Boolean(t.startedAt),hints:t.hints||[],submissions:t.submissions||[]}));d.archivedBatches=Array.isArray(d.archivedBatches)?d.archivedBatches:[];d.sessions=(p&&typeof p.sessions==='object'&&p.sessions!==null)?p.sessions:{};d.nextTeamNumber=Math.max(d.nextTeamNumber||1,...d.teams.map(t=>t.teamNumber+1));if(!d.competition.startedAt&&d.teams.some(t=>t.startedAt)){let st=d.teams.find(t=>t.startedAt).startedAt;d.competition={startedAt:st,deadline:st+COMPETITION_MS,participantIds:d.teams.filter(t=>t.startedAt).map(t=>t.id)}}if(d.competition.startedAt)for(let t of d.teams){const participating=d.competition.participantIds.includes(t.id);t.startedAt=participating?(t.startedAt||d.competition.startedAt):null;t.deadline=participating?(t.deadline||d.competition.deadline):null}return d}
async function loadLegacyFile(){try{return normalizeStore(JSON.parse(await fs.readFile(DATA_FILE,'utf8')))}catch(e){if(e.code==='ENOENT')return blank();throw e}}

async function syncSubCollections(db, currentStore, timestamp = new Date()) {
  if (!db || !currentStore) return;
  try {
    const teamsCol = db.collection('teams');
    const gameStateCol = db.collection('gameState');
    const hintUsageCol = db.collection('hintUsage');
    const submissionsCol = db.collection('submissions');

    const allTeams = currentStore.teams || [];

    // 1. Sync teams to 'teams' collection
    for (const team of allTeams) {
      await teamsCol.updateOne(
        { $or: [{ _id: team.id }, { teamCode: team.accessCode }] },
        {
          $set: {
            teamCode: team.accessCode,
            teamName: team.teamName,
            leader: team.username,
            members: team.members || [],
            teamNumber: team.teamNumber,
            approved: Boolean(team.approved),
            eliminated: Boolean(team.eliminated),
            progress: progress(team),
            score: Math.max(0, progress(team) * 25 - (team.hintsUsed || 0) * 10),
            hintsUsed: team.hintsUsed || 0,
            startedAt: team.startedAt ? new Date(team.startedAt) : null,
            deadline: team.deadline ? new Date(team.deadline) : null,
            completedAt: team.completedAt ? new Date(team.completedAt) : null,
            finalVerdict: team.finalVerdict || null,
            updatedAt: timestamp
          },
          $setOnInsert: {
            _id: team.id,
            createdAt: timestamp
          }
        },
        { upsert: true }
      );
    }

    // 2. Sync gameState to 'gameState' collection
    const comp = currentStore.competition || {};
    const participants = (comp.participantIds || []).map(id => allTeams.find(t => t.id === id)).filter(Boolean);
    const isRevealReady = participants.length > 0 && participants.every(t => t.eliminated || progress(t) === 4 || (t.deadline && Date.now() >= t.deadline));
    await gameStateCol.updateOne(
      { _id: 'current' },
      {
        $set: {
          started: Boolean(comp.startedAt),
          startedAt: comp.startedAt ? new Date(comp.startedAt) : null,
          deadline: comp.deadline ? new Date(comp.deadline) : null,
          totalTeams: allTeams.length,
          activeTeams: allTeams.filter(t => !t.eliminated).length,
          approvedTeams: allTeams.filter(t => t.approved).length,
          participatingTeamIds: comp.participantIds || [],
          finishedTeams: participants.filter(t => t.eliminated || progress(t) === 4 || (t.deadline && Date.now() >= t.deadline)).length,
          winner: currentStore.winner || null,
          revealReady: isRevealReady,
          revealStatus: isRevealReady ? 'UNSEALED' : 'SEALED',
          activeBatch: (currentStore.archivedBatches ? currentStore.archivedBatches.length : 0) + 1,
          updatedAt: timestamp
        }
      },
      { upsert: true }
    );

    // 3. Sync hintUsage to 'hintUsage' collection
    for (const team of allTeams) {
      if (Array.isArray(team.hints)) {
        for (const hint of team.hints) {
          const hintId = `${team.id}-round-${hint.round}`;
          await hintUsageCol.updateOne(
            { _id: hintId },
            {
              $set: {
                teamId: team.id,
                teamNumber: team.teamNumber,
                teamName: team.teamName,
                round: hint.round,
                hintText: hint.text,
                requestedAt: hint.requestedAt ? new Date(hint.requestedAt) : timestamp,
                penaltyPoints: 10,
                updatedAt: timestamp
              }
            },
            { upsert: true }
          );
        }
      }
    }

    // 4. Sync submissions to 'submissions' collection
    for (const team of allTeams) {
      if (Array.isArray(team.submissions)) {
        for (const sub of team.submissions) {
          const subId = `${team.id}-round-${sub.round}`;
          await submissionsCol.updateOne(
            { _id: subId },
            {
              $set: {
                teamId: team.id,
                teamNumber: team.teamNumber,
                teamName: team.teamName,
                round: sub.round,
                answer: sub.answer,
                submittedAt: sub.acceptedAt ? new Date(sub.acceptedAt) : timestamp,
                isFinalVerdict: sub.round === 4,
                verdictDetails: sub.round === 4 ? team.finalVerdict : null,
                updatedAt: timestamp
              }
            },
            { upsert: true }
          );
        }
      }
    }
  } catch (err) {
    console.error('Error synchronizing sub-collections to MongoDB:', err.message);
  }
}

async function recordJudgeAction(action, details = {}) {
  if (!database) return;
  try {
    const db = (process.env.MONGODB_DB || MONGODB_DB) ? database.db(process.env.MONGODB_DB || MONGODB_DB) : database.db();
    await db.collection('judgeActions').insertOne({
      action,
      judge: (store && store.judge) ? store.judge.username : 'judge',
      details,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('Error logging judge action:', err.message);
  }
}

async function initializeDatabase(){
  const uri=process.env.MONGODB_URI||MONGODB_URI||'';
  if(!uri)return;
  if(!database)database=new MongoClient(uri);
  if(!stateCollection){
    await database.connect();
    const db=(process.env.MONGODB_DB||MONGODB_DB)?database.db(process.env.MONGODB_DB||MONGODB_DB):database.db();
    stateCollection=db.collection('case_zero_state');
    if(!await stateCollection.findOne({_id:'main'})){
      const initial=await loadLegacyFile();
      try{
        await stateCollection.insertOne({_id:'main',state:initial,updatedAt:new Date()});
      }catch(error){
        if(error.code!==11000)throw error;
        if(!await stateCollection.findOne({_id:'main'}))throw error;
      }
    }
    // Record initial judge access if judgeActions is empty
    const judgeCount = await db.collection('judgeActions').countDocuments().catch(() => 1);
    if (judgeCount === 0) {
      await db.collection('judgeActions').insertOne({
        action: 'SYSTEM_INITIALIZED',
        judge: 'digitaldetective_2026',
        details: { note: 'CASE ZERO system connected to MongoDB' },
        timestamp: new Date()
      }).catch(() => {});
    }
  }
}

async function load(){
  if(!database)return loadLegacyFile();
  if(!stateCollection)await initializeDatabase();
  const document=await stateCollection.findOne({_id:'main'});
  if(!document)throw new Error('MongoDB CASE ZERO state document is missing.');
  const st=normalizeStore(document.state);
  if(st.sessions){
    for(const [tk,v] of Object.entries(st.sessions)){
      if(v&&v.expiresAt>Date.now())sessions.set(tk,v);
      else sessions.delete(tk);
    }
  }
  const db=(process.env.MONGODB_DB||MONGODB_DB)?database.db(process.env.MONGODB_DB||MONGODB_DB):database.db();
  syncSubCollections(db, st).catch(() => {});
  return st;
}

async function persist(){
  saveQueue=saveQueue.then(async()=>{
    if(database){
      if(!stateCollection)await initializeDatabase();
      if(stateCollection){
        const now = new Date();
        const db=(process.env.MONGODB_DB||MONGODB_DB)?database.db(process.env.MONGODB_DB||MONGODB_DB):database.db();
        await stateCollection.updateOne({_id:'main'},{$set:{state:store,updatedAt:now}},{upsert:true});
        await syncSubCollections(db, store, now);
        return;
      }
    }
    const temporaryFile=`${DATA_FILE}.tmp`;
    await fs.writeFile(temporaryFile,JSON.stringify(store,null,2),{mode:0o600});
    await fs.rename(temporaryFile,DATA_FILE);
  });
  await saveQueue;
}
function json(res,status,obj,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(obj))}function fail(res,status,error){json(res,status,{error})}
async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>32768)throw Object.assign(Error('Request too large'),{status:413})}try{return raw?JSON.parse(raw):{}}catch{throw Object.assign(Error('Invalid JSON'),{status:400})}}
const clean=(v,n=80)=>typeof v==='string'?v.trim().slice(0,n):'',norm=v=>clean(v,1000).normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
async function hash(p,salt=crypto.randomBytes(16).toString('hex')){return salt+':'+(await scrypt(p,salt,64)).toString('hex')}async function matches(p,e){if(typeof p!=='string'||typeof e!=='string')return false;let [salt,k]=e.split(':');if(!salt||!k)return false;let c=await scrypt(p,salt,64),b=Buffer.from(k,'hex');return b.length===c.length&&crypto.timingSafeEqual(b,c)}
function cookie(age){return 'HttpOnly; SameSite=Strict; Path=/; Max-Age='+age+(process.env.NODE_ENV==='production'?'; Secure':'')}
function session(req,res){let token=Object.prototype.hasOwnProperty.call(req.headers,'x-case-zero-session')?req.headers['x-case-zero-session']:((req.headers.cookie||'').match(/(?:^|;\s*)cz_session=([a-f0-9]+)/)||[])[1];if(Array.isArray(token))token=token[0];let x=typeof token==='string'&&/^[a-f0-9]{64}$/.test(token)?(sessions.get(token)||(store&&store.sessions?store.sessions[token]:null)):null;if(!x||x.expiresAt<Date.now()){if(token){sessions.delete(token);if(store&&store.sessions)delete store.sessions[token]}return null}x.expiresAt=Date.now()+SESSION_MS;sessions.set(token,x);if(store&&store.sessions)store.sessions[token]=x;return{...x,token}}
function create(res,role,id){let t=crypto.randomBytes(32).toString('hex');let s={role,id,expiresAt:Date.now()+SESSION_MS};sessions.set(t,s);if(store){store.sessions=store.sessions||{};store.sessions[t]=s}res.setHeader('X-Case-Zero-Session',t);res.setHeader('Set-Cookie','cz_session='+t+'; '+cookie(SESSION_MS/1000))}function auth(req,res,role){let s=session(req,res);if(!s||(role&&s.role!==role)){fail(res,401,'Your session has expired. Please sign in again.');return null}return s}
const teamFor=id=>store.teams.find(t=>t.id===id),progress=t=>t.submissions.length;
function revealReady(){let c=store.competition||{};if(!c.startedAt)return false;let ts=(c.participantIds||[]).map(teamFor).filter(Boolean);return(ts.length>0&&ts.every(t=>progress(t)===4))||Date.now()>=c.deadline}
function pub(t){return{id:t.id,teamNumber:t.teamNumber,teamName:t.teamName,members:t.members,progress:progress(t),hintsUsed:t.hintsUsed,penalty:t.hintsUsed*10,completedAt:t.completedAt||null,startedAt:t.startedAt||null,deadline:t.deadline||null,approved:!!t.approved,submissions:t.submissions,score:Math.max(0,progress(t)*25-t.hintsUsed*10),finalVerdict:t.finalVerdict||null}}
function stateFor(s){if(s.role==='judge')return{role:'judge',serverTime:Date.now(),winner:store.winner,competition:store.competition,revealReady:revealReady(),solution:officialReveal,rubric:['Who 20 · What 15 · When 15 · How 20 · Why 10 · Evidence 15 · Rejected theory 5','Hint deductions: −10 each, maximum three'],teams:store.teams.map(t=>({...pub(t),leader:t.username,rationale:t.rationale||'',accessCode:t.accessCode}))};let t=teamFor(s.id);if(!t)return null;let done=progress(t)===4,open=revealReady();return{role:'team',serverTime:Date.now(),team:{id:t.id,teamNumber:t.teamNumber,teamName:t.teamName,members:t.members,progress:progress(t),hintsUsed:t.hintsUsed,penalty:t.hintsUsed*10,completedAt:t.completedAt||null,approved:!!t.approved,startedAt:store.competition.startedAt||null,deadline:store.competition.deadline||null,submissions:t.submissions.map(({round,acceptedAt})=>({round,acceptedAt})),score:Math.max(0,progress(t)*25-t.hintsUsed*10),rationale:t.rationale||'',finalVerdict:t.finalVerdict||null},winner:store.winner||null,revealReady:open,revealStatus:open?'UNSEALED':'SEALED',hints:t.hints||[],competition:{...store.competition,participatingTeams:store.competition.participantIds.length,finishedTeams:store.competition.participantIds.filter(id=>progress(teamFor(id)||{submissions:[]})===4).length},round:!t.approved||done||!store.competition.startedAt||Date.now()>=store.competition.deadline?null:roundData[progress(t)],reveal:open?officialReveal:null}}

async function api(req,res,url){let method=req.method,p=url.pathname;
if(method==='GET'&&p==='/api/bootstrap'){json(res,200,{judgeExists:!!store.judge,teamSize:3,judgeSetupAvailable:!store.judge&&!!SETUP_SECRET});return}
if(method==='POST'&&p==='/api/judge/setup'){let b=await body(req),secret=Buffer.from(String(b.setupSecret||'')),expected=Buffer.from(SETUP_SECRET);if(!SETUP_SECRET||secret.length!==expected.length||!crypto.timingSafeEqual(secret,expected))return fail(res,403,'Judge account setup requires the administrator setup secret. Set CASE_ZERO_SETUP_SECRET before first setup.');if(store.judge)return fail(res,409,'The judge account is already configured.');let u=clean(b.username,32),pw=typeof b.password==='string'?b.password:'';if(!/^[A-Za-z0-9_-]{3,32}$/.test(u)||pw.length<12)return fail(res,400,'Choose a 3–32 character username and a password of at least 12 characters.');store.judge={username:u,passwordHash:await hash(pw)};await persist();create(res,'judge','judge');await recordJudgeAction('JUDGE_SETUP',{username:u});json(res,201,{ok:true});return}
if(method==='POST'&&p==='/api/auth/team/register'){if(store.competition.startedAt)return fail(res,409,'Team registration is closed after the competition starts.');let b=await body(req),teamName=clean(b.teamName,60),username=clean(b.username,32),pw=typeof b.password==='string'?b.password:'',members=Array.isArray(b.members)?b.members.map(x=>clean(x,60)).filter(Boolean):[];if(!teamName||!/^[A-Za-z0-9_-]{3,32}$/.test(username)||pw.length<10)return fail(res,400,'Enter a team name, a 3–32 character username, and password of at least 10 characters.');if(members.length!==3||new Set(members.map(x=>x.toLowerCase())).size!==3)return fail(res,400,'Every team must register exactly three different members.');if(store.teams.some(t=>t.username.toLowerCase()===username.toLowerCase()||t.teamName.toLowerCase()===teamName.toLowerCase()))return fail(res,409,'That leader username or team name is already registered.');let t={id:crypto.randomUUID(),teamName,username,passwordHash:await hash(pw),accessCode:crypto.randomBytes(5).toString('hex').toUpperCase(),members,hintsUsed:0,hints:[],submissions:[],rationale:'',completedAt:null,startedAt:null,deadline:null,approved:false,finalVerdict:null};t.teamNumber=store.nextTeamNumber++;while(store.teams.some(x=>x.accessCode===t.accessCode))t.accessCode=crypto.randomBytes(5).toString('hex').toUpperCase();store.teams.push(t);await persist();create(res,'team',t.id);json(res,201,{ok:true,teamName,teamNumber:t.teamNumber,accessCode:t.accessCode});return}
if(method==='POST'&&(p==='/api/auth/team/login'||p==='/api/auth/judge/login')){let ip=req.socket.remoteAddress||'unknown',now=Date.now(),recent=(attempts.get(ip)||[]).filter(x=>now-x<60000);if(recent.length>=12)return fail(res,429,'Too many sign-in attempts. Wait a minute and try again.');recent.push(now);attempts.set(ip,recent);let b=await body(req),u=clean(b.username,32),pw=typeof b.password==='string'?b.password:'';let isJudge=p.endsWith('/judge/login'),account=isJudge?(store.judge&&store.judge.username.toLowerCase()===u.toLowerCase()?store.judge:null):store.teams.find(t=>t.username.toLowerCase()===u.toLowerCase()&&t.accessCode===clean(b.accessCode,20).toUpperCase());if(!account||!(await matches(pw,account.passwordHash)))return fail(res,401,'Those credentials were not recognized.');create(res,isJudge?'judge':'team',isJudge?'judge':account.id);await persist();if(isJudge)await recordJudgeAction('JUDGE_LOGIN',{username:account.username});json(res,200,{ok:true});return}
if(method==='POST'&&p==='/api/auth/logout'){let s=session(req,res);if(s){sessions.delete(s.token);if(store&&store.sessions)delete store.sessions[s.token];await persist()}res.setHeader('Set-Cookie','cz_session=; '+cookie(0));json(res,200,{ok:true});return}
if(method==='GET'&&p==='/api/state'){let s=auth(req,res);if(!s)return;let x=stateFor(s);if(!x)return fail(res,401,'Team account not found.');json(res,200,x);return}
if(method==='POST'&&p==='/api/judge/approve-team'){if(!auth(req,res,'judge'))return;let b=await body(req),t=teamFor(clean(b.teamId,80));if(!t)return fail(res,404,'Select a registered team.');if(store.competition.startedAt)return fail(res,409,'Approvals are closed after competition start.');t.approved=b.approved===true;await persist();await recordJudgeAction('APPROVE_TEAM',{teamId:t.id,teamName:t.teamName});json(res,200,{ok:true,approved:t.approved});return}
if(method==='POST'&&p==='/api/judge/start'){if(!auth(req,res,'judge'))return;if(store.competition.startedAt)return fail(res,409,'The shared competition has already started.');let participants=store.teams.filter(t=>t.approved);if(!participants.length)return fail(res,409,'Approve at least one team before starting.');let startedAt=Date.now(),deadline=startedAt+COMPETITION_MS;store.competition={startedAt,deadline,participantIds:participants.map(t=>t.id)};for(let t of participants){t.startedAt=startedAt;t.deadline=deadline}await persist();await recordJudgeAction('START_COMPETITION',{participatingTeams:participants.length});json(res,200,{ok:true,competition:store.competition});return}
if(method==='POST'&&p==='/api/team/submit'){let s=auth(req,res,'team');if(!s)return;let now=Date.now(),recent=(answerAttempts.get(s.id)||[]).filter(x=>now-x<60000);if(recent.length>=20)return fail(res,429,'Too many answer submissions. Wait a minute and continue.');recent.push(now);answerAttempts.set(s.id,recent);let t=teamFor(s.id),b=await body(req);if(!t.approved||!store.competition.startedAt||!store.competition.participantIds.includes(t.id))return fail(res,409,'The judge has not admitted your team to the competition.');if(now>=store.competition.deadline)return fail(res,410,'The shared competition deadline has passed.');let r=progress(t);if(r>=4)return fail(res,409,'Your final verdict is already recorded.');if(Number(b.round)!==r)return fail(res,409,'That round is not currently unlocked.');let valid=false;if(r<3)valid=norm(b.answer)===norm(roundData[r].answer);else{let v=b.verdict||{},refs=norm(v.evidence);valid=norm(v.who)==='VICTOR HALE'&&refs.includes('PX 03')&&refs.includes('FIN 09')&&refs.includes('AUD ORIG')&&String(v.what||'').trim().length>=20&&String(v.when||'').trim().length>=8&&String(v.how||'').trim().length>=20&&String(v.why||'').trim().length>=20&&String(v.rejected||'').trim().length>=20;if(valid)t.finalVerdict=Object.fromEntries(['who','what','when','how','why','evidence','rejected'].map(k=>[k,clean(v[k],k==='evidence'?500:1000)]))}if(!valid)return json(res,200,{ok:false,correct:false,message:'Your conclusion is not yet supported by the case record.'});t.submissions.push({round:r+1,acceptedAt:now,answer:r===3?'FINAL VERDICT RECEIVED':roundData[r].answer});if(r===3)t.completedAt=now;await persist();json(res,200,{ok:true,correct:true,completed:r===3,revealReady:revealReady(),message:r===3?'FINAL VERDICT RECEIVED. THE CASE REMAINS SEALED UNTIL ALL APPROVED TEAMS FINISH OR THE SHARED DEADLINE EXPIRES.':'Evidence accepted. The next round is unlocked.'});return}
if(method==='POST'&&p==='/api/team/hint'){let s=auth(req,res,'team');if(!s)return;let t=teamFor(s.id);if(!t.approved||!store.competition.startedAt)return fail(res,409,'The judge has not admitted your team to the competition.');if(Date.now()>=store.competition.deadline)return fail(res,410,'The shared competition deadline has passed.');let r=progress(t);if(r>=4)return fail(res,409,'The final verdict is already submitted.');if(t.hintsUsed>=3)return fail(res,409,'Your team has used all three hints.');if(t.hints.some(h=>h.round===r+1))return fail(res,409,'Your team has already requested this round’s hint.');t.hintsUsed++;t.hints.push({round:r+1,text:roundData[r].hint,requestedAt:Date.now()});await persist();json(res,200,{ok:true,hint:roundData[r].hint,hintsUsed:t.hintsUsed,penalty:t.hintsUsed*10});return}
if(method==='POST'&&p==='/api/team/rationale'){let s=auth(req,res,'team');if(!s)return;let t=teamFor(s.id);t.rationale=clean((await body(req)).rationale,2000);await persist();json(res,200,{ok:true});return}
if(method==='POST'&&p==='/api/judge/winner'){if(!auth(req,res,'judge'))return;if(!revealReady())return fail(res,409,'The full reveal is still sealed until all participating teams finish or the shared deadline expires.');let b=await body(req),t=teamFor(clean(b.teamId,80));if(!t||!store.competition.participantIds.includes(t.id))return fail(res,404,'Select a participating team.');store.winner={teamId:t.id,teamName:t.teamName,rationale:clean(b.rationale,1000),announcedAt:Date.now()};await persist();json(res,200,{ok:true,winner:store.winner});return}
return fail(res,404,'Not found')}
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png'};
async function handle(req,res){let url=new URL(req.url,'http://'+(req.headers.host||'localhost'));if(url.pathname.startsWith('/api/')){let job=queue.then(async()=>{store=await load();try{await api(req,res,url)}catch(e){if(e.status)return fail(res,e.status,e.message);console.error(e);if(!res.headersSent)fail(res,500,'The server could not complete that request.')}});queue=job.catch(()=>{});await job;return}if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end()}let relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)),file=path.resolve(PUBLIC,relative);if(!file.startsWith(PUBLIC+path.sep)){res.writeHead(403);return res.end('Forbidden')}if(relative.split(/[\\/]/,1)[0]==='evidence'){res.writeHead(404,{'Cache-Control':'no-store'});return res.end('Not found')}try{let data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(data)}catch(e){res.writeHead(e.code==='ENOENT'?404:500);res.end(e.code==='ENOENT'?'Not found':'Could not load page')}}
async function main(){if(process.env.DATABASE_URL&&!MONGODB_URI)throw new Error('DATABASE_URL is no longer supported. Set MONGODB_URI to use MongoDB.');if(!MONGODB_URI)console.warn('MONGODB_URI is not set; using local JSON storage. Set MONGODB_URI to enable MongoDB persistence.');await initializeDatabase();store=await load();let server=http.createServer((req,res)=>void handle(req,res));server.listen(PORT,HOST,()=>console.log('CASE ZERO listening at http://'+HOST+':'+PORT))}
if(require.main===module){main().catch(e=>{console.error(e);process.exitCode=1});}

const originalApi = api;
const originalAuth = auth;

auth = function (req, res, role) {
  const currentSession = originalAuth(req, res, role);
  if (!currentSession || currentSession.role !== "team") return currentSession;
  const team = teamFor(currentSession.id);
  if (!team) {
    fail(res, 401, "Team account not found.");
    return null;
  }
  if (team.eliminated) {
    fail(res, 403, "This team has been eliminated by the judge. Contact the organizer.");
    return null;
  }
  return currentSession;
};

revealReady = function () {
  const participants = (store.competition.participantIds || []).map(teamFor).filter(Boolean);
  return participants.length > 0 && participants.every((team) =>
    team.eliminated ||
    progress(team) === 4 ||
    (team.deadline && Date.now() >= team.deadline)
  );
};

pub = function (team) {
  return {
    id: team.id,
    teamNumber: team.teamNumber,
    teamName: team.teamName,
    members: team.members,
    progress: progress(team),
    hintsUsed: team.hintsUsed,
    penalty: team.hintsUsed * 10,
    completedAt: team.completedAt || null,
    startedAt: team.startedAt || null,
    deadline: team.deadline || null,
    approved: Boolean(team.approved),
    eliminated: Boolean(team.eliminated),
    submissions: team.submissions,
    score: Math.max(0, progress(team) * 25 - team.hintsUsed * 10),
    finalVerdict: team.finalVerdict || null,
    extensionRequest: team.extensionRequest || null,
    extensionGranted: Boolean(team.extensionGranted)
  };
};

stateFor = function (currentSession) {
  if (currentSession.role === "judge") {
    const participants = (store.competition.participantIds || []).map(teamFor).filter(Boolean);
    return {
      role: "judge",
      serverTime: Date.now(),
      winner: store.winner,
      archivedBatches: store.archivedBatches || [],
      competition: {
        ...store.competition,
        registeredTeamCount: store.teams.filter((team) => !team.eliminated).length,
        loggedInTeamCount: new Set([...sessions.values()]
          .filter((entry) => entry.role === "team" && entry.expiresAt > Date.now())
          .map((entry) => teamFor(entry.id))
          .filter((team) => team && !team.eliminated)
          .map((team) => team.id)).size,
        participatingTeams: participants.length,
        finishedTeams: participants.filter((team) =>
          team.eliminated || progress(team) === 4 || (team.deadline && Date.now() >= team.deadline)
        ).length
      },
      revealReady: revealReady(),
      solution: officialReveal,
      rubric: ["Who 20 · What 15 · When 15 · How 20 · Why 10 · Evidence 15 · Rejected theory 5", "Hint deductions: −10 each, maximum three"],
      teams: store.teams.map((team) => ({
        ...pub(team),
        leader: team.username,
        rationale: team.rationale || "",
        accessCode: team.accessCode,
        focusEvents: team.focusEvents || [],
        extensionRequest: team.extensionRequest || null,
        extensionGranted: Boolean(team.extensionGranted)
      }))
    };
  }

  const team = teamFor(currentSession.id);
  if (!team) return null;
  const isComplete = progress(team) === 4;
  const isParticipant = (store.competition.participantIds || []).includes(team.id);
  const hasStarted = Boolean(team.startedAt && isParticipant && team.approved && !team.eliminated);
  const deadlinePassed = hasStarted && Date.now() >= team.deadline;
  const canSeeRound = hasStarted && !isComplete && !deadlinePassed;
  const open = revealReady();
  return {
    role: "team",
    serverTime: Date.now(),
    team: {
      id: team.id,
      teamNumber: team.teamNumber,
      teamName: team.teamName,
      members: team.members,
      progress: progress(team),
      hintsUsed: team.hintsUsed,
      penalty: team.hintsUsed * 10,
      completedAt: team.completedAt || null,
      approved: Boolean(team.approved),
      startedAt: team.startedAt || null,
      deadline: team.deadline || null,
      submissions: team.submissions.map(({ round, acceptedAt }) => ({ round, acceptedAt })),
      score: Math.max(0, progress(team) * 25 - team.hintsUsed * 10),
      rationale: team.rationale || "",
      finalVerdict: team.finalVerdict || null,
      extensionRequest: team.extensionRequest || null,
      extensionGranted: Boolean(team.extensionGranted),
      unlockedRounds: roundData.slice(0, progress(team)).map((round, index) => ({
        ...round,
        submission: team.submissions[index] || null,
        verdict: index === 3 ? team.finalVerdict || null : null
      }))
    },
    winner: store.winner || null,
    revealReady: open,
    revealStatus: open ? "UNSEALED" : "SEALED",
    hints: team.hints || [],
    competition: {
      ...store.competition,
      startedAt: team.startedAt || null,
      deadline: team.deadline || null,
      participatingTeams: (store.competition.participantIds || []).length,
      finishedTeams: (store.competition.participantIds || []).filter((id) => {
        const participant = teamFor(id);
        return participant && (participant.eliminated || progress(participant) === 4 || (participant.deadline && Date.now() >= participant.deadline));
      }).length
    },
    round: canSeeRound ? roundData[progress(team)] : null,
    reveal: open ? officialReveal : null
  };
};

api = async function (req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/bootstrap") {
    json(res, 200, {
      judgeExists: Boolean(store.judge),
      teamSize: 3,
      maxTeams: MAX_TEAMS,
      registeredTeamCount: store.teams.length,
      judgeSetupAvailable: !store.judge && Boolean(SETUP_SECRET)
    });
    return;
  }

  if (method === "POST" && pathname === "/api/auth/team/register" && store.teams.length >= MAX_TEAMS) {
    return fail(res, 409, `The competition has reached its limit of ${MAX_TEAMS} registered teams.`);
  }

  if (method === "GET" && pathname === "/api/state") {
    const currentSession = auth(req, res);
    if (!currentSession) return;
    if (currentSession.role === "team") {
      const team = teamFor(currentSession.id);
      const isParticipant = (store.competition.participantIds || []).includes(team.id);
      if (team.approved && store.competition.startedAt && !isParticipant &&
          Date.now() < store.competition.deadline && !revealReady()) {
        team.startedAt = store.competition.startedAt;
        team.deadline = store.competition.deadline;
        store.competition.participantIds = [...(store.competition.participantIds || []), team.id];
        await persist();
      }
    }
    const result = stateFor(currentSession);
    if (!result) return fail(res, 401, "Team account not found.");
    json(res, 200, result);
    return;
  }

  if (method === "POST" && pathname === "/api/judge/start-for-all") {
    if (!auth(req, res, "judge")) return;
    if (store.competition.startedAt) return fail(res, 409, "The shared competition has already started and cannot be reset.");
    const now = Date.now();
    const participants = store.teams.filter((team) => !team.eliminated);
    if (!participants.length) return fail(res, 409, "No eligible teams are registered.");
    const startedAt = now;
    const deadline = startedAt + COMPETITION_MS;
    store.competition = { startedAt, deadline, participantIds: participants.map((team) => team.id) };
    for (const team of participants) {
      team.approved = true;
      team.startedAt = startedAt;
      team.deadline = deadline;
    }
    await persist();
    await recordJudgeAction("START_COMPETITION_FOR_ALL", { participatingTeams: participants.length, startedAt, deadline });
    json(res, 200, { ok: true, startedAt, deadline, participatingTeams: participants.length });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/start-new-batch") {
    if (!auth(req, res, "judge")) return;
    if (!store.competition.startedAt || !revealReady()) {
      return fail(res, 409, "The current batch must be over before a new batch can start.");
    }
    const completedAt = Date.now();
    const archivedBatches = store.archivedBatches || [];
    const batchNumber = archivedBatches.reduce((highest, batch) =>
      Math.max(highest, Number(batch.batchNumber) || 0), 0) + 1;
    archivedBatches.push({
      batchNumber,
      archivedAt: completedAt,
      competition: JSON.parse(JSON.stringify(store.competition)),
      winner: store.winner || null,
      teams: store.teams.map(({ passwordHash, accessCode, ...team }) => ({
        ...JSON.parse(JSON.stringify(team)),
        progress: progress(team),
        score: Math.max(0, progress(team) * 25 - team.hintsUsed * 10)
      }))
    });
    store.archivedBatches = archivedBatches;
    store.teams = [];
    store.nextTeamNumber = 1;
    store.winner = null;
    store.competition = { startedAt: null, deadline: null, participantIds: [] };
    for (const [token, activeSession] of sessions) {
      if (activeSession.role === "team") sessions.delete(token);
    }
    await persist();
    await recordJudgeAction("START_NEW_BATCH", { archivedBatchNumber: archivedBatches.at(-1).batchNumber });
    json(res, 200, {
      ok: true,
      archivedBatchNumber: archivedBatches.at(-1).batchNumber,
      archivedTeamCount: archivedBatches.at(-1).teams.length
    });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/delete-archived-batch") {
    if (!auth(req, res, "judge")) return;
    const data = await body(req);
    const batchNumber = Number(data.batchNumber);
    if (!Number.isSafeInteger(batchNumber) || batchNumber < 1) {
      return fail(res, 400, "Select a valid archived batch.");
    }
    const archivedBatches = store.archivedBatches || [];
    const batchIndex = archivedBatches.findIndex((batch) => batch.batchNumber === batchNumber);
    if (batchIndex < 0) return fail(res, 404, "That archived batch was not found.");
    archivedBatches.splice(batchIndex, 1);
    store.archivedBatches = archivedBatches;
    await persist();
    await recordJudgeAction("DELETE_ARCHIVED_BATCH", { batchNumber });
    json(res, 200, { ok: true, deletedBatchNumber: batchNumber });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/approve-team") {
    if (!auth(req, res, "judge")) return;
    const data = await body(req);
    const team = teamFor(clean(data.teamId, 80));
    if (!team) return fail(res, 404, "Select a registered team.");
    if (team.eliminated) return fail(res, 409, "An eliminated team cannot be admitted.");
    if (team.approved) return fail(res, 409, "This team has already been approved.");
    if (data.approved !== true) return fail(res, 400, "Team approval must be explicit.");
    if (store.competition.startedAt) {
      if (Date.now() >= store.competition.deadline || revealReady()) {
        return fail(res, 409, "The shared competition window or reveal has closed; this team cannot join.");
      }
      team.approved = true;
      team.startedAt = store.competition.startedAt;
      team.deadline = store.competition.deadline;
      store.competition.participantIds = [...new Set([...(store.competition.participantIds || []), team.id])];
    } else {
      team.approved = true;
    }
    await persist();
    await recordJudgeAction("APPROVE_TEAM", { teamId: team.id, teamName: team.teamName });
    json(res, 200, { ok: true, approved: true, startedAt: team.startedAt, deadline: team.deadline });
    return;
  }

  if (method === "POST" && pathname === "/api/team/request-extension") {
    const currentSession = auth(req, res, "team");
    if (!currentSession) return;
    const team = teamFor(currentSession.id);
    const now = Date.now();
    if (!team.approved || !(store.competition.participantIds || []).includes(team.id) || !team.deadline) {
      return fail(res, 409, "Your team must be admitted to the competition before requesting more time.");
    }
    if (progress(team) >= 4 || now >= team.deadline) {
      return fail(res, 410, "Extensions can only be requested during an active investigation.");
    }
    if (team.extensionGranted || (team.extensionRequest && team.extensionRequest.status === "approved")) {
      return fail(res, 409, "Your team has already received its one 15-minute extension.");
    }
    if (team.extensionRequest && team.extensionRequest.status === "pending") {
      return fail(res, 409, "Your extension request is already waiting for the judge.");
    }
    team.extensionRequest = { status: "pending", requestedAt: now, decidedAt: null };
    await persist();
    json(res, 200, { ok: true, extensionRequest: team.extensionRequest });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/extension-decision") {
    if (!auth(req, res, "judge")) return;
    const data = await body(req);
    const team = teamFor(clean(data.teamId, 80));
    const decision = clean(data.decision, 16);
    if (!team) return fail(res, 404, "Select a registered team.");
    if (!["approve", "reject"].includes(decision)) return fail(res, 400, "Choose approve or reject.");
    if (!team.extensionRequest || team.extensionRequest.status !== "pending") {
      return fail(res, 409, "This team has no pending extension request.");
    }
    const now = Date.now();
    if (decision === "approve") {
      if (team.extensionGranted || !team.deadline || team.completedAt || progress(team) >= 4) {
        return fail(res, 409, "This team cannot receive another extension.");
      }
      if (now >= team.deadline) return fail(res, 410, "This team's deadline has passed; an extension can no longer be applied.");
      team.deadline += 15 * 60 * 1000;
      team.extensionGranted = true;
    }
    team.extensionRequest = { ...team.extensionRequest, status: decision === "approve" ? "approved" : "rejected", decidedAt: now };
    await persist();
    await recordJudgeAction("EXTENSION_DECISION", { teamId: team.id, teamName: team.teamName, decision, deadline: team.deadline });
    json(res, 200, { ok: true, status: team.extensionRequest.status, deadline: team.deadline });
    return;
  }

  const artifactMatch = method === "GET" && pathname.match(/^\/api\/evidence\/round-([1-4])\/([a-z0-9-]+\.(?:txt|log|eml|csv|svg))$/);
  if (artifactMatch) {
    const currentSession = auth(req, res, "team");
    if (!currentSession) return;
    const team = teamFor(currentSession.id);
    const roundNumber = Number(artifactMatch[1]);
    const fileName = artifactMatch[2];
    if (!team || !team.approved || team.eliminated ||
        !(store.competition.participantIds || []).includes(team.id)) {
      return fail(res, 403, "Only an admitted team can access case evidence.");
    }
    if (!evidenceFiles[roundNumber].includes(fileName)) {
      return fail(res, 404, "Evidence file not found.");
    }
    if (roundNumber > progress(team) + 1) {
      return fail(res, 403, "This evidence file is still restricted.");
    }
    if (roundNumber === progress(team) + 1 && (!team.deadline || Date.now() >= team.deadline)) {
      return fail(res, 410, "Your team's case-file deadline has passed.");
    }

    const evidencePath = path.join(PUBLIC, "evidence", `round-${roundNumber}`, fileName);
    const contentTypes = {
      ".csv": "text/csv; charset=utf-8",
      ".eml": "text/plain; charset=utf-8",
      ".log": "text/plain; charset=utf-8",
      ".svg": "image/svg+xml",
      ".txt": "text/plain; charset=utf-8"
    };
    try {
      const content = await fs.readFile(evidencePath);
      res.writeHead(200, {
        "Content-Type": contentTypes[path.extname(fileName)],
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox"
      });
      res.end(content);
    } catch (error) {
      if (error.code === "ENOENT") return fail(res, 404, "Evidence file not found.");
      throw error;
    }
    return;
  }

  if (method === "POST" && pathname === "/api/auth/team/register") {
    const data = await body(req);
    const teamName = clean(data.teamName, 60);
    const username = clean(data.username, 32);
    const password = typeof data.password === "string" ? data.password : "";
    const members = Array.isArray(data.members) ? data.members.map((name) => clean(name, 60)).filter(Boolean) : [];
    if (!teamName || !/^[A-Za-z0-9_-]{3,32}$/.test(username) || password.length < 10) {
      return fail(res, 400, "Enter a team name, a 3–32 character username, and password of at least 10 characters.");
    }
    if (members.length !== 3 || new Set(members.map((member) => member.toLowerCase())).size !== 3) {
      return fail(res, 400, "Every team must register exactly three different members.");
    }
    if (store.teams.some((team) =>
      team.username.toLowerCase() === username.toLowerCase() ||
      team.teamName.toLowerCase() === teamName.toLowerCase()
    )) {
      return fail(res, 409, "That leader username or team name is already registered.");
    }
    const team = {
      id: crypto.randomUUID(),
      teamNumber: store.nextTeamNumber++,
      teamName,
      username,
      passwordHash: await hash(password),
      accessCode: crypto.randomBytes(5).toString("hex").toUpperCase(),
      members,
      hintsUsed: 0,
      hints: [],
      submissions: [],
      rationale: "",
      completedAt: null,
      startedAt: null,
      deadline: null,
      approved: false,
      eliminated: false,
      finalVerdict: null
    };

    while (store.teams.some((existing) => existing.accessCode === team.accessCode)) {
      team.accessCode = crypto.randomBytes(5).toString("hex").toUpperCase();
    }
    store.teams.push(team);
    await persist();
    create(res, "team", team.id);
    json(res, 201, { ok: true, teamName, teamNumber: team.teamNumber, accessCode: team.accessCode });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/approve-team") {
    if (!auth(req, res, "judge")) return;
    const data = await body(req);
    const team = teamFor(clean(data.teamId, 80));
    if (!team) return fail(res, 404, "Select a registered team.");
    if (team.eliminated) return fail(res, 409, "An eliminated team cannot be admitted.");
    if (team.approved) return fail(res, 409, "This team has already been approved.");

    team.approved = true;
    if (store.competition.startedAt) {
      if (revealReady()) {
        team.approved = false;
        return fail(res, 409, "The case reveal is already open; no additional teams can join this game.");
      }
      team.startedAt = Date.now();
      team.deadline = team.startedAt + COMPETITION_MS;
      store.competition.participantIds = [...new Set([...(store.competition.participantIds || []), team.id])];
    }
    await persist();
    await recordJudgeAction("APPROVE_TEAM", { teamId: team.id, teamName: team.teamName });
    json(res, 200, { ok: true, approved: true, startedAt: team.startedAt, deadline: team.deadline });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/clear-teams") {
    if (!auth(req, res, "judge")) return;
    store.teams = [];
    store.nextTeamNumber = 1;
    store.winner = null;
    store.competition.participantIds = [];
    for (const [token, activeSession] of sessions) {
      if (activeSession.role === "team") sessions.delete(token);
    }
    await persist();
    await recordJudgeAction("CLEAR_TEAMS", {});
    json(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/eliminate-team") {
    if (!auth(req, res, "judge")) return;
    const data = await body(req);
    const team = teamFor(clean(data.teamId, 80));
    if (!team) return fail(res, 404, "Select a registered team.");
    if (team.eliminated) return fail(res, 409, "This team has already been eliminated.");
    team.eliminated = true;
    team.eliminatedAt = Date.now();
    if (store.winner && store.winner.teamId === team.id) store.winner = null;
    await persist();
    await recordJudgeAction("ELIMINATE_TEAM", { teamId: team.id, teamName: team.teamName });
    json(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/remove-team") {
    if (!auth(req, res, "judge")) return;
    const data = await body(req);
    const teamId = clean(data.teamId, 80);
    const team = teamFor(teamId);
    if (!team) return fail(res, 404, "Select a registered team.");

    store.teams = store.teams.filter((existing) => existing.id !== teamId);
    store.competition.participantIds = (store.competition.participantIds || []).filter((id) => id !== teamId);
    if (store.winner && store.winner.teamId === teamId) store.winner = null;
    for (const [token, activeSession] of sessions) {
      if (activeSession.role === "team" && activeSession.id === teamId) sessions.delete(token);
    }
    await persist();
    await recordJudgeAction("REMOVE_TEAM", { teamId, teamName: team ? team.teamName : teamId });
    json(res, 200, { ok: true, removedTeamId: teamId });
    return;
  }

  if (method === "POST" && pathname === "/api/team/focus-event") {
    const currentSession = auth(req, res, "team");
    if (!currentSession) return;
    const team = teamFor(currentSession.id);
    const data = await body(req);
    const eventId = clean(data.eventId, 64);
    const phase = data.phase;
    const source = data.source;
    if (!/^[a-f0-9-]{36}$/i.test(eventId) || !["away", "return"].includes(phase) ||
        !["window-blur", "tab-hidden"].includes(source)) {
      return fail(res, 400, "Invalid focus event.");
    }
    if (!team) return fail(res, 404, "Team account not found.");
    const now = Date.now();
    if (phase === "away" && (!team.approved || team.eliminated || progress(team) >= 4 ||
        revealReady() || !(store.competition.participantIds || []).includes(team.id) ||
        !team.startedAt || now >= team.deadline)) {
      return fail(res, 409, "Focus monitoring is available only during your active team timer.");
    }
    team.focusEvents = team.focusEvents || [];
    let event = team.focusEvents.find((item) => item.id === eventId);
    if (phase === "away") {
      if (!event) {
        event = { id: eventId, awayAt: now, returnedAt: null, durationMs: null, source };
        team.focusEvents.push(event);
        if (team.focusEvents.length > 200) team.focusEvents.shift();
      }
    } else if (!event) {
      return fail(res, 404, "The matching focus-away event was not found.");
    } else if (event.awayAt && !event.returnedAt) {
      event.returnedAt = now;
      event.durationMs = Math.max(0, now - event.awayAt);
    }
    await persist();
    json(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && (pathname === "/api/team/submit" || pathname === "/api/team/hint")) {
    const currentSession = auth(req, res, "team");
    if (!currentSession) return;
    const team = teamFor(currentSession.id);
    if (!team.approved || !(store.competition.participantIds || []).includes(team.id) || !team.startedAt) {
      return fail(res, 409, "The judge has not admitted your team to the competition.");
    }
    const now = Date.now();
    if (now >= team.deadline) return fail(res, 410, "Your team's 60-minute deadline has passed.");

    if (pathname === "/api/team/hint") {
      const round = progress(team);
      if (round >= 4) return fail(res, 409, "The final verdict is already submitted.");
      if (team.hintsUsed >= 3) return fail(res, 409, "Your team has used all three hints.");
      if (team.hints.some((hint) => hint.round === round + 1)) return fail(res, 409, "Your team has already requested this round's hint.");
      team.hintsUsed += 1;
      team.hints.push({ round: round + 1, text: roundData[round].hint, requestedAt: now });
      await persist();
      json(res, 200, { ok: true, hint: roundData[round].hint, hintsUsed: team.hintsUsed, penalty: team.hintsUsed * 10 });
      return;
    }

    const recent = (answerAttempts.get(team.id) || []).filter((time) => now - time < 60_000);
    if (recent.length >= 20) return fail(res, 429, "Too many answer submissions. Wait a minute and continue.");
    recent.push(now);
    answerAttempts.set(team.id, recent);
    const data = await body(req);
    const round = progress(team);
    if (round >= 4) return fail(res, 409, "Your final verdict is already recorded.");
    if (Number(data.round) !== round) return fail(res, 409, "That round is not currently unlocked.");
    let valid = false;
    if (round < 3) {
      valid = norm(data.answer) === norm(roundData[round].answer);
    } else {
      const verdict = data.verdict || {};
      const refs = norm(verdict.evidence);
      valid = norm(verdict.who) === "VICTOR HALE" &&
        refs.includes("PX 03") && refs.includes("FIN 09") && refs.includes("AUD ORIG") &&
        String(verdict.what || "").trim().length >= 20 &&
        String(verdict.when || "").trim().length >= 8 &&
        String(verdict.how || "").trim().length >= 20 &&
        String(verdict.why || "").trim().length >= 20 &&
        String(verdict.rejected || "").trim().length >= 20;
      if (valid) {
        team.finalVerdict = Object.fromEntries(
          ["who", "what", "when", "how", "why", "evidence", "rejected"].map((key) => [
            key,
            clean(verdict[key], key === "evidence" ? 500 : 1000)
          ])
        );
      }
    }
    if (!valid) return json(res, 200, { ok: false, correct: false, message: "Your conclusion is not yet supported by the case record." });
    team.submissions.push({ round: round + 1, acceptedAt: now, answer: round === 3 ? "FINAL VERDICT RECEIVED" : roundData[round].answer });
    if (round === 3) team.completedAt = now;
    await persist();
    json(res, 200, {
      ok: true,
      correct: true,
      completed: round === 3,
      revealReady: revealReady(),
      message: round === 3 ? "Final verdict received." : "Evidence accepted. The next round is unlocked."
    });
    return;
  }

  if (method === "POST" && pathname === "/api/judge/winner") {
    if (!auth(req, res, "judge")) return;
    if (!revealReady()) return fail(res, 409, "The full reveal is still sealed until participating teams finish or their deadlines expire.");
    const data = await body(req);
    const team = teamFor(clean(data.teamId, 80));
    if (!team || !(store.competition.participantIds || []).includes(team.id) || team.eliminated || progress(team) !== 4) {
      return fail(res, 404, "Select a non-eliminated participating team that completed all four rounds.");
    }
    store.winner = {
      teamId: team.id,
      teamName: team.teamName,
      rationale: clean(data.rationale, 1000),
      announcedAt: Date.now()
    };
    await persist();
    await recordJudgeAction("ANNOUNCE_WINNER", { teamId: team.id, teamName: team.teamName, rationale: store.winner.rationale });
    json(res, 200, { ok: true, winner: store.winner });
    return;
  }

  return originalApi(req, res, url);
};

// Export the main request handler function for Vercel
module.exports = handle;

// Attach your other functions to module.exports so they remain accessible if needed
module.exports.initializeDatabase = initializeDatabase;
module.exports.load = load;
module.exports.persist = persist;
module.exports.syncSubCollections = syncSubCollections;
module.exports.getStore = () => store;