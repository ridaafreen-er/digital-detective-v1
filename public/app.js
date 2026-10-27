(() => {
  const byId = (id) => document.getElementById(id);
  const app = byId("app");
  const gate = byId("opening-screen");
  const toastRegion = byId("toast-region");
  const PREF_KEY = "case-zero-audio-v1";
  const evidenceArtifacts = {
    1: [
      ["scene-report.txt", "SC-01 · Incident scene report", "Discovery report and custody notes."],
      ["device-clock.log", "PX-03 · Device clock diagnostic", "Shows the wall clock's seven-minute offset."],
      ["qr-inventory.svg", "ER-02 · Scannable inventory QR", "Actual QR code for the original inventory export receipt."],
      ["qr-inventory-label.txt", "ER-02 · QR payload record", "Archive transcription and timestamp details for the QR label."],
      ["scene-photo.svg", "PX-03 · Scene photograph", "Illustrated evidence image of the stopped wristwatch."]
    ],
    2: [
      ["account-access.log", "LOG-11 · Access-control log", "Door access, camera outage, and archive events."],
      ["mail-07.eml", "MAIL-07 · Recovered email", "Original email with its encoded subject field."],
      ["adrian-calendar.txt", "CAL-04 · Calendar export", "Calendar entry and scanned handwritten margin."],
      ["audit-integrity.txt", "AUDIT-ORIG · Integrity comparison", "Comparison of the immutable original and modified export."]
    ],
    3: [
      ["interview-transcripts.txt", "INT-01–05 · Interview transcripts", "Five statements with independent record checks."],
      ["cross-chat.txt", "Recovered · Adrian and Reed chat", "Internal message thread about the camera outage and archive."],
      ["transfer-ledger.csv", "FIN-09 · Grant transfer ledger", "Downloadable CSV of relevant fictional grant transfers."],
      ["entity-registry.txt", "REG-8841 · Entity registry", "Cross-reference the ledger destination and authorization identifiers."],
      ["authorization-roster.txt", "HR-02 · Authorization roster", "Map internal authorization and archive credentials to account holders."],
      ["suspect-contact-sheet.svg", "INT-01–05 · Suspect contact sheet", "Viewable illustrated portraits of the five suspects."]
    ],
    4: [
      ["audit-fragment.log", "AUD-ORIG · Immutable audit fragment", "Server-time event sequence and clock-reconciliation note."],
      ["final-evidence-index.txt", "CZ-09 · Final evidence index", "Neutral filing guide for correlating evidence across rounds."],
      ["verdict-worksheet.txt", "CZ-09 · Final verdict worksheet", "Checklist for assembling and supporting your team's final verdict."],
      ["voice-transcript.txt", "VM-114 · Security voicemail transcript", "Recovered dispatch recording transcription."],
      ["checksum-manifest.txt", "CZ-09 · Evidence checksum manifest", "Status index for the recovered fictional case files."]
    ]
  };
  const SESSION_KEY = "case-zero-tab-session-v1";
  let tabSessionToken = "";
  try {
    tabSessionToken = sessionStorage.getItem(SESSION_KEY) || "";
  } catch (error) {
    console.warn("This tab cannot restore its sign-in session from browser storage.", error);
  }
  let bootstrap = { judgeExists: false, teamSize: 3, maxTeams: 100, registeredTeamCount: 0 };
  let state = null;
  let activeTab = "team-login";
  let registrationCode = "";
  let serverOffset = 0;
  let hintOutput = "";
  let timerHandle = null;
  let gateEntered = false;
  let viewedRoundIndex = 0;
  let knownExtensionRequests = new Set();
  let loadedJudgeExtensionRequests = false;
  let focusAwayEventId = null;
  let focusAwaySource = null;
  let focusEventQueue = Promise.resolve();

  function loadPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
      return {
        master: saved && typeof saved.master === "boolean" ? saved.master : true,
        ambience: saved && typeof saved.ambience === "boolean" ? saved.ambience : true,
        interface: saved && typeof saved.interface === "boolean" ? saved.interface : true,
        volume: saved && Number.isFinite(saved.volume) ? Math.min(.35, Math.max(0, saved.volume)) : .14
      };
    } catch {
      return { master: true, ambience: true, interface: true, volume: .14 };
    }
  }

  const prefs = loadPreferences();

  function savePreferences() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch (error) {
      console.warn("Audio preferences could not be saved in this browser.", error);
    }
    syncSoundControls();
  }

  function syncSoundControls() {
    byId("sound-toggle").setAttribute("aria-pressed", String(prefs.master));
    byId("sound-toggle").setAttribute("aria-label", prefs.master ? "Turn sound off" : "Turn sound on");
    byId("sound-label").textContent = prefs.master ? "SOUND ON" : "SOUND OFF";
    byId("master-setting").checked = prefs.master;
    byId("ambience-setting").checked = prefs.ambience;
    byId("interface-setting").checked = prefs.interface;
    byId("volume-setting").value = String(prefs.volume);
  }

  class AudioManager {
    constructor() {
      this.context = null;
      this.masterGain = null;
      this.ambienceGain = null;
      this.ambientOscillators = [];
      this.ambientNodes = [];
      this.ambientStarted = false;
      this.ambientInterval = null;
      this.activeEffects = new Set();
      this.lastEffectAt = 0;
    }

    async prepare() {
      if (!prefs.master) return false;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      if (!this.context) {
        this.context = new AudioContextClass();
        this.masterGain = this.context.createGain();
        this.ambienceGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);
        this.ambienceGain.connect(this.masterGain);
        this.startDrone();
      }
      try {
        if (this.context.state !== "running") await this.context.resume();
        this.updateLevels();
        return this.context.state === "running";
      } catch {
        return false;
      }
    }

    startDrone() {
      if (!this.context || this.ambientStarted) return;
      const low = this.context.createOscillator();
      const high = this.context.createOscillator();
      const shimmer = this.context.createOscillator();
      const pulse = this.context.createOscillator();
      const lowGain = this.context.createGain();
      const highGain = this.context.createGain();
      const shimmerGain = this.context.createGain();
      const pulseGain = this.context.createGain();
      const lowPass = this.context.createBiquadFilter();
      const noiseFilter = this.context.createBiquadFilter();
      const noiseGain = this.context.createGain();
      const noiseSource = this.context.createBufferSource();
      const noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * 3, this.context.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let index = 0; index < noiseData.length; index += 1) {
        noiseData[index] = (Math.random() * 2 - 1) * .5;
      }
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;
      low.type = "sine";
      low.frequency.value = 43.7;
      high.type = "triangle";
      high.frequency.value = 56.2;
      high.detune.value = -11;
      shimmer.type = "sine";
      shimmer.frequency.value = 87.3;
      pulse.type = "sine";
      pulse.frequency.value = .075;
      lowGain.gain.value = .2;
      highGain.gain.value = .045;
      shimmerGain.gain.value = .009;
      pulseGain.gain.value = .025;
      lowPass.type = "lowpass";
      lowPass.frequency.value = 210;
      noiseFilter.type = "lowpass";
      noiseFilter.frequency.value = 520;
      noiseFilter.Q.value = .55;
      noiseGain.gain.value = .014;
      low.connect(lowGain);
      high.connect(highGain);
      shimmer.connect(shimmerGain);
      lowGain.connect(lowPass);
      highGain.connect(lowPass);
      shimmerGain.connect(lowPass);
      lowPass.connect(this.ambienceGain);
      pulse.connect(pulseGain);
      pulseGain.connect(lowGain.gain);
      pulseGain.gain.value = .025;
      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(this.ambienceGain);
      low.start();
      high.start();
      shimmer.start();
      pulse.start();
      noiseSource.start();
      this.ambientOscillators = [low, high, shimmer, pulse];
      this.ambientNodes = [lowGain, highGain, shimmerGain, pulseGain, lowPass, noiseFilter, noiseGain, noiseSource];
      this.ambientStarted = true;
      this.ambientInterval = window.setInterval(() => {
        if (!prefs.master || !prefs.ambience || document.hidden || !this.context || this.context.state !== "running") return;
        if (Math.random() < .72) {
          const sounds = ["static", "knock", "creak"];
          this.effect(sounds[Math.floor(Math.random() * sounds.length)], true);
        }
      }, 16000);
      this.updateLevels();
    }

    updateLevels() {
      if (!this.context || !this.masterGain || !this.ambienceGain) return;
      const now = this.context.currentTime;
      const master = prefs.master ? prefs.volume : 0;
      this.masterGain.gain.setTargetAtTime(master, now, .07);
      this.ambienceGain.gain.setTargetAtTime(prefs.ambience ? .8 : 0, now, .15);
    }

    async enable() {
      if (!prefs.master) return false;
      const ready = await this.prepare();
      this.updateLevels();
      return ready;
    }

    async suspend() {
      if (this.context && this.context.state === "running") {
        try { await this.context.suspend(); } catch { /* Browser may already be closing the context. */ }
      }
    }

    async resumeForVisibility() {
      if (prefs.master && !document.hidden) await this.enable();
    }

    effect(kind, ambient = false) {
      if (!this.context || this.context.state !== "running" || !prefs.master || (!ambient && !prefs.interface) || (ambient && !prefs.ambience)) return;
      const nowMs = performance.now();
      if (!ambient && nowMs - this.lastEffectAt < 100) return;
      this.lastEffectAt = nowMs;
      const ctx = this.context;
      const now = ctx.currentTime;
      const group = ctx.createGain();
      group.gain.value = 0;
      group.connect(ambient ? this.ambienceGain : this.masterGain);

      for (const previous of this.activeEffects) {
        try {
          previous.gain.cancelScheduledValues(now);
          previous.gain.setTargetAtTime(0, now, .025);
          previous.stopAt = now + .15;
        } catch { /* The effect may have completed between events. */ }
      }

      const sounds = {
        click: { wave: "square", start: 720, end: 410, duration: .055, gain: .075 },
        confirm: { wave: "sine", start: 165, end: 520, duration: .28, gain: .11 },
        login: { wave: "triangle", start: 125, end: 390, duration: .23, gain: .1 },
        file: { wave: "triangle", start: 92, end: 54, duration: .2, gain: .11 },
        unlock: { wave: "sawtooth", start: 180, end: 680, duration: .3, gain: .075 },
        correct: { wave: "sine", start: 392, end: 587, duration: .3, gain: .09 },
        incorrect: { wave: "sawtooth", start: 115, end: 67, duration: .2, gain: .075 },
        hint: { wave: "triangle", start: 280, end: 130, duration: .23, gain: .065 },
        submit: { wave: "sine", start: 85, end: 145, duration: .38, gain: .1 },
        finalize: { wave: "sine", start: 62, end: 130, duration: .52, gain: .12 },
        transition: { wave: "triangle", start: 110, end: 440, duration: .5, gain: .1 },
        reveal: { wave: "sawtooth", start: 48, end: 330, duration: .85, gain: .075 },
        static: { wave: "sawtooth", start: 980, end: 190, duration: .24, gain: .045 },
        knock: { wave: "sine", start: 78, end: 42, duration: .19, gain: .045 },
        creak: { wave: "triangle", start: 190, end: 72, duration: .72, gain: .032 }
      };
      const sound = sounds[kind] || sounds.click;
      const oscillator = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      oscillator.type = sound.wave;
      oscillator.frequency.setValueAtTime(sound.start, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, sound.end), now + sound.duration);
      filter.type = "lowpass";
      filter.frequency.value = kind === "static" ? 1300 : 1100;
      oscillator.connect(filter);
      filter.connect(group);
      const attenuation = ambient ? .46 : 1;
      group.gain.setValueAtTime(0, now);
      group.gain.linearRampToValueAtTime(sound.gain * attenuation, now + Math.min(.035, sound.duration / 3));
      group.gain.exponentialRampToValueAtTime(.001, now + sound.duration);
      oscillator.start(now);
      oscillator.stop(now + sound.duration + .02);
      const entry = {
        gain: group.gain,
        stopAt: now + sound.duration + .03,
        cleanup: () => {
          try { oscillator.disconnect(); filter.disconnect(); group.disconnect(); } catch { /* Nodes can already be disconnected. */ }
          this.activeEffects.delete(entry);
        }
      };
      this.activeEffects.add(entry);
      window.setTimeout(entry.cleanup, (sound.duration + .1) * 1000);
    }
  }

  const audio = new AudioManager();

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function toast(message, kind = "") {
    const item = document.createElement("div");
    item.className = `toast ${kind ? `is-${kind}` : ""}`;
    item.textContent = message;
    toastRegion.append(item);
    window.setTimeout(() => item.remove(), 4500);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      method: options.method || "GET",
      credentials: "omit",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        "X-Case-Zero-Session": tabSessionToken
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      keepalive: Boolean(options.keepalive)
    });
    const issuedToken = response.headers.get("X-Case-Zero-Session");
    if (issuedToken) {
      tabSessionToken = issuedToken;
      try {
        sessionStorage.setItem(SESSION_KEY, issuedToken);
      } catch (error) {
        console.warn("The sign-in session will last only until this page is closed.", error);
      }
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`The server returned an unreadable response (${response.status}).`);
    }
    if (!response.ok) {
      if (path === "/api/state" && response.status === 401) {
        tabSessionToken = "";
        try {
          sessionStorage.removeItem(SESSION_KEY);
        } catch (error) {
          console.warn("The expired tab session could not be cleared from browser storage.", error);
        }
      }
      throw new Error(result.error || `Request failed (${response.status}).`);
    }
    if (["/api/auth/team/login", "/api/auth/judge/login", "/api/auth/team/register", "/api/judge/setup"].includes(path) && !issuedToken) {
      throw new Error("The server is running an older version. Stop it with Ctrl+C, then restart it using npm start before signing in.");
    }
    if (path === "/api/auth/logout") {
      tabSessionToken = "";
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch (error) {
        console.warn("The disconnected tab session could not be cleared from browser storage.", error);
      }
    }
    return result;
  }

  function activeDeadline() {
    return Number(state && state.competition && state.competition.deadline) || 0;
  }

  function remainingMs() {
    return activeDeadline() ? Math.max(0, activeDeadline() - (Date.now() + serverOffset)) : 0;
  }

  function formatTime(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function setState(next) {
    state = next;
    if (Number.isFinite(next.serverTime)) serverOffset = next.serverTime - Date.now();
    render();
  }

  async function refreshState() {
    try {
      const screen = state && state.screen;
      const next = await api("/api/state");
      if (screen) next.screen = screen;
      if (next.role === "team") {
        viewedRoundIndex = Math.min(viewedRoundIndex, next.team.progress);
      } else if (next.role === "judge") {
        const pending = new Set(next.teams
          .filter((team) => team.extensionRequest && team.extensionRequest.status === "pending")
          .map((team) => team.id));
        if (loadedJudgeExtensionRequests) {
          for (const teamId of pending) {
            if (!knownExtensionRequests.has(teamId)) {
              const team = next.teams.find((entry) => entry.id === teamId);
              toast(`TEAM ${String(team.teamNumber).padStart(3, "0")} · ${team.teamName} requested 15 extra minutes.`, "error");
              audio.effect("hint");
            }
          }
        }
        knownExtensionRequests = pending;
        loadedJudgeExtensionRequests = true;
      }
      setState(next);
    } catch (error) {
      if (error.message.includes("session has expired") || error.message.includes("team has been eliminated")) {
        state = null;
        render();
        if (error.message.includes("team has been eliminated")) toast(error.message, "error");
        return;
      }
      toast(error.message, "error");
    }
  }

  function topbar(status, actions = "") {
    return `<header class="topbar">
      <div class="wordmark">CASE ZERO<span>THE BLACKTHORN FILES</span></div>
      <div class="topbar-right"><div class="status-line"><span class="signal-dot"></span>${esc(status)}</div>${actions}</div>
    </header>`;
  }

  function logoutButton() {
    return `<button type="button" class="button button-small button-quiet" data-action="logout" data-sound="click">DISCONNECT</button>`;
  }

  function authScreen() {
    const setup = !bootstrap.judgeExists && bootstrap.judgeSetupAvailable;
    const selectedTab = setup ? "judge-setup" : activeTab;
    const teamTab = `<button type="button" class="tab" role="tab" aria-selected="${selectedTab === "team-login"}" data-tab="team-login">TEAM ACCESS</button>`;
    const registerTab = `<button type="button" class="tab" role="tab" aria-selected="${selectedTab === "team-register"}" data-tab="team-register">REGISTER TEAM</button>`;
    const judgeTab = `<button type="button" class="tab" role="tab" aria-selected="${selectedTab.startsWith("judge")}" data-tab="${setup ? "judge-setup" : "judge-login"}">${setup ? "INITIALIZE JUDGE" : "JUDGE ACCESS"}</button>`;
    let form = "";

    if (selectedTab === "team-register") {
      const memberInputs = Array.from({ length: 3 }, (_, index) => `
        <div class="field"><label for="member-${index}">MEMBER ${String(index + 1).padStart(2, "0")} · REQUIRED</label>
        <input id="member-${index}" name="members" maxlength="60" required placeholder="Investigator name" autocomplete="off"></div>`).join("");
      form = `<form class="form-stack" data-form="team-register">
        <h2 class="form-heading">Register your team</h2>
        <p class="form-description">Every team has exactly three different members. Up to ${bootstrap.maxTeams} teams can register; ${bootstrap.registeredTeamCount} are registered so far. Complete registration before the judge starts the shared timer.</p>
        <div class="field"><label for="team-name">TEAM NAME</label><input id="team-name" name="teamName" maxlength="60" required autocomplete="organization" placeholder="Your investigation unit"></div>
        <div class="members-grid">${memberInputs}</div>
        <div class="field"><label for="leader-name">LEADER USERNAME</label><input id="leader-name" name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]{3,32}" required autocomplete="username"></div>
        <div class="field"><label for="leader-password">LEADER PASSWORD · 10 CHARACTERS MINIMUM</label><input id="leader-password" name="password" type="password" minlength="10" required autocomplete="new-password"></div>
        <p class="form-error" data-error></p>
        <button class="button button-primary" type="submit" data-sound="confirm" ${bootstrap.registeredTeamCount >= bootstrap.maxTeams ? "disabled" : ""}>${bootstrap.registeredTeamCount >= bootstrap.maxTeams ? "REGISTRATION FULL" : "REGISTER TEAM"} <span aria-hidden="true">→</span></button>
      </form>`;
    } else if (selectedTab === "judge-setup") {
      form = `<form class="form-stack" data-form="judge-setup">
        <h2 class="form-heading">Initialize private judge access</h2>
        <p class="form-description">Create the judge account with the one-time administrator setup secret configured on the server.</p>
        <div class="field"><label for="judge-setup-secret">ONE-TIME ADMIN SETUP SECRET</label><input id="judge-setup-secret" name="setupSecret" type="password" required autocomplete="off"></div>
        <div class="field"><label for="judge-new-name">JUDGE USERNAME</label><input id="judge-new-name" name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]{3,32}" required autocomplete="username"></div>
        <div class="field"><label for="judge-new-password">PASSWORD · 12 CHARACTERS MINIMUM</label><input id="judge-new-password" name="password" type="password" minlength="12" required autocomplete="new-password"></div>
        <p class="form-error" data-error></p>
        <button class="button button-primary" type="submit" data-sound="confirm">CREATE JUDGE ACCOUNT <span aria-hidden="true">→</span></button>
      </form>`;
    } else if (selectedTab === "judge-login") {
      form = `<form class="form-stack" data-form="judge-login">
        <h2 class="form-heading">Private judge access</h2>
        <p class="form-description">Judge tools, team records and winner selection are restricted to this account.</p>
        <div class="field"><label for="judge-name">JUDGE USERNAME</label><input id="judge-name" name="username" required autocomplete="username"></div>
        <div class="field"><label for="judge-password">PASSWORD</label><input id="judge-password" name="password" type="password" required autocomplete="current-password"></div>
        <p class="form-error" data-error></p>
        <button class="button button-primary" type="submit" data-sound="login">ACCESS JUDGE ARCHIVE <span aria-hidden="true">→</span></button>
      </form>`;
    } else {
      form = `<form class="form-stack" data-form="team-login">
        <h2 class="form-heading">Return to your investigation</h2>
        <p class="form-description">Your team's progress and individual timer are stored by the archive, not this browser.</p>
        <div class="field"><label for="team-leader">LEADER USERNAME</label><input id="team-leader" name="username" required autocomplete="username"></div>
        <div class="field"><label for="team-access-code">UNIQUE TEAM ACCESS CODE</label><input id="team-access-code" name="accessCode" required autocomplete="off"></div>
        <div class="field"><label for="team-password">LEADER PASSWORD</label><input id="team-password" name="password" type="password" required autocomplete="current-password"></div>
        <p class="form-error" data-error></p>
        <button class="button button-primary" type="submit" data-sound="login">RECONNECT TO CASE <span aria-hidden="true">→</span></button>
      </form>`;
    }

    const tabs = (setup ? judgeTab : bootstrap.judgeExists ? judgeTab : "") + teamTab + registerTab;
    return `<div class="auth-layout">
      <section class="auth-story">
        <p class="eyebrow"><span class="signal-dot"></span> RESTRICTED ARCHIVE // LIVE CASE</p>
        <h1>Some signals<br>should never<br>be <span>answered.</span></h1>
        <p class="auth-story-copy">Four files. Your team gets one hour from the moment the judge admits you. The last operator is still transmitting from somewhere inside the building.</p>
        <div class="story-footer"><span>CASE ID: CZ—09</span><span>NO PUBLIC RANKINGS</span></div>
      </section>
      <section class="auth-panel">
        <div class="tabs" role="tablist" aria-label="Archive access">${tabs}</div>
        ${registrationCode ? `<div class="access-code-card"><span class="mono-label">UNIQUE TEAM ACCESS CODE · SAVE THIS</span><strong>${esc(registrationCode)}</strong><span class="private-note">This code is shown only during registration. Your leader needs it to sign in from another device.</span></div>` : ""}
        ${form}
      </section>
    </div>`;
  }

  function timerCard() {
    const deadline = activeDeadline();
    const timer = deadline ? formatTime(remainingMs()) : "--:--:--";
    return `<div class="timer-card"><span class="timer-label">TEAM ${String(state.team.teamNumber).padStart(3, "0")} · SERVER TIMER</span><strong class="timer-value ${deadline && remainingMs() < 300000 ? "is-urgent" : ""}" data-timer>${timer}</strong><span class="timer-note">${deadline ? (remainingMs() ? "JUDGE-AUTHORIZED · SERVER-CONTROLLED" : "YOUR TEAM'S DEADLINE PASSED") : "WAITING FOR COMPETITION START"}</span></div>`;
  }

  function extensionPanel(team) {
    const request = team.extensionRequest;
    const active = Boolean(team.approved && activeDeadline() && remainingMs() > 0 && team.progress < 4);
    if (team.extensionGranted || (request && request.status === "approved")) {
      return `<div class="restricted-card extension-status"><span class="restricted-label">TIME EXTENSION</span><h3>+15 MINUTES APPROVED</h3><p>Your team deadline has been extended by the judge.</p></div>`;
    }
    if (request && request.status === "pending") {
      return `<div class="restricted-card extension-status is-pending"><span class="restricted-label">TIME EXTENSION</span><h3>REQUEST SENT · AWAITING JUDGE</h3><p>The timer continues until the judge approves the request.</p></div>`;
    }
    const wasRejected = request && request.status === "rejected";
    return `<div class="restricted-card extension-status ${wasRejected ? "is-rejected" : ""}"><span class="restricted-label">TIME EXTENSION</span><h3>${wasRejected ? "PREVIOUS REQUEST REJECTED" : "NEED MORE INVESTIGATION TIME?"}</h3><p>${wasRejected ? "You may submit another request while your timer is active." : "Request one judge-approved 15-minute addition to your team deadline."}</p><button class="button button-small button-danger" type="button" data-action="request-extension" data-sound="hint" ${active ? "" : "disabled"}>REQUEST +15 MINUTES</button></div>`;
  }

  function teamDashboard() {
    const team = state.team;
    const complete = team.progress === 4;
    const deadlineStarted = Boolean(state.competition.startedAt);
    const roundNames = ["THE SILENT STATION", "THE GHOST IN THE MACHINE", "THE WITNESS WHO WASN'T THERE", "THE LAST TRANSMISSION"];
    const roundRows = roundNames.map((name, index) => {
      const isComplete = index < team.progress;
      const isUnlocked = index === team.progress && !complete;
      return `<div class="case-row ${isComplete ? "is-complete" : ""} ${isUnlocked ? "is-unlocked" : ""}">
        <span class="case-index">0${index + 1}</span>
        <div><h3 class="case-name">${name}</h3><p class="case-meta">INVESTIGATION FILE · ${isComplete ? "CLEARED · REVIEW AVAILABLE" : isUnlocked ? "CURRENTLY OPEN" : "RESTRICTED"}</p>${isComplete ? `<button class="case-review-link" type="button" data-action="review-round" data-round="${index}" data-sound="file">REVIEW THIS FILE</button>` : ""}</div>
        <span class="case-status">${isComplete ? "CLEARED" : isUnlocked ? "ACCESS GRANTED" : "LOCKED"}</span>
      </div>`;
    }).join("");
    const waiting = !team.approved
      ? "Registration received. The judge must approve your team before it can join the shared competition timer."
      : !deadlineStarted ? "Your team is approved. Your 60-minute timer will start when the judge starts the competition."
        : "Your team is on the shared server-controlled deadline.";
    const sealed = "FINAL VERDICT RECEIVED. THE CASE REMAINS SEALED UNTIL EVERY PARTICIPATING TEAM HAS FINISHED OR ITS SHARED DEADLINE HAS EXPIRED.";
    const action = state.revealReady
      ? `<button class="button button-primary" type="button" data-action="show-reveal" data-sound="reveal">OPEN THE CASE FILE UNSEALED →</button>`
      : complete ? `<p class="empty-state">${sealed}</p>`
        : !deadlineStarted || !team.approved
          ? `<div class="empty-state">${waiting}</div>`
          : state.round
            ? `<button class="button button-primary" type="button" data-action="open-case" data-sound="file">OPEN CURRENT INVESTIGATION →</button>`
            : `<p class="private-note">The shared submission window has closed.</p>`;
    return `${topbar("TEAM CHANNEL // AUTHENTICATED", logoutButton())}
      <section class="section-header">
        <div><p class="eyebrow"><span class="signal-dot"></span> TEAM ${String(team.teamNumber).padStart(3, "0")} // INVESTIGATION UNIT</p>
          <h1 class="page-heading">${esc(team.teamName)}</h1>
          <p class="page-subtitle">${complete ? sealed : waiting}</p></div>
        ${timerCard()}
      </section>
      <div class="team-identity-card"><span class="mono-label">YOUR OFFICIAL TEAM NUMBER</span><strong>TEAM ${String(team.teamNumber).padStart(3, "0")}</strong><span>Use this number when identifying your team to the judge.</span></div>
      ${registrationCode ? `<div class="access-code-card"><span class="mono-label">SAVE YOUR UNIQUE TEAM ACCESS CODE</span><strong>${esc(registrationCode)}</strong><span class="private-note">Use this code with your leader username and password to sign in again. This code is shown only once.</span></div>` : ""}
      ${state.winner ? `<div class="winner-banner"><strong>OFFICIAL CASE ZERO WINNER · ${esc(state.winner.teamName)}</strong><br>${new Date(state.winner.announcedAt).toLocaleString()}${state.winner.rationale ? `<br>${esc(state.winner.rationale)}` : ""}</div>` : ""}
      ${extensionPanel(team)}
      <div class="dashboard-grid">
        <section class="panel"><div class="panel-heading"><h2>CASE FILE INDEX</h2><span class="mono-label">${String(team.progress).padStart(2, "0")} / 04 CLEARED</span></div>
          <div class="panel-body"><div class="case-list">${roundRows}</div><div style="margin-top:18px">${action}</div></div></section>
        <aside class="panel"><div class="panel-heading"><h2>TEAM STATUS</h2><span class="mono-label">PRIVATE</span></div>
          <div class="panel-body"><div class="stats-list">
            <div class="stat-row"><span class="stat-label">Team status</span><span class="stat-value">${team.approved ? deadlineStarted ? "ACTIVE" : "APPROVED" : "PENDING"}</span></div>
            <div class="stat-row"><span class="stat-label">Teams finished</span><span class="stat-value">${state.competition.finishedTeams || 0} / ${state.competition.participatingTeams || 0}</span></div>
            <div class="stat-row"><span class="stat-label">Investigators</span><span class="stat-value">${team.members.length}</span></div>
            <div class="stat-row"><span class="stat-label">Team number</span><span class="stat-value">${String(team.teamNumber).padStart(3, "0")}</span></div>
            <div class="stat-row"><span class="stat-label">Files recovered</span><span class="stat-value">${team.progress} / 4</span></div>
            <div class="stat-row"><span class="stat-label">Hints remaining</span><span class="stat-value">${3 - team.hintsUsed} / 3</span></div>
            <div class="stat-row"><span class="stat-label">Hint deductions</span><span class="stat-value negative">−${team.penalty} pts</span></div>
            <div class="stat-row"><span class="stat-label">Current team points</span><span class="stat-value">${team.score}</span></div>
          </div></div></aside>
      </div>
      <footer class="screen-footer"><span>INDIVIDUAL TEAM DEADLINE · SERVER ENFORCED</span><span>NO LEADERBOARD · JUDGE-ANNOUNCED WINNER</span></footer>`;
  }

  function artifactPanel(roundNumber) {
    const artifacts = evidenceArtifacts[roundNumber] || [];
    const cards = artifacts.map(([fileName, label, description]) => `
      <article class="artifact-card">
        <div><h3>${esc(label)}</h3><p>${esc(description)}</p><span class="artifact-filename">${esc(fileName)}</span></div>
        <div class="artifact-actions">
          <button class="button button-small button-quiet" type="button" data-action="view-artifact" data-round="${roundNumber}" data-file="${esc(fileName)}" data-title="${esc(label)}" data-sound="file">VIEW</button>
          <button class="button button-small button-primary" type="button" data-action="download-artifact" data-round="${roundNumber}" data-file="${esc(fileName)}" data-sound="click">DOWNLOAD</button>
        </div>
      </article>`).join("");
    return `<section class="panel artifact-panel">
      <div class="panel-heading"><h2>RECOVERED CASE ARTIFACTS</h2><span class="mono-label">${artifacts.length} FILES · ROUND 0${roundNumber}</span></div>
      <div class="panel-body"><p class="artifact-note">Open a file to inspect it, or download a copy. These fictional evidence files are restricted to rounds your team has unlocked.</p><div class="artifact-list">${cards}</div></div>
    </section>`;
  }

  async function loadEvidenceArtifact(button, download) {
    const roundNumber = Number(button.dataset.round);
    const fileName = button.dataset.file;
    const response = await fetch(`/api/evidence/round-${roundNumber}/${encodeURIComponent(fileName)}`, {
      headers: { "X-Case-Zero-Session": tabSessionToken },
      credentials: "omit"
    });
    if (!response.ok) {
      let message = `Could not load the evidence file (${response.status}).`;
      try {
        const result = await response.json();
        message = result.error || message;
      } catch (error) {
        console.warn("Evidence error response could not be read.", error);
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    if (download) {
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast(`${fileName} downloaded.`, "success");
      return;
    }

    const viewer = byId("evidence-viewer");
    const image = byId("evidence-image-preview");
    const text = byId("evidence-text-preview");
    byId("evidence-viewer-title").textContent = button.dataset.title || fileName;
    image.hidden = true;
    image.removeAttribute("src");
    text.hidden = true;
    text.textContent = "";
    if (fileName.endsWith(".svg")) {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        image.src = reader.result;
        image.alt = button.dataset.title || fileName;
        image.hidden = false;
      }, { once: true });
      reader.readAsDataURL(blob);
    } else {
      text.textContent = await blob.text();
      text.hidden = false;
    }
    viewer.showModal();
  }

  function caseScreen() {
    const team = state.team;
    const selectedRoundIndex = Math.min(viewedRoundIndex, team.progress);
    const isReviewing = selectedRoundIndex < team.progress;
    const unlockedRounds = Array.isArray(team.unlockedRounds) ? team.unlockedRounds : [];
    const round = isReviewing ? unlockedRounds[selectedRoundIndex] : state.round;
    if (isReviewing && !round) {
      return `${topbar("ARCHIVE HISTORY UNAVAILABLE", logoutButton())}
        <div class="empty-state">The server has not provided the cleared-file history for this session. Refresh the page to reload your case data. If this message remains, restart the CASE ZERO server so it loads the latest version.<br><br><button class="button button-small button-quiet" type="button" data-action="dashboard" data-sound="click">← CASE INDEX</button></div>`;
    }
    if (!round) {
      const canGoBack = team.progress > 0;
      return `${topbar("ARCHIVE WINDOW CLOSED", logoutButton())}
        <div class="empty-state">The current file is no longer available because the shared deadline has passed.${canGoBack ? `<br><br><button class="button button-small button-quiet" type="button" data-action="previous-round" data-sound="click">← REVIEW PREVIOUS UNLOCKED FILE</button>` : ""}<br><br><button class="button button-small button-quiet" type="button" data-action="dashboard" data-sound="click">← CASE INDEX</button></div>`;
    }
    const currentHint = isReviewing ? null : (state.hints || []).find((hint) => hint.round === selectedRoundIndex + 1);
    const active = !isReviewing && remainingMs() > 0;
    const members = team.members.map((name) => `<span>${esc(name)}</span>`).join(", ");
    const evidence = round.evidence.map((line) => `<p class="evidence-line">${esc(line)}</p>`).join("");
    const verdictFields = selectedRoundIndex === 3 ? `<div class="verdict-grid">${[["who","WHO WAS RESPONSIBLE?"],["what","WHAT HAPPENED?"],["when","WHEN DID IT HAPPEN?"],["how","HOW DOES THE EVIDENCE ESTABLISH THE SEQUENCE?"],["why","WHY DID THE CULPRIT ACT?"],["evidence","SUPPORTING EVIDENCE IDS"],["rejected","WHICH COMPETING THEORY DID YOU REJECT, AND WHY?"]].map(([name,label]) => `<div class="field"><label for="verdict-${name}">${label}</label><textarea id="verdict-${name}" name="${name}" required maxlength="1000" ${active ? "" : "disabled"}></textarea></div>`).join("")}</div>` : `<div class="field"><label for="answer">SUBMIT INVESTIGATIVE ANSWER</label><input id="answer" name="answer" autocomplete="off" maxlength="120" required ${active ? "" : "disabled"} placeholder="${active ? "Your team's best-supported answer" : "SUBMISSIONS CLOSED"}"></div>`;
    const savedVerdict = round.verdict
      ? `<dl class="saved-verdict">${Object.entries(round.verdict).map(([key, value]) => `<div><dt>${esc(key.toUpperCase())}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`
      : "";
    const savedAnswer = isReviewing
      ? `<div class="saved-answer"><span class="mono-label">ACCEPTED SUBMISSION · READ ONLY</span>${savedVerdict || `<p>${esc(round.submission && round.submission.answer || "Accepted answer recorded.")}</p>`}</div>`
      : `<form class="submit-row${selectedRoundIndex === 3 ? " final-verdict-form" : ""}" data-form="answer">${verdictFields}
          <button class="button button-primary" type="submit" data-sound="submit" ${active ? "" : "disabled"}>${selectedRoundIndex === 3 ? "SUBMIT FINAL VERDICT" : "SUBMIT EVIDENCE FINDING"} <span aria-hidden="true">→</span></button></form>
        <p class="form-error" id="answer-feedback"></p>`;
    const roundNavigation = `<nav class="round-navigation" aria-label="Unlocked investigation files">
      <button class="button button-small button-quiet" type="button" data-action="previous-round" data-sound="click" ${selectedRoundIndex <= 0 ? "disabled" : ""}>← PREVIOUS FILE</button>
      <span class="mono-label">FILE 0${selectedRoundIndex + 1} · ${isReviewing ? "CLEARED · READ ONLY" : "CURRENT FILE"} · ${Math.min(team.progress + 1, 4)} / 04 AVAILABLE</span>
      <button class="button button-small button-primary" type="button" data-action="next-round" data-sound="click" ${selectedRoundIndex >= team.progress ? "disabled" : ""}>NEXT UNLOCKED FILE →</button>
    </nav>`;
    return `${topbar(`TEAM CHANNEL // FILE 0${selectedRoundIndex + 1} ${isReviewing ? "REVIEW" : "OPEN"}`, logoutButton())}
      <section class="section-header">
        <div><p class="eyebrow"><span class="signal-dot"></span> EVIDENCE INTEGRITY // VERIFIED</p>
          <h1 class="page-heading">Field investigation</h1>
          <p class="page-subtitle">The timer and all answer checks remain controlled by the archive server. Audio is never part of a submission.</p></div>
        ${timerCard()}
      </section>
      <div class="case-layout">
        <article class="case-file">
          <div class="file-topline"><span class="file-label">RESTRICTED FILE // ${esc(round.file)}</span><span class="timestamp">RECOVERED 02:13:-- · CLOCK UNRELIABLE</span></div>
          <div class="case-content">
            <p class="round-kicker">ROUND 0${selectedRoundIndex + 1} // ${esc(round.file)}</p>
            <h1>${esc(round.title)}</h1>
            <p class="case-briefing">${esc(round.briefing)}</p>
            ${selectedRoundIndex === 0 ? `<img class="evidence-image" src="/images/lab-evidence.svg" alt="Fictional forensic image of Blackthorn Institute laboratory four, recovered with partial integrity">` : selectedRoundIndex === 2 ? `<img class="evidence-image" src="/images/suspect-contact-sheet.svg" alt="Stylized fictional interview portraits of the five Blackthorn Institute suspects">` : ""}<div class="evidence-sheet"><span class="mono-label">EVIDENCE TRANSCRIPT // DO NOT DISTRIBUTE</span>${evidence}</div>
            <div class="question-block"><h2>${esc(round.question)}</h2>
              ${selectedRoundIndex === 3 && !isReviewing ? `<p class="verdict-guidance">Your verdict is a synthesis, not a hidden answer file. Revisit earlier-round artifacts and connect opportunity, action, timing, and motive. Cite PX-03, FIN-09, and AUD-ORIG, then explain why one competing theory does not fit.</p>` : ""}
              ${savedAnswer}
            </div>
          </div>
        </article>
        <aside class="case-sidebar">
          <div class="restricted-card team-id-card"><span class="restricted-label">YOUR OFFICIAL TEAM NUMBER</span><h3>TEAM ${String(team.teamNumber).padStart(3, "0")}</h3></div>
          <div class="restricted-card"><span class="restricted-label">CLASSIFIED // TEAM ONLY</span><h3>Active investigators</h3><p>${members}</p></div>
          ${extensionPanel(team)}
          <div class="restricted-card"><span class="restricted-label">HINT BUDGET // ${team.hintsUsed} OF 3 USED</span><h3>Request an archive hint</h3><p>Each hint costs your team 10 points. Three hints total for the full case.</p>
            <button class="button button-small button-danger" style="margin-top:14px" type="button" data-action="hint" data-sound="hint" ${team.hintsUsed >= 3 || !active || currentHint ? "disabled" : ""}>${currentHint ? "HINT ALREADY REQUESTED" : "REQUEST HINT · −10 PTS"}</button>
            ${currentHint ? `<p class="hint-output"><span class="mono-label">RECOVERED NOTE</span><br>${esc(currentHint.text)}</p>` : hintOutput ? `<p class="hint-output">${esc(hintOutput)}</p>` : ""}
          </div>
          <div class="restricted-card"><span class="restricted-label">ROUND PROGRESS</span><div class="stats-list">
            <div class="stat-row"><span class="stat-label">Files cleared</span><span class="stat-value">${team.progress} / 4</span></div>
            <div class="stat-row"><span class="stat-label">Team points</span><span class="stat-value">${team.score}</span></div>
            <div class="stat-row"><span class="stat-label">Accepted answers lock</span><span class="stat-value">ON</span></div>
          </div></div>
          <button class="button button-small button-quiet" type="button" data-action="dashboard" data-sound="click">← BACK TO CASE INDEX</button>
        </aside>
      </div>
      ${roundNavigation}
      ${artifactPanel(selectedRoundIndex + 1)}
      <footer class="screen-footer"><span>TEAM ROSTER: ${team.members.length} INVESTIGATORS</span><span>SERVER DEADLINE ENFORCED · STRICTLY BEFORE 60:00</span></footer>`;
  }

  function revealScreen() {
    const reveal = state.reveal || [];
    const timeline = (reveal.timeline || []).map((item) => `<li>${esc(item)}</li>`).join("");
    const suspects = (reveal.suspects || []).map((item) => `<li>${esc(item)}</li>`).join("");
    const clues = (reveal.clues || []).map((item) => `<li>${esc(item)}</li>`).join("");
    const winner = state.winner ? `<div class="winner-banner"><strong>OFFICIAL CASE ZERO WINNER · ${esc(state.winner.teamName)}</strong><br>${new Date(state.winner.announcedAt).toLocaleString()}${state.winner.rationale ? `<br>${esc(state.winner.rationale)}` : ""}</div>` : `<div class="empty-state">The investigation is unsealed. The judge will publish the official winner after reviewing the submitted verdicts.</div>`;
    return `${topbar("THE CASE FILE UNSEALED", logoutButton())}
      <section class="reveal-hero">
        <p class="eyebrow" style="justify-content:center"><span class="signal-dot"></span> ALL TEAMS CLEAR · OFFICIAL SOLUTION UNSEALED</p>
        <h1>${esc(reveal.title || "THE CASE FILE UNSEALED")}</h1>
        <p>${esc(reveal.narrative || "")}</p>
        <p class="solution-answer">THE KILLER: ${esc(reveal.culprit || "")}</p>
      </section>
      ${winner}
      <section class="panel reveal-section"><div class="panel-heading"><h2>RECONSTRUCTED TIMELINE</h2><span class="mono-label">DISCOVERY ≠ FATAL EVENT</span></div><div class="panel-body"><ol>${timeline}</ol></div></section>
      <section class="panel reveal-section"><div class="panel-heading"><h2>THE FIVE SUSPECTS</h2><span class="mono-label">MOTIVE IS NOT PROOF</span></div><div class="panel-body"><ul>${suspects}</ul></div></section>
      <section class="panel reveal-section"><div class="panel-heading"><h2>EVIDENCE & RED HERRINGS EXPLAINED</h2><span class="mono-label">CROSS-REFERENCED RECORD</span></div><div class="panel-body"><ul>${clues}</ul></div></section>
      <section class="panel reveal-section"><div class="panel-heading"><h2>FINAL VERDICT</h2><span class="mono-label">WHO · WHAT · WHEN · HOW · WHY</span></div><div class="panel-body"><p><strong>WHO</strong> — ${esc(reveal.verdict.who)}</p><p><strong>WHAT</strong> — ${esc(reveal.verdict.what)}</p><p><strong>WHEN</strong> — ${esc(reveal.verdict.when)}</p><p><strong>HOW</strong> — ${esc(reveal.verdict.how)}</p><p><strong>WHY</strong> — ${esc(reveal.verdict.why)}</p><p><strong>EVIDENCE</strong> — ${esc(reveal.verdict.evidence)}</p><p><strong>COMPETING THEORY REJECTED</strong> — ${esc(reveal.verdict.rejected)}</p></div></section>
      <footer class="screen-footer"><span>SHARED REVEAL · AVAILABLE TO EVERY PARTICIPATING TEAM</span><button class="button button-small button-quiet" type="button" data-action="dashboard" data-sound="click">← CASE INDEX</button></footer>`;
  }

  function judgeScreen() {
    const winner = state.winner;
    const teams = state.teams || [];
    const archivedBatches = state.archivedBatches || [];
    const batchHistory = archivedBatches.length
      ? `<section class="panel" style="margin:18px 0"><div class="panel-heading"><h2>PREVIOUS BATCH ARCHIVE</h2><span class="mono-label">${archivedBatches.length} COMPLETED</span></div><div class="panel-body">${archivedBatches.slice().reverse().map((batch) => {
        const batchWinner = batch.winner ? ` · WINNER ${esc(batch.winner.teamName)}` : "";
        const archivedTeams = (batch.teams || []).map((team) => `<li>TEAM ${String(team.teamNumber).padStart(3, "0")} · ${esc(team.teamName)} · ${team.score} PTS · ${team.progress}/4 ROUNDS${team.eliminated ? " · ELIMINATED" : ""}</li>`).join("");
        return `<div class="archive-entry"><details class="judge-solution"><summary>BATCH ${String(batch.batchNumber).padStart(2, "0")} · ${new Date(batch.archivedAt).toLocaleString()} · ${(batch.teams || []).length} TEAMS${batchWinner}</summary><ol>${archivedTeams}</ol></details><button class="button button-small button-danger" type="button" data-action="delete-archived-batch" data-batch-number="${batch.batchNumber}" data-batch-label="BATCH ${String(batch.batchNumber).padStart(2, "0")}" data-sound="click">DELETE BATCH</button></div>`;
      }).join("")}</div></section>`
      : "";
    const teamCards = teams.length ? teams.map((team) => `<article class="team-review">
      ${(() => {
        const events = (team.focusEvents || []).slice().sort((left, right) => right.awayAt - left.awayAt);
        return events.length ? `<details class="focus-events"><summary>POSSIBLE FOCUS-AWAY SIGNALS · ${events.length}</summary><ol>${events.map((event) => {
          const awayTime = Number.isFinite(event.awayAt) ? new Date(event.awayAt).toLocaleString() : "UNKNOWN TIME";
          const returnTime = Number.isFinite(event.returnedAt) ? new Date(event.returnedAt).toLocaleString() : "NO RETURN SIGNAL";
          const duration = Number.isFinite(event.durationMs) ? `${Math.round(event.durationMs / 1000)} seconds` : "duration unknown";
          return `<li><strong>${esc(awayTime)}</strong> · ${esc(event.source || "focus change")} · ${esc(returnTime)} · ${esc(duration)}</li>`;
        }).join("")}</ol><p class="private-note">These browser focus/visibility changes can be false positives. They are warnings only—not proof of misconduct, and they cannot detect a second device.</p></details>` : "";
      })()}
      <div class="team-review-top"><h3>TEAM ${String(team.teamNumber).padStart(3, "0")} · ${esc(team.teamName)}</h3><span class="review-meta">${team.eliminated ? "ELIMINATED" : team.approved ? "APPROVED" : "PENDING APPROVAL"} · ${team.progress}/4 ROUNDS</span></div>
      <p><span class="mono-label">LEADER</span> ${esc(team.leader)} · ${team.members.map(esc).join(", ")}</p>
      <p><span class="mono-label">HINTS</span> ${team.hintsUsed}/3 used · ${team.penalty}-point deduction · <span class="mono-label">ACCESS CODE</span> ${esc(team.accessCode)}</p>
      ${team.startedAt && !team.eliminated ? `<p><span class="mono-label">TEAM TIMER</span> STARTED ${new Date(team.startedAt).toLocaleTimeString()} · <strong class="stat-value" data-team-timer="${esc(team.id)}" data-deadline="${team.deadline}">${team.deadline > Date.now() + serverOffset ? formatTime(team.deadline - Date.now() - serverOffset) : "00:00:00"}</strong></p>` : ""}
      ${team.extensionRequest ? `<p class="extension-review ${team.extensionRequest.status === "pending" ? "is-pending" : ""}"><span class="mono-label">+15 MINUTE REQUEST</span> · ${esc(team.extensionRequest.status.toUpperCase())}${team.extensionRequest.requestedAt ? ` · ${new Date(team.extensionRequest.requestedAt).toLocaleTimeString()}` : ""}</p>` : ""}
      ${team.extensionRequest && team.extensionRequest.status === "pending" ? `<div class="extension-review-actions"><button class="button button-small button-primary" type="button" data-action="extension-decision" data-decision="approve" data-team-id="${esc(team.id)}" data-team-name="${esc(team.teamName)}" data-sound="confirm">APPROVE +15 MIN</button><button class="button button-small button-danger" type="button" data-action="extension-decision" data-decision="reject" data-team-id="${esc(team.id)}" data-team-name="${esc(team.teamName)}" data-sound="click">REJECT REQUEST</button></div>` : ""}
      ${team.extensionGranted ? `<p><span class="mono-label">EXTENSION GRANTED</span> · +15 minutes added to this team's deadline</p>` : ""}
      <p><span class="mono-label">FINAL VERDICT</span><br>${team.finalVerdict ? esc(team.finalVerdict.who) + " · " + esc(team.finalVerdict.evidence) : "Not submitted"}</p>
      <p><span class="mono-label">SUBMISSIONS</span> ${team.submissions.length ? team.submissions.map((item) => `R${item.round} ${new Date(item.acceptedAt).toLocaleTimeString()}`).join(" · ") : "No accepted files yet"}</p>
      <p><span class="mono-label">INVESTIGATIVE RATIONALE</span><br>${team.rationale ? esc(team.rationale) : "Not submitted"}</p>
      ${!team.eliminated && !team.approved ? `<button class="button button-small button-primary" style="margin:0 0 10px" type="button" data-action="start-team" data-team-id="${esc(team.id)}" data-team-name="${esc(team.teamName)}" data-sound="transition">${state.competition.startedAt ? "APPROVE & JOIN SHARED TIMER" : "APPROVE TEAM"}</button>` : ""}
      ${!team.eliminated ? `<button class="button button-small button-danger" style="margin:0 0 10px 7px" type="button" data-action="eliminate-team" data-team-id="${esc(team.id)}" data-team-name="${esc(team.teamName)}" data-sound="finalize">ELIMINATE TEAM</button>` : `<p class="form-error">ELIMINATED BY JUDGE · RECORD RETAINED</p>`}
      <button class="button button-small ${winner && winner.teamId === team.id ? "button-danger" : ""}" type="button" data-action="winner" data-team-id="${esc(team.id)}" data-team-name="${esc(team.teamName)}" data-sound="finalize" ${!state.revealReady || team.progress !== 4 ? "disabled" : ""}>${winner && winner.teamId === team.id ? "CURRENT WINNER · RESELECT" : "DECLARE WINNER"}</button>
      <button class="button button-small button-danger" style="margin:10px 0 0" type="button" data-action="remove-team" data-team-id="${esc(team.id)}" data-team-name="${esc(team.teamName)}" data-sound="finalize">REMOVE FROM HISTORY</button>
    </article>`).join("") : `<div class="empty-state">No teams are registered yet. Teams can register when they arrive; each team waits for your individual start authorization.</div>`;
    const pendingExtensionCount = teams.filter((team) => team.extensionRequest && team.extensionRequest.status === "pending").length;
    return `${topbar("JUDGE CONSOLE // PRIVATE", logoutButton())}
      <section class="section-header">
        <div><p class="eyebrow"><span class="signal-dot"></span> ORGANIZER CONTROL // PRIVATE SESSION</p>
          <h1 class="page-heading">The evidence is yours.</h1>
          <p class="page-subtitle">Register all participating teams first, then start one shared competition timer for every registered team. The answer unseals only after every participating team finishes or its deadline expires.</p></div>
      </section>
      ${pendingExtensionCount ? `<div class="extension-alert" role="status"><strong>JUDGE NOTICE · ${pendingExtensionCount} PENDING TIME EXTENSION${pendingExtensionCount === 1 ? "" : "S"}</strong><span>Review the highlighted team dossier and approve or reject the request.</span></div>` : ""}
      <section class="panel judge-launch"><div class="panel-heading"><h2>COMPETITION CONTROL</h2><span class="mono-label">${state.competition.startedAt ? "IN PROGRESS" : "NOT STARTED"}</span></div>      <div class="panel-body"><p>${state.competition.startedAt ? `SHARED GAME STARTED ${new Date(state.competition.startedAt).toLocaleString()} · all registered participating teams share the original deadline unless the judge approves an individual +15-minute extension.` : `${state.competition.registeredTeamCount || 0} eligible team(s) registered · start once to begin their shared 60-minute timer.`}</p>${!state.competition.startedAt ? `<button class="button button-primary" type="button" data-action="start-for-all" data-sound="transition" ${state.competition.registeredTeamCount ? "" : "disabled"}>START ALL REGISTERED TEAMS · 60 MINUTES</button><button class="button button-small button-quiet" style="margin-left:8px" type="button" data-action="start-competition" data-sound="transition" ${teams.some((t) => t.approved && !t.eliminated) ? "" : "disabled"}>START APPROVED TEAMS ONLY</button>` : `<p>${state.competition.finishedTeams || 0} / ${state.competition.participatingTeams || 0} participating teams finished, were eliminated, or timed out · reveal ${state.revealReady ? "UNSEALED" : "SEALED"}</p>`}<button class="button button-small button-danger" style="margin-top:12px" type="button" data-action="clear-team-history" data-sound="finalize" ${teams.length ? "" : "disabled"}>CLEAR ALL TEAM REGISTRATION HISTORY</button><p class="private-note">Register teams before starting. This one-time action gives every registered eligible team the same server-controlled deadline; it cannot be reset. An individual extension only affects that team. The case unseals when every participant completes, is eliminated, or times out. Clearing team history preserves the judge account and game start.</p></div></section>
      ${state.competition.startedAt && state.revealReady ? `<section class="panel judge-launch"><div class="panel-heading"><h2>READY FOR ANOTHER BATCH?</h2><span class="mono-label">CURRENT CASE CLOSED</span></div><div class="panel-body"><p>The completed batch will be saved in the judge archive. Starting a new batch clears the current roster and results, resets team numbers, and opens registration for a fresh competition. The judge account is preserved.</p><button class="button button-danger" type="button" data-action="start-new-batch" data-sound="finalize">ARCHIVE RESULTS & START NEW BATCH</button></div></section>` : ""}
      ${batchHistory}
      <p class="private-note">Focus-away records are advisory browser signals only; tab switches and other system behavior may create false positives.</p>
      ${winner ? `<div class="winner-banner">FINAL VERDICT SEALED · ${esc(winner.teamName)} · ${new Date(winner.announcedAt).toLocaleString()}${winner.rationale ? `<br>JUDGE'S BASIS: ${esc(winner.rationale)}` : ""}</div>` : ""}
      <div class="judge-grid">
        <section class="panel"><div class="panel-heading"><h2>TEAM DOSSIERS</h2><span class="mono-label">${teams.length} REGISTERED</span></div><div class="panel-body">${teamCards}</div></section>
        <aside class="panel"><div class="panel-heading"><h2>ORGANIZER CONTROLS</h2><span class="mono-label">SERVER AUTHORITY</span></div>
          <div class="panel-body">
            <div class="restricted-card"><span class="restricted-label">COMPETITION RULES</span><h3>One shared deadline</h3><p>The judge can start all registered teams together with one server-controlled 60-minute deadline. Teams log in when ready and continue against that same deadline. An approved extension affects only that team's deadline. One team's timeout does not unseal the reveal while other participants remain active.</p></div>
            <div class="restricted-card" style="margin-top:18px"><span class="restricted-label">AGREED SCORING RUBRIC</span><div class="stats-list">
              ${state.rubric.map((criterion, index) => `<div class="stat-row"><span class="stat-label">${index + 1}.</span><span class="stat-value" style="max-width:190px">${esc(criterion)}</span></div>`).join("")}
              <div class="stat-row"><span class="stat-label">Accepted round</span><span class="stat-value">25 objective pts</span></div>
              <div class="stat-row"><span class="stat-label">Hint used</span><span class="stat-value negative">−10 pts</span></div>
            </div></div>
            <details class="judge-solution"><summary>PRIVATE CANONICAL SOLUTION</summary><p>${esc(state.solution.narrative)}</p><h3>Timeline</h3><ol>${state.solution.timeline.map((line) => `<li>${esc(line)}</li>`).join("")}</ol><h3>Suspects and clue resolution</h3><ul>${[...state.solution.suspects, ...state.solution.clues].map((line) => `<li>${esc(line)}</li>`).join("")}</ul></details>
            <form class="form-stack" data-form="winner" style="margin-top:18px">
              <h3 style="margin:0;font-size:13px">Judge's final verdict</h3>
              <div class="field"><label for="winner-team">COMPLETED TEAM</label><select id="winner-team" name="teamId" required><option value="">Choose a completed team</option>${teams.filter((team) => team.progress === 4).map((team) => `<option value="${esc(team.id)}">${esc(team.teamName)} · ${team.score} pts</option>`).join("")}</select></div>
              <div class="field"><label for="winner-reason">JUDGE'S RUBRIC NOTES</label><textarea id="winner-reason" name="rationale" maxlength="1000" placeholder="Record why this team best met the agreed rubric."></textarea></div>
              <button class="button button-danger" type="submit" data-sound="finalize" ${state.revealReady && teams.some((team) => team.progress === 4) ? "" : "disabled"}>ANNOUNCE WINNER TO ALL TEAMS</button>
            </form>
          </div>
        </aside>
      </div>
      <footer class="screen-footer"><span>PRIVATE JUDGE VIEW · TEAM RECORDS ARE NOT PUBLIC.</span><span>TEAM TIMERS ARE INDEPENDENT · DEADLINES ENFORCED SERVER-SIDE.</span></footer>`;
  }

  function render() {
    if (!state) {
      app.innerHTML = `${topbar("ARCHIVE UPLINK // SECURE")} ${authScreen()}`;
    } else if (state.role === "judge") {
      app.innerHTML = judgeScreen();
    } else if (state.revealReady && state.reveal) {
      app.innerHTML = revealScreen();
    } else if (state.screen === "case") {
      app.innerHTML = caseScreen();
    } else {
      app.innerHTML = teamDashboard();
    }
    updateTimer();
  }

  function updateTimer() {
    document.querySelectorAll("[data-team-timer]").forEach((element) => {
      const deadline = Number(element.dataset.deadline);
      element.textContent = deadline ? formatTime(deadline - Date.now() - serverOffset) : "--:--:--";
    });
    const output = document.querySelector("[data-timer]");
    if (!output || !state) return;
    const deadline = activeDeadline();
    output.textContent = deadline ? formatTime(remainingMs()) : "--:--:--";
    output.classList.toggle("is-urgent", Boolean(deadline && remainingMs() < 300000));
    const note = output.parentElement.querySelector(".timer-note");
    if (note && deadline && remainingMs() === 0) note.textContent = "DEADLINE PASSED · SUBMISSIONS CLOSED";
    if (state.role === "team" && state.screen === "case" && remainingMs() === 0) {
      const answer = byId("answer");
      if (answer) answer.disabled = true;
      const button = document.querySelector('[data-form="answer"] button');
      if (button) button.disabled = true;
    }
  }

  function focusMonitoringActive() {
    return gateEntered && state && state.role === "team" && state.team.approved && !state.team.eliminated &&
      state.team.progress < 4 && !state.revealReady && state.team.startedAt &&
      state.team.deadline > Date.now() + serverOffset;
  }

  function queueFocusEvent(phase, eventId, source) {
    focusEventQueue = focusEventQueue.then(() => api("/api/team/focus-event", {
      method: "POST",
      body: { eventId, phase, source },
      keepalive: true
    })).catch((error) => {
      console.warn("The judge could not be notified of a possible focus change.", error);
    });
  }

  function reportFocusAway(source) {
    if (!focusMonitoringActive() || focusAwayEventId) return;
    if (crypto.randomUUID) {
      focusAwayEventId = crypto.randomUUID();
    } else {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      focusAwayEventId = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
        .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
    }
    focusAwaySource = source;
    queueFocusEvent("away", focusAwayEventId, source);
  }

  function reportFocusReturn() {
    if (!focusAwayEventId) return;
    const eventId = focusAwayEventId;
    const source = focusAwaySource;
    focusAwayEventId = null;
    focusAwaySource = null;
    queueFocusEvent("return", eventId, source);
  }

  function errorTarget(form, message) {
    const target = form.querySelector("[data-error]");
    if (target) target.textContent = message;
    else toast(message, "error");
  }

  async function handleForm(form) {
    const values = new FormData(form);
    const action = form.dataset.form;
    const data = Object.fromEntries(values.entries());
    try {
      if (action === "team-register") {
        data.members = values.getAll("members").map((name) => String(name).trim()).filter(Boolean);
        const result = await api("/api/auth/team/register", { method: "POST", body: data });
        registrationCode = result.accessCode;
        bootstrap = await api("/api/bootstrap");
        toast("Team registered. Save the unique access code shown on screen.", "success");
        await refreshState();
        return;
      }
      if (action === "judge-setup") {
        await api("/api/judge/setup", { method: "POST", body: data });
        bootstrap = await api("/api/bootstrap");
        await refreshState();
        toast("Private judge account created.", "success");
        return;
      }
      if (action === "team-login" || action === "judge-login") {
        const endpoint = action === "team-login" ? "/api/auth/team/login" : "/api/auth/judge/login";
        await api(endpoint, { method: "POST", body: data });
        registrationCode = "";
        viewedRoundIndex = 0;
        await refreshState();
        return;
      }
      if (action === "answer") {
        const feedback = byId("answer-feedback");
        if (feedback) feedback.textContent = "";
        const submission = state.team.progress === 3 ? { round: 3, verdict: data } : { round: state.team.progress, answer: data.answer };
        const result = await api("/api/team/submit", { method: "POST", body: submission });
        if (!result.correct) {
          if (feedback) feedback.textContent = result.message;
          audio.effect("incorrect");
          return;
        }
        state.screen = "team";
        audio.effect(result.completed ? "finalize" : "correct");
        await refreshState();
        toast(result.completed ? result.message : "Evidence accepted. The next file has been unlocked.", "success");
        return;
      }
      if (action === "rationale") {
        await api("/api/team/rationale", { method: "POST", body: data });
        await refreshState();
        toast("Private rationale saved for the judge.", "success");
        return;
      }
      if (action === "winner") {
        const teamOption = form.querySelector("select[name='teamId']")?.selectedOptions[0];
        const winnerName = teamOption ? teamOption.textContent.split(" · ")[0] : "the selected team";
        if (!window.confirm(`Publish ${winnerName} as the official CASE ZERO winner to all participating teams?`)) return;
        await api("/api/judge/winner", { method: "POST", body: data });
        await refreshState();
        toast("The official winner has been announced to every participating team.", "success");
      }
    } catch (error) {
      errorTarget(form, error.message);
    }
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    try {
      if (action === "logout") {
        await api("/api/auth/logout", { method: "POST", body: {} });
        state = null;
        registrationCode = "";
        hintOutput = "";
        viewedRoundIndex = 0;
        activeTab = "team-login";
        render();
        return;
      }
      if (action === "start-team") {
        await api("/api/judge/approve-team", { method: "POST", body: { teamId: button.dataset.teamId, approved: true } });
        await refreshState();
        toast(state.competition.startedAt
          ? `TEAM ${button.dataset.teamName} admitted to the shared timer. The original deadline applies.`
          : `TEAM ${button.dataset.teamName} approved for the initial competition.`, "success");
        return;
      }
      if (action === "start-competition") {
        if (!window.confirm("Start the single shared 60-minute timer for all approved teams now? This cannot be reset.")) return;
        await api("/api/judge/start", { method: "POST", body: {} });
        await refreshState();
        toast("The shared 60-minute competition has started.", "success");
        return;
      }
      if (action === "start-for-all") {
        if (!window.confirm("Start the one shared 60-minute timer for every registered, non-eliminated team, including teams not currently logged in? This cannot be reset. All teams will share the same deadline.")) return;
        const result = await api("/api/judge/start-for-all", { method: "POST", body: {} });
        await refreshState();
        toast(`The shared competition has started for ${result.participatingTeams} registered team(s).`, "success");
        return;
      }
      if (action === "request-extension") {
        await api("/api/team/request-extension", { method: "POST", body: {} });
        await refreshState();
        toast("Your +15-minute request was sent to the judge. Your timer continues until it is approved.", "success");
        return;
      }
      if (action === "extension-decision") {
        const decision = button.dataset.decision;
        const actionText = decision === "approve" ? "approve an additional 15 minutes for" : "reject the time-extension request from";
        if (!window.confirm(`Confirm you want to ${actionText} TEAM ${button.dataset.teamName}?`)) return;
        await api("/api/judge/extension-decision", {
          method: "POST",
          body: { teamId: button.dataset.teamId, decision }
        });
        await refreshState();
        toast(decision === "approve"
          ? `TEAM ${button.dataset.teamName} received an additional 15 minutes.`
          : `TEAM ${button.dataset.teamName}'s request was rejected. The team may request again.`, "success");
        return;
      }
      if (action === "eliminate-team") {
        if (!window.confirm(`Eliminate TEAM ${button.dataset.teamName}? The team will lose access immediately; its dossier will remain in the judge console.`)) return;
        await api("/api/judge/eliminate-team", { method: "POST", body: { teamId: button.dataset.teamId } });
        await refreshState();
        toast(`TEAM ${button.dataset.teamName} eliminated. Its records have been retained.`, "success");
        return;
      }
      if (action === "remove-team") {
        if (!window.confirm(`Permanently remove TEAM ${button.dataset.teamName} and its entire dossier? This deletes its account, submissions, hints, and records; removes it from the active competition/reveal count; and cannot be undone. Team numbers will not be reused.`)) return;
        await api("/api/judge/remove-team", { method: "POST", body: { teamId: button.dataset.teamId } });
        await refreshState();
        toast(`TEAM ${button.dataset.teamName} and its dossier were permanently removed.`, "success");
        return;
      }
      if (action === "view-artifact" || action === "download-artifact") {
        await loadEvidenceArtifact(button, action === "download-artifact");
        return;
      }
      if (action === "clear-team-history") {
        if (!window.confirm("Clear ALL team accounts, team numbers, submissions, hints, and results? This cannot be undone. The judge account and game start will be kept; new teams will receive new numbers starting at TEAM 001.")) return;
        await api("/api/judge/clear-teams", { method: "POST", body: {} });
        await refreshState();
        toast("Team registration history cleared. The judge account and game start were preserved.", "success");
        return;
      }
      if (action === "start-new-batch") {
        const teamCount = state.teams.length;
        if (!window.confirm(`Archive the completed batch of ${teamCount} team(s), then clear the current roster and results so the next batch can register? The judge account and archived results will be preserved.`)) return;
        const result = await api("/api/judge/start-new-batch", { method: "POST", body: {} });
        await refreshState();
        toast(`Batch ${result.archivedBatchNumber} archived. Registration is open for the next batch.`, "success");
        return;
      }
      if (action === "delete-archived-batch") {
        const batchNumber = Number(button.dataset.batchNumber);
        const batchLabel = button.dataset.batchLabel || `BATCH ${batchNumber}`;
        if (!window.confirm(`Permanently delete ${batchLabel} and its archived scores, submissions, and winner record? This cannot be undone. The current batch and other archived batches will not be changed.`)) return;
        await api("/api/judge/delete-archived-batch", {
          method: "POST",
          body: { batchNumber }
        });
        await refreshState();
        toast(`${batchLabel} was deleted from the archive.`, "success");
        return;
      }
      if (action === "hint") {
        const result = await api("/api/team/hint", { method: "POST", body: {} });
        if (typeof result.hint !== "string" || !Number.isInteger(result.hintsUsed) || !Number.isFinite(result.penalty)) {
          throw new Error("The archive returned an incomplete hint response. Refresh the page and check your team status before trying again.");
        }
        hintOutput = result.hint;
        state.hints = [...(Array.isArray(state.hints) ? state.hints : []), {
          round: state.team.progress + 1,
          text: result.hint,
          requestedAt: Date.now()
        }];
        state.team.hintsUsed = result.hintsUsed;
        state.team.penalty = result.penalty;
        state.team.score = Math.max(0, state.team.progress * 25 - result.penalty);
        render();
        await refreshState();
        toast("Hint recovered. Ten points deducted from your team's score.", "success");
        return;
      }
      if (action === "dashboard") {
        state.screen = "team";
        hintOutput = "";
        render();
        return;
      }
      if (action === "open-case") {
        viewedRoundIndex = state.team.progress;
        state.screen = "case";
        render();
        return;
      }
      if (action === "review-round") {
        const requestedRound = Number(button.dataset.round);
        if (!Number.isInteger(requestedRound) || requestedRound < 0 || requestedRound >= state.team.progress) {
          throw new Error("That investigation file has not been unlocked for review.");
        }
        viewedRoundIndex = requestedRound;
        state.screen = "case";
        render();
        return;
      }
      if (action === "previous-round" || action === "next-round") {
        const direction = action === "previous-round" ? -1 : 1;
        const targetRoundIndex = Math.max(0, Math.min(state.team.progress, viewedRoundIndex + direction));
        if (targetRoundIndex < state.team.progress &&
            (!Array.isArray(state.team.unlockedRounds) || !state.team.unlockedRounds[targetRoundIndex])) {
          viewedRoundIndex = targetRoundIndex;
          state.screen = "case";
          render();
          return;
        }
        viewedRoundIndex = targetRoundIndex;
        state.screen = "case";
        render();
        return;
      }
      if (action === "show-reveal") {
        render();
        return;
      }
      if (action === "winner") {
        const form = document.createElement("form");
        form.dataset.form = "winner";
        form.innerHTML = `<input name="teamId" value="${esc(button.dataset.teamId)}"><input name="rationale" value="${esc(state.winner && state.winner.teamId === button.dataset.teamId ? "Winner reaffirmed after rubric review." : "")}">`;
        if (state.winner && state.winner.teamId === button.dataset.teamId) {
          if (!window.confirm(`Reaffirm ${button.dataset.teamName} as the official winner?`)) return;
        } else if (!window.confirm(`Declare ${button.dataset.teamName} the official winner?`)) return;
        await handleForm(form);
      }
    } catch (error) {
      toast(error.message, "error");
    }
  }

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    if (!event.submitter || !event.submitter.dataset.sound) audio.effect(form.dataset.form === "answer" ? "submit" : "click");
    void handleForm(form);
  });

  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (tab) {
      activeTab = tab.dataset.tab;
      render();
      audio.effect("click");
      if (activeTab === "team-register") {
        void api("/api/bootstrap").then((nextBootstrap) => {
          bootstrap = nextBootstrap;
          if (!state) render();
        }).catch((error) => toast(error.message, "error"));
      }
      return;
    }
    const button = event.target.closest("[data-action]");
    if (button) {
      if (button.dataset.sound) audio.effect(button.dataset.sound);
      void handleAction(button);
    }
  });

  byId("sound-toggle").addEventListener("click", async () => {
    prefs.master = !prefs.master;
    savePreferences();
    if (prefs.master) {
      const ready = await audio.enable();
      if (!ready) toast("This browser could not start audio. You can continue using the archive silently.", "error");
    } else {
      audio.updateLevels();
      await audio.suspend();
    }
  });

  byId("sound-settings-trigger").addEventListener("click", () => {
    const settings = byId("sound-settings");
    settings.hidden = !settings.hidden;
    byId("sound-settings-trigger").setAttribute("aria-expanded", String(!settings.hidden));
    audio.effect("click");
  });

  byId("master-setting").addEventListener("change", async (event) => {
    prefs.master = event.target.checked;
    savePreferences();
    if (prefs.master) {
      const ready = await audio.enable();
      if (!ready) toast("Audio could not start. The application remains available without sound.", "error");
    } else {
      audio.updateLevels();
      await audio.suspend();
    }
  });
  byId("ambience-setting").addEventListener("change", (event) => {
    prefs.ambience = event.target.checked;
    savePreferences();
    audio.updateLevels();
  });
  byId("interface-setting").addEventListener("change", (event) => {
    prefs.interface = event.target.checked;
    savePreferences();
  });
  byId("volume-setting").addEventListener("input", (event) => {
    prefs.volume = Number(event.target.value);
    savePreferences();
    audio.updateLevels();
  });

  byId("evidence-viewer-close").addEventListener("click", () => byId("evidence-viewer").close());
  byId("evidence-viewer").addEventListener("click", (event) => {
    if (event.target === byId("evidence-viewer")) byId("evidence-viewer").close();
  });

  byId("enter-with-sound").addEventListener("click", async () => {
    prefs.master = true;
    savePreferences();
    const ready = await audio.enable();
    if (!ready) toast("Autoplay was blocked or audio is unavailable. Use the sound control to try again; you may continue silently.", "error");
    gateEntered = true;
    gate.classList.add("is-hidden");
  });

  byId("enter-silent").addEventListener("click", async () => {
    prefs.master = false;
    savePreferences();
    audio.updateLevels();
    await audio.suspend();
    gateEntered = true;
    gate.classList.add("is-hidden");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      reportFocusAway("tab-hidden");
      void audio.suspend();
    } else {
      reportFocusReturn();
      if (gateEntered) void audio.resumeForVisibility();
    }
  });
  window.addEventListener("blur", () => reportFocusAway("window-blur"));
  window.addEventListener("focus", reportFocusReturn);
  window.addEventListener("pagehide", () => {
    reportFocusAway(document.hidden ? "tab-hidden" : "window-blur");
    void audio.suspend();
  });
  window.addEventListener("pageshow", () => {
    reportFocusReturn();
    if (gateEntered) void audio.resumeForVisibility();
  });

  function isEditableTarget(target) {
    return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  document.addEventListener("copy", (event) => {
    if (!isEditableTarget(event.target)) event.preventDefault();
  });
  document.addEventListener("cut", (event) => {
    if (!isEditableTarget(event.target)) event.preventDefault();
  });
  document.addEventListener("contextmenu", (event) => {
    if (!isEditableTarget(event.target)) event.preventDefault();
  });

  async function initialize() {
    syncSoundControls();
    if (prefs.master) void audio.prepare();
    try {
      bootstrap = await api("/api/bootstrap");
      await refreshState();
    } catch (error) {
      app.innerHTML = `${topbar("ARCHIVE OFFLINE")}<div class="empty-state">The case archive could not be reached. Start the local server and reload this page.<br><br><span class="mono-label">${esc(error.message)}</span></div>`;
    }
    if (timerHandle) window.clearInterval(timerHandle);
    timerHandle = window.setInterval(updateTimer, 250);
    window.setInterval(() => {
      if (!state || document.hidden || (document.activeElement && document.activeElement.closest("form"))) return;
      void refreshState();
    }, 5000);
  }

  void initialize();
})();
