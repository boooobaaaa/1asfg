/* ==========================================================================
   1ASFG APP — routing, views, admin console
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- utils */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => { u = String(u || "").trim(); return /^(https?:|data:image\/)/i.test(u) ? u : ""; };
  const fmtN = (n) => Number(n || 0).toLocaleString("en-US");
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const monthKey = (d) => String(d || "").slice(0, 7);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthLabel = (k) => { const [y, m] = k.split("-"); return `${MONTHS[+m - 1]} ${y}`; };

  const TYPES = {
    training: { label: "Training", kr: "훈련", cls: "t-training", stat: "trainings" },
    practice_raid: { label: "Practice Raid", kr: "모의습격", cls: "t-practice", stat: "practice" },
    raid: { label: "Raid", kr: "습격", cls: "t-raid", stat: "raids" },
  };
  const DET_KEYS = ["white_horse", "fierce_tiger"];

  let toastT;
  function toast(msg, bad) {
    const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 2800);
  }

  /* ---------------------------------------------------------------- state */
  const S = { members: [], events: [], leadership: [], settings: DB.mergeSettings({}), byId: {}, opNo: {}, loaded: false };
  const UI = { opsType: "all", opsMonth: "all", opsDet: "all", opsQ: "", lbView: "members", lbPeriod: "all", lbCat: "points", lbDet: "all",
    adminTab: "log", adminQ: "", editEventId: null, pick: new Set(), pickQ: "" };
  let admin = { signedIn: false, isAdmin: false, email: null };

  async function reload() {
    const d = await DB.loadAll();
    S.members = d.members; S.events = d.events; S.leadership = d.leadership; S.settings = d.settings;
    S.byId = {}; S.members.forEach((m) => (S.byId[m.id] = m));
    S.events.sort((a, b) => (b.event_date || "").localeCompare(a.event_date || "") || (b.created_at || "").localeCompare(a.created_at || ""));
    S.opNo = {};
    S.events.slice().reverse().forEach((e, i) => (S.opNo[e.id] = i + 1));
    S.loaded = true;
    const st = S.settings;
    if (st.introMusicSrc && !(st.introTracks || []).some((t) => t.src === st.introMusicSrc)) {
      st.introTracks = (st.introTracks || []).concat({ id: "legacy", name: st.introMusicSrc.split("/").pop(), src: st.introMusicSrc, path: "", offset: st.introMusicOffset || 0, volume: st.introMusicVolume ?? 70, duration: 0 });
      if (!st.introTrackId) st.introTrackId = "legacy";
    }
    applyChrome();
    Intro.fill();
  }

  /* ---------------------------------------------------------- derivations */
  const detName = (k, short) => { const d = S.settings.detachments[k]; return d ? (short ? d.short : d.name) : k === "hq" ? "Group HQ" : "Unassigned"; };
  const detBadge = (k) => k ? `<span class="det-badge ${esc(k)}">${esc(k === "hq" ? "HQ" : detName(k, true))}</span>` : "";
  const rankIdx = (r) => { const i = S.settings.ranks.indexOf(r); return i < 0 ? -1 : i; };
  function rankParts(r) {
    const m = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(r || "");
    return m ? { code: m[1], rest: m[2] } : { code: "", rest: r || "" };
  }
  const rankHtml = (r) => { if (!r) return ""; const p = rankParts(r); return (p.code ? `<span class="rank-code">[${esc(p.code)}]</span> ` : "") + esc(p.rest); };
  const rankShort = (r) => { const p = rankParts(r); const en = p.rest.split("|").pop().trim(); return en || p.rest; };
  const memberName = (id) => (S.byId[id] ? S.byId[id].username : "Former member");
  const memberLink = (id) => S.byId[id] ? `<a href="#/members/${encodeURIComponent(id)}">${esc(S.byId[id].username)}</a>` : `<span>Former member</span>`;

  function defaultPoints(type, outcome) {
    const p = S.settings.points;
    if (type === "training") return +p.training;
    if (type === "practice_raid") return +p.practice_raid;
    return outcome === "defeat" ? +p.raid_defeat : +p.raid_victory;
  }
  const evPoints = (e) => (e.points_each || 0) * (e.attendees || []).length + (e.host_id ? +S.settings.points.host_bonus || 0 : 0);

  function eventsInPeriod(period) { return period === "all" ? S.events : S.events.filter((e) => monthKey(e.event_date) === period); }
  function monthsAvailable() {
    const set = new Set(S.events.map((e) => monthKey(e.event_date)).filter(Boolean));
    set.add(monthKey(todayISO()));
    return Array.from(set).sort().reverse();
  }

  function computeStats(events) {
    const st = {};
    const g = (id) => (st[id] = st[id] || { id, raids: 0, practice: 0, trainings: 0, attended: 0, hosted: 0, points: 0 });
    const bonus = +S.settings.points.host_bonus || 0;
    events.forEach((e) => {
      const k = (TYPES[e.type] || TYPES.training).stat;
      (e.attendees || []).forEach((a) => { const s = g(a); s.attended++; s[k]++; s.points += e.points_each || 0; });
      if (e.host_id) { const h = g(e.host_id); h.hosted++; h.points += bonus; }
    });
    return st;
  }

  function detStats(events) {
    const st = computeStats(events);
    const out = {};
    DET_KEYS.forEach((k) => {
      const mem = S.members.filter((m) => m.detachment === k);
      const act = mem.filter((m) => m.status === "active");
      const rows = mem.map((m) => st[m.id]).filter(Boolean);
      const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
      const pts = sum("points");
      const opsTouched = new Set();
      events.forEach((e) => { if ((e.attendees || []).some((a) => S.byId[a] && S.byId[a].detachment === k)) opsTouched.add(e.id); });
      out[k] = {
        key: k, points: pts, members: mem.length, active: act.length, attended: sum("attended"),
        raids: sum("raids"), practice: sum("practice"), trainings: sum("trainings"), hosted: sum("hosted"),
        ops: opsTouched.size, perHead: act.length ? pts / act.length : 0,
        top: mem.map((m) => ({ m, s: st[m.id] })).filter((x) => x.s && x.s.points > 0).sort((a, b) => b.s.points - a.s.points).slice(0, 3),
      };
    });
    return out;
  }

  /* ---------------------------------------------------------------- chrome */
  function applyChrome() {
    const s = S.settings;
    document.title = `${s.unitShort} · ${s.unitName}`;
    $("#rail-short").textContent = s.unitShort.toUpperCase();
    $("#rail-kr").textContent = s.unitNameKr;
    $("#sys-mode").textContent = DB.LIVE ? `${s.unitShort.toUpperCase()}.DB` : "DEMO.LOCAL";
    $("#foot-unit").textContent = s.unitName;
    $("#foot-short").textContent = s.unitShort;
    const links = [];
    if (safeUrl(s.links.roblox)) links.push(`<a href="${esc(safeUrl(s.links.roblox))}" target="_blank" rel="noopener">Roblox Community ↗</a>`);
    if (safeUrl(s.links.discord)) links.push(`<a href="${esc(safeUrl(s.links.discord))}" target="_blank" rel="noopener">Discord ↗</a>`);
    $("#foot-links").innerHTML = links.join("");
    const items = s.ticker.map((t) => `<span>${esc(t)}</span>`).join("");
    $("#tk-track").innerHTML = items + items;
  }

  // Jump light: red while loading, green once the page is ready
  function jumpLight(state) {
    const j = $("#jumplight"); if (!j) return;
    j.className = "jumplight " + state;
    $("#jl-txt").textContent = state === "green" ? "GREEN LIGHT · GO" : "RED LIGHT · STAND BY";
  }

  // Altimeter: scale on the rail + needle that descends as you scroll the page
  const ALT_TOP = 12500;
  function drawAltimeter() {
    const sc = $("#alti-scale"); if (!sc) return;
    let h = "";
    for (let a = ALT_TOP; a >= 0; a -= 500) {
      const pct = (1 - a / ALT_TOP) * 100;
      const maj = a % 2500 === 0 && a > 0;
      h += `<span class="${maj ? "maj" : ""}" style="top:${pct}%">${maj ? (a / 1000).toFixed(1) + "K" : ""}</span>`;
    }
    sc.innerHTML = h;
  }
  function updateAltimeter() {
    const n = $("#alti-needle"); if (!n) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    const f = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    n.style.top = f * 100 + "%";
    $("#alti-read").textContent = fmtN(Math.round((ALT_TOP * (1 - f)) / 50) * 50);
  }

  // HUD: clock, radio subtitles
  function startHud() {
    const clock = () => { $("#sys-clock").textContent = new Date().toISOString().slice(11, 19); };
    clock(); setInterval(clock, 1000);
    drawAltimeter(); updateAltimeter();
    addEventListener("scroll", updateAltimeter, { passive: true });
    addEventListener("resize", updateAltimeter);
    let i = 0;
    const sub = $("#hud-sub");
    const say = () => {
      const tx = S.settings.transmissions;
      if (!tx.length) return;
      const t = tx[i++ % tx.length];
      sub.classList.add("fade");
      setTimeout(() => { sub.innerHTML = `<b>${esc(t.speaker)}:</b> <span>${esc(t.text)}</span>`; sub.classList.remove("fade"); }, 400);
    };
    say(); setInterval(say, 8000);
  }

  // Page header: section code, Hangul label, stencil title, flight path to the DZ
  const PLANE = `<svg class="fp-plane" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)"/></svg>`;
  const CHUTE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 11a9 9 0 0 1 18 0"/><path d="M3 11l9 9 9-9M8 11l4 9 4-9"/></svg>`;
  function pageHead(code, kr, title, sub, right = "") {
    return `<header class="ph">
      <div class="ph-meta"><span class="ph-code">${esc(code)}</span><span>${esc(S.settings.unitShort)} // records</span><span class="ph-kr">${esc(kr)}</span></div>
      <div class="ph-row"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ""}</div>${right}</div>
      <div class="flightpath"><i class="fp-line"></i>${PLANE}<span class="fp-dz">${CHUTE}DZ</span></div>
    </header>`;
  }

  /* ---------------------------------------------------------------- views */
  const TYPE_CODE = { training: "TRN", practice_raid: "PRX", raid: "RAD" };
  const MON3 = (d) => { const m = +String(d).slice(5, 7); return m ? MONTHS[m - 1].slice(0, 3).toUpperCase() + " " + String(d).slice(2, 4) : ""; };
  function stub(e, mini) {
    return `<span class="stub"><span class="stub-code">${TYPE_CODE[e.type] || "OPS"}</span><span class="stub-day">${esc(String(e.event_date).slice(8, 10))}</span><span class="stub-mon">${MON3(e.event_date)}</span>${mini ? "" : `<span class="stub-no">#${String(S.opNo[e.id] || 0).padStart(4, "0")}</span>`}</span>`;
  }
  function opRow(e) {
    const t = TYPES[e.type] || TYPES.training;
    return `<a class="ticket mini type-${esc(e.type)}" href="#/operations/${encodeURIComponent(e.id)}">${stub(e, true)}
      <span class="tk-body"><span class="tt ${t.cls}">${t.label}</span>${e.outcome ? `<span class="tt o-${esc(e.outcome)}">${esc(e.outcome)}</span>` : ""}<h3>${esc(e.title)}</h3>
      <span class="mini-meta">${(e.attendees || []).length} JUMPERS<br/>${fmtN(evPoints(e))} PTS</span></span>
    </a>`;
  }

  function topList(stats, n, key = "points", unit = "pts") {
    const rows = Object.values(stats).filter((s) => S.byId[s.id] && s[key] > 0).sort((a, b) => b[key] - a[key] || b.attended - a.attended).slice(0, n);
    if (!rows.length) return `<div class="empty">No points awarded yet</div>`;
    return `<ol class="roster">${rows.map((s, i) => {
      const m = S.byId[s.id];
      return `<li><span class="rk">#${i + 1}</span><span class="who">${memberLink(m.id)}<small>${rankHtml(m.rank)}</small></span><span class="pts">${fmtN(s[key])}<small>${unit}</small></span></li>`;
    }).join("")}</ol>`;
  }

  function terrainSvg() { return `<div class="terrain" aria-hidden="true"></div>`; }

  function reticleSvg() {
    const ticks = Array.from({ length: 72 }, (_, i) => {
      const a = (i * 5 * Math.PI) / 180, r1 = 92, r2 = i % 6 === 0 ? 84 : 88;
      return `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}"/>`;
    }).join("");
    return `<svg viewBox="0 0 200 200" fill="none" stroke="rgba(235,240,245,.75)" stroke-width=".7" aria-hidden="true">
      <circle cx="100" cy="100" r="96" stroke="rgba(61,130,207,.5)" fill="rgba(37,99,166,.12)"/>
      <g class="spin">${ticks}</g>
      <g class="spin-r"><circle cx="100" cy="100" r="74" stroke-dasharray="3 7"/><path d="M100 22v10M100 168v10M22 100h10M168 100h10" stroke-width="1.4"/></g>
      <circle cx="100" cy="100" r="58" stroke="rgba(235,240,245,.35)"/>
      <path d="M-30 100H40M160 100H230M100 -30V40M100 160V230" stroke="rgba(235,240,245,.3)"/>
    </svg>`;
  }

  function viewCommand() {
    const s = S.settings;
    const st = computeStats(S.events);
    const curM = monthKey(todayISO());
    const mEvents = eventsInPeriod(curM);
    const totalPts = S.events.reduce((a, e) => a + evPoints(e), 0);
    const active = S.members.filter((m) => m.status === "active").length;
    const ds = detStats(mEvents);
    const wh = ds.white_horse, ft = ds.fierce_tiger;
    const tot = wh.points + ft.points;
    const whPct = tot ? (wh.points / tot) * 100 : 50;
    // the MDL line is pushed INTO the losing side's territory
    const linePct = Math.min(85, Math.max(15, whPct));
    const lead = wh.points === ft.points ? "LINE HOLDS · LEVEL" : wh.points > ft.points ? `${detName("white_horse", true).toUpperCase()} ADVANCING` : `${detName("fierce_tiger", true).toUpperCase()} ADVANCING`;
    const words = s.unitName.trim().split(/\s+/);
    const cut = Math.ceil(words.length / 2);
    const title = `${esc(words.slice(0, cut).join(" "))}<br/><span class="ln2">${esc(words.slice(cut).join(" "))}</span>`;

    return `
    <section class="brief">
      <div>
        <div class="brief-kicker"><span class="tag">■ ${esc(s.kicker)}</span><span class="tag dark">COLD WAR · 1960s–80s</span><span class="tag blue">ROK ARMY SPECIAL WARFARE</span></div>
        <h1>${title}</h1>
      </div>
      <div class="brief-vert">${esc(s.unitNameKr)}</div>
    </section>
    <div class="brief-lede">
      <div><p>${esc(s.heroText)}</p><div class="motto">${esc(s.motto)}</div></div>
      <div class="btn-row"><a class="btn primary" href="#/operations">Operations log</a><a class="btn" href="#/leaderboard">Leaderboard</a></div>
    </div>
    <div class="flightpath" style="margin:22px 0 26px"><i class="fp-line"></i>${PLANE}<span class="fp-dz">${CHUTE}DZ</span></div>

    <section class="ops-grid">
      <div class="intel cut">
        ${terrainSvg()}
        <div class="intel-hdr"><span>${esc(s.unitShort.toUpperCase())} · SAT-RECON FEED</span><span>37°34′N 126°58′E</span></div>
        <div class="reticle">${reticleSvg()}<div class="coin-wrap"><div class="coin3d">${coinLayers(6)}</div></div></div>
        <div class="track-line"></div>
        <div class="track"><div class="tagstack">
          <span class="tag">TRACKING...</span>
          <span class="tag">${esc(s.unitName.toUpperCase())}</span>
          <span class="tag">${esc(detName("white_horse", true).toUpperCase())} · ${esc(detName("fierce_tiger", true).toUpperCase())}</span>
          <span class="tag">${fmtN(active)} OPERATIVES ACTIVE</span>
          <span class="tag blue">STATUS: COMBAT READY</span>
        </div></div>
        <div class="intel-ftr"><span>ALT 12,500 FT · DZ CLEAR</span><span>SEC. COMMS.</span></div>
      </div>
      <aside class="panel brk sitrep">
        <h2>Sitrep</h2><div class="sub">상황 보고 · as of ${esc(todayISO())}</div>
        <ul class="sr-list">
          <li><span class="k">Operations</span><span class="dots"></span><span class="v">${fmtN(S.events.length)}</span></li>
          <li><span class="k">Ops this month</span><span class="dots"></span><span class="v">${fmtN(mEvents.length)}</span></li>
          <li><span class="k">Personnel</span><span class="dots"></span><span class="v">${fmtN(active)}<small>ACTIVE</small></span></li>
          <li><span class="k">Points awarded</span><span class="dots"></span><span class="v">${fmtN(totalPts)}</span></li>
        </ul>
        <div class="sr-status"><span class="lamp"></span>LOGGING ACTIVE</div>
      </aside>
    </section>

    <section class="mdl">
      <div class="mdl-hd"><h2>Detachment line <span class="sub" style="letter-spacing:.1em">· ${esc(monthLabel(curM).toUpperCase())}</span></h2><a class="more" href="#/leaderboard?view=detachments">Standings →</a></div>
      <div class="mdl-field">
        <i class="mdl-fill wh" style="width:${linePct}%"></i><i class="mdl-fill ft" style="width:${100 - linePct}%"></i>
        <div class="mdl-side wh"><span class="mkr">${esc(s.detachments.white_horse.kr)}</span><span class="mnm">${esc(detName("white_horse"))}</span><span class="mpt">${fmtN(wh.points)}<small>PTS</small></span></div>
        <div class="mdl-side ft"><span class="mkr">${esc(s.detachments.fierce_tiger.kr)}</span><span class="mnm">${esc(detName("fierce_tiger"))}</span><span class="mpt">${fmtN(ft.points)}<small>PTS</small></span></div>
        <div class="mdl-line" style="left:${linePct}%"><span>MDL</span><em>${esc(lead)}</em></div>
      </div>
    </section>

    <section class="split">
      <div>
        <div class="sec-h"><h2>Jump manifest <span class="n">// RECENT</span></h2><a class="more" href="#/operations">All →</a></div>
        ${S.events.length ? `<div class="tickets compact">${S.events.slice(0, 6).map(opRow).join("")}</div>` : `<div class="empty">No operations logged yet</div>`}
      </div>
      <div class="panel brk">
        <div class="sec-h"><h2>Lead jumpers</h2><a class="more" href="#/leaderboard">Full →</a></div>
        ${topList(st, 8)}
      </div>
    </section>`;
  }

  function attendeesHtml(e, limit = 12) {
    const ids = e.attendees || [];
    const shown = ids.slice(0, limit).map((id) => S.byId[id] ? `<a href="#/members/${encodeURIComponent(id)}">${esc(S.byId[id].username)} <span style="border:none;padding:0;color:var(--dim)">+${e.points_each}</span></a>` : `<span>Former member</span>`);
    if (ids.length > limit) shown.push(`<button class="more-att" data-more="${esc(e.id)}">+${ids.length - limit} more</button>`);
    return `<div class="att">${shown.join("")}</div>`;
  }

  function opCard(e, full) {
    const t = TYPES[e.type] || TYPES.training;
    const proof = safeUrl(e.proof_url);
    return `<article class="ticket type-${esc(e.type)}">${stub(e)}
      <div class="tk-body">
        <div class="tk-tags"><span class="tt ${t.cls}">${t.label}</span>${e.outcome ? `<span class="tt o-${esc(e.outcome)}">${esc(e.outcome)}</span>` : ""}<span class="kr">${t.kr}</span></div>
        <h3>${full ? esc(e.title) : `<a href="#/operations/${encodeURIComponent(e.id)}">${esc(e.title)}</a>`}</h3>
        ${e.host_id ? `<div class="tk-host">Jumpmaster · ${memberLink(e.host_id)}</div>` : ""}
        ${attendeesHtml(e, full ? 999 : 12)}
        ${e.summary ? `<p class="tk-sum">${esc(e.summary)}</p>` : ""}
        <div class="tk-foot"><span><b>${(e.attendees || []).length}</b> jumpers</span><span><b>+${e.points_each}</b> each</span><span><b>${fmtN(evPoints(e))}</b> pts</span>${proof ? `<a href="${esc(proof)}" target="_blank" rel="noopener">Proof ↗</a>` : ""}</div>
      </div>
    </article>`;
  }

  function viewOperations(params) {
    if (params.type && TYPES[params.type]) UI.opsType = params.type;
    let list = S.events;
    if (UI.opsType !== "all") list = list.filter((e) => e.type === UI.opsType);
    if (UI.opsMonth !== "all") list = list.filter((e) => monthKey(e.event_date) === UI.opsMonth);
    if (UI.opsDet !== "all") list = list.filter((e) => (e.attendees || []).some((a) => S.byId[a] && S.byId[a].detachment === UI.opsDet));
    const q = UI.opsQ.trim().toLowerCase();
    if (q) list = list.filter((e) => e.title.toLowerCase().includes(q) || memberName(e.host_id).toLowerCase().includes(q) || (e.attendees || []).some((a) => memberName(a).toLowerCase().includes(q)));
    const counts = { all: S.events.length };
    Object.keys(TYPES).forEach((k) => (counts[k] = S.events.filter((e) => e.type === k).length));
    const chip = (k, label, cls = "") => `<button class="chip ${cls} ${UI.opsType === k ? "on" : ""}" data-optype="${k}">${label} · ${counts[k]}</button>`;
    return `
    ${pageHead("SEC-02", "작전 기록", "Operations Log", "Jump manifest of every training, practice raid and raid logged by Command.")}
    <div class="filters">
      <div class="chips">${chip("all", "All")}${chip("training", "Training", "t-training")}${chip("practice_raid", "Practice Raid", "t-practice")}${chip("raid", "Raid", "t-raid")}</div>
      <select class="in" id="ops-month"><option value="all">All months</option>${monthsAvailable().map((m) => `<option value="${m}" ${UI.opsMonth === m ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select>
      <select class="in" id="ops-det"><option value="all">All detachments</option>${DET_KEYS.map((k) => `<option value="${k}" ${UI.opsDet === k ? "selected" : ""}>${esc(detName(k))}</option>`).join("")}</select>
      <input class="in" id="ops-q" placeholder="Search title or operative…" value="${esc(UI.opsQ)}" style="min-width:220px"/>
    </div>
    <div class="ops-count"><b>${list.length}</b> operation${list.length === 1 ? "" : "s"} · <b>${fmtN(list.reduce((a, e) => a + evPoints(e), 0))}</b> pts</div>
    ${list.length ? `<div class="tickets">${list.map((e) => opCard(e)).join("")}</div>` : `<div class="empty">No operations match these filters</div>`}`;
  }

  function viewOperation(id) {
    const e = S.events.find((x) => x.id === id);
    if (!e) return `<div class="empty">Operation not found · <a href="#/operations">back to log</a></div>`;
    return `${pageHead("OP-" + String(S.opNo[e.id]).padStart(4, "0"), (TYPES[e.type] || TYPES.training).kr, esc(e.title), `<a href="#/operations">← Back to operations log</a>`)}
      <div style="max-width:900px">${opCard(e, true)}</div>`;
  }

  const LB_CATS = [
    ["points", "Top points"], ["hosted", "Top hosts"], ["raids", "Top raids"], ["practice", "Top practice raids"], ["trainings", "Top trainings"], ["attended", "Most attended"],
  ];

  function viewLeaderboard(params) {
    if (params.view === "detachments" || params.view === "members") UI.lbView = params.view;
    const months = monthsAvailable();
    const periodSel = `<select class="in" id="lb-period" style="width:auto">
      <option value="all" ${UI.lbPeriod === "all" ? "selected" : ""}>All time</option>
      ${months.map((m, i) => `<option value="${m}" ${UI.lbPeriod === m ? "selected" : ""}>${monthLabel(m)}${i === 0 ? " · current" : ""}</option>`).join("")}</select>`;
    const ev = eventsInPeriod(UI.lbPeriod);
    const head = `${pageHead("SEC-03", "공적 순위", "Leaderboard", `${UI.lbPeriod === "all" ? "All-time merit roster" : `Monthly merit roster · ${monthLabel(UI.lbPeriod)}`} · ${ev.length} operations`, periodSel)}
      <div class="lb-switch"><button data-lbview="members" class="${UI.lbView === "members" ? "on" : ""}">Operatives</button><button data-lbview="detachments" class="${UI.lbView === "detachments" ? "on" : ""}">Detachments</button></div>`;
    return head + (UI.lbView === "detachments" ? detBoard(ev) : memberBoard(ev));
  }

  function memberBoard(ev) {
    const st = computeStats(ev);
    const key = UI.lbCat;
    let rows = S.members.filter((m) => m.status !== "discharged").map((m) => ({ m, s: st[m.id] || { raids: 0, practice: 0, trainings: 0, attended: 0, hosted: 0, points: 0 } }));
    if (UI.lbDet !== "all") rows = rows.filter((r) => r.m.detachment === UI.lbDet);
    rows.sort((a, b) => b.s[key] - a.s[key] || b.s.points - a.s.points || rankIdx(b.m.rank) - rankIdx(a.m.rank) || a.m.username.localeCompare(b.m.username));
    const th = (k, l) => `<th class="n ${key === k ? "sort" : ""}">${l}</th>`;
    let rk = 0, prev = null;
    const lbl = (LB_CATS.find((c) => c[0] === key) || [, "Points"])[1].replace(/^Top |^Most /, "").toUpperCase();
    const pod = rows.slice(0, 3).filter((r) => r.s[key] > 0);
    return `
    ${pod.length ? `<div class="podium">${pod.map((r, i) => `<div class="pod p${i + 1}"><span class="pn">${i + 1}</span><div class="pl">${["LEAD JUMPER", "NO. 2 IN THE DOOR", "NO. 3 IN THE DOOR"][i]}</div><div class="pw">${memberLink(r.m.id)}</div><div class="pr">${rankHtml(r.m.rank)}</div><div class="pv">${fmtN(r.s[key])}<small>${esc(lbl)}</small></div></div>`).join("")}</div>` : ""}
    <div class="toolbar">
      <div class="chips">${LB_CATS.map(([k, l]) => `<button class="chip ${UI.lbCat === k ? "on" : ""}" data-lbcat="${k}">${l}</button>`).join("")}</div>
      <select class="in" id="lb-det" style="width:auto"><option value="all">All detachments</option>${DET_KEYS.concat("hq").map((k) => `<option value="${k}" ${UI.lbDet === k ? "selected" : ""}>${esc(detName(k))}</option>`).join("")}</select>
    </div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Rank</th><th>Member</th><th>Det.</th>${th("raids", "Raids")}${th("practice", "Practice raids")}${th("trainings", "Trainings")}${th("attended", "Attended")}${th("hosted", "Hosted")}${th("points", "Points")}</tr></thead>
      <tbody>${rows.map((r, i) => {
        if (prev === null || r.s[key] !== prev) rk = i + 1; prev = r.s[key];
        return `<tr class="${r.s[key] > 0 && rk <= 3 ? "p" + rk : ""}"><td class="rk">#${rk}</td>
        <td class="mem-cell">${memberLink(r.m.id)}<small>${rankHtml(r.m.rank)}</small></td><td>${detBadge(r.m.detachment)}</td>
        <td class="n">${r.s.raids}</td><td class="n">${r.s.practice}</td><td class="n">${r.s.trainings}</td><td class="n">${r.s.attended}</td><td class="n">${r.s.hosted}</td><td class="n ptcol">${fmtN(r.s.points)}</td></tr>`;
      }).join("") || `<tr><td colspan="9"><div class="empty">No personnel on the roster</div></td></tr>`}</tbody>
    </table></div>
    <p class="hint" style="margin-top:10px">Points: Training +${S.settings.points.training} · Practice raid +${S.settings.points.practice_raid} · Raid victory +${S.settings.points.raid_victory} · Raid defeat +${S.settings.points.raid_defeat}${+S.settings.points.host_bonus ? ` · Hosting +${S.settings.points.host_bonus}` : ""} per operative listed.</p>`;
  }

  function detBoard(ev) {
    const ds = detStats(ev);
    const lead = ds.white_horse.points === ds.fierce_tiger.points ? null : ds.white_horse.points > ds.fierce_tiger.points ? "white_horse" : "fierce_tiger";
    const maxOf = (f) => Math.max(1, ds.white_horse[f], ds.fierce_tiger[f]);
    const side = (k, cls) => {
      const d = ds[k], cfg = S.settings.detachments[k];
      const bar = (label, f) => `<div class="bar-row"><span>${label}</span><span class="track-bar"><i style="width:${(d[f] / maxOf(f)) * 100}%"></i></span><b>${fmtN(d[f])}</b></div>`;
      return `<article class="det ${cls}">
        <span class="wm">${esc(cfg.kr)}</span>
        <div class="dkr">${esc(cfg.kr)}</div><h3>${esc(cfg.name)}</h3>
        <div class="standing">${lead === k ? `<span class="tag amber">★ HOLDS THE STANDARD</span>` : lead ? `<span class="tag dark">CHALLENGER</span>` : `<span class="tag dark">LEVEL</span>`}</div>
        <div class="det-big">${fmtN(d.points)}<small>PTS</small></div>
        <div class="det-kv"><div><span>Active</span><b>${d.active}</b></div><div><span>Ops joined</span><b>${d.ops}</b></div><div><span>Pts / head</span><b>${d.perHead.toFixed(1)}</b></div></div>
        <div class="bars">${bar("Raids", "raids")}${bar("Practice raids", "practice")}${bar("Trainings", "trainings")}${bar("Attendances", "attended")}${bar("Hosted", "hosted")}</div>
        <div class="det-top3"><h4>LEAD JUMPERS</h4>${d.top.length ? `<ol class="roster">${d.top.map((x, i) => `<li><span class="rk">${i + 1}</span><span class="who">${memberLink(x.m.id)}<small>${rankHtml(x.m.rank)}</small></span><span class="pts">${fmtN(x.s.points)}<small>pts</small></span></li>`).join("")}</ol>` : `<div class="hint">No points yet this period.</div>`}</div>
      </article>`;
    };
    const tot = ds.white_horse.points + ds.fierce_tiger.points;
    const whPct = tot ? (ds.white_horse.points / tot) * 100 : 50;
    return `<section class="faceoff"><span class="tag amber mdl-tag">MDL</span>${side("white_horse", "wh")}${side("fierce_tiger", "ft")}</section>
      <p class="hint" style="margin:0">Share of points: ${esc(detName("white_horse", true))} ${whPct.toFixed(0)}% · ${esc(detName("fierce_tiger", true))} ${(100 - whPct).toFixed(0)}%. Detachment totals add up the points earned by each detachment's members. Group HQ personnel aren't counted toward either side.</p>`;
  }

  function viewMember(id) {
    const m = S.byId[id];
    if (!m) return `<div class="empty">Operative not found · <a href="#/leaderboard">leaderboard</a></div>`;
    const allSt = computeStats(S.events);
    const all = allSt[id] || { raids: 0, practice: 0, trainings: 0, attended: 0, hosted: 0, points: 0 };
    const hist = S.events.filter((e) => (e.attendees || []).includes(id) || e.host_id === id);
    const order = Object.values(allSt).sort((a, b) => b.points - a.points);
    const pos = order.findIndex((s) => s.id === id);
    const staff = S.leadership.find((l) => l.member_id === id);
    return `
    <div class="ph-meta"><span class="ph-code">PERSONNEL FILE</span><span><a href="#/leaderboard">← Leaderboard</a></span><span class="ph-kr">인사 기록</span></div>
    <section class="dossier">
      <div class="panel brk cut">
        <div class="tagstack"><span class="tag">● LOCATED</span><span class="tag">${esc(rankShort(m.rank).toUpperCase() || "OPERATIVE")}</span><span class="tag">${esc(detName(m.detachment).toUpperCase())}</span>${staff ? `<span class="tag blue">${esc(staff.position.toUpperCase())}</span>` : ""}</div>
        <h1>${esc(m.username)}</h1>
        <div class="sub">${rankHtml(m.rank)}</div>
        <div class="sub" style="margin-top:4px">STATUS: <span style="color:${m.status === "active" ? "var(--green)" : "var(--dim)"}">${esc((m.status || "active").toUpperCase())}</span>${m.joined_on ? ` · ENLISTED ${esc(m.joined_on)}` : ""}</div>
      </div>
      <div class="readouts">
        <div><span>Points</span><b>${fmtN(all.points)}</b></div>
        <div><span>Standing</span><b>${pos >= 0 && all.points > 0 ? "#" + (pos + 1) : "—"}</b></div>
        <div><span>Jumps</span><b>${all.attended}</b></div>
        <div><span>Raids</span><b>${all.raids}</b></div>
        <div><span>Practice raids</span><b>${all.practice}</b></div>
        <div><span>Trainings · Hosted</span><b>${all.trainings}<small> · ${all.hosted}</small></b></div>
      </div>
    </section>
    <div class="sec-h"><h2>Service record <span class="n">// ${hist.length} ENTRIES</span></h2></div>
    ${hist.length ? `<div class="tickets compact">${hist.map(opRow).join("")}</div>` : `<div class="empty">No operations on record</div>`}`;
  }

  function viewStaff() {
    const s = S.settings;
    const list = S.leadership.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const sections = [];
    list.forEach((l) => { const k = l.section || "Command"; let g = sections.find((x) => x.k === k); if (!g) sections.push((g = { k, items: [] })); g.items.push(l); });
    let serial = 0;
    const card = (l) => {
      serial++;
      const photo = safeUrl(l.photo_url);
      const initials = (l.name || "?").replace(/[^A-Za-z0-9가-힣]/g, " ").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      const name = l.member_id && S.byId[l.member_id] ? `<a href="#/members/${encodeURIComponent(l.member_id)}">${esc(l.name)}</a>` : esc(l.name);
      return `<article class="file">
        <div class="file-tab"><span>FILE <b>${esc(s.unitShort.toUpperCase())}-${String(serial).padStart(3, "0")}</b></span><span>${esc(l.detachment ? detName(l.detachment, true).toUpperCase() : "")}</span></div>
        <div class="photo">${photo ? `<img src="${esc(photo)}" alt="${esc(l.name)}" loading="lazy"/>` : `<div class="ph-empty"><span>${esc(initials)}</span></div>`}
          <span class="stamp">기밀</span>
          <div class="ph-tags tagstack"><span class="tag">${esc(rankShort(l.rank).toUpperCase() || "OFFICER")}</span></div>
        </div>
        <div class="body"><div class="pos">${esc(l.position)}</div><h3>${name}</h3>${l.rank ? `<div class="rank-l">${rankHtml(l.rank)}</div>` : ""}${l.bio ? `<p class="bio">${esc(l.bio)}</p>` : ""}</div>
      </article>`;
    };
    return `${pageHead("SEC-04", "지휘부", "Command Staff", esc(s.staffIntro))}
      ${sections.length ? sections.map((g) => `<section class="staff-sec"><div class="sec-h"><h2>${esc(g.k)}</h2><span class="sub">${g.items.length} personnel</span></div><div class="staff-grid">${g.items.map(card).join("")}</div></section>`).join("") : `<div class="empty">No command staff listed yet · add them in the Admin console</div>`}`;
  }

  /* ================================================================ ADMIN */
  async function viewAdmin() {
    try { admin = await DB.adminStatus(); } catch (e) { admin = { signedIn: false, isAdmin: false }; }
    if (!admin.isAdmin) return adminGate();
    const tabs = [["log", UI.editEventId ? "Edit Operation" : "Log Operation"], ["ops", "Operations"], ["personnel", "Personnel"], ["staff", "Command Staff"], ["music", "Music"], ["settings", "Site Settings"], ["backup", "Backup"]];
    let body = "";
    switch (UI.adminTab) {
      case "ops": body = adminOps(); break;
      case "personnel": body = adminPersonnel(); break;
      case "staff": body = adminStaff(); break;
      case "settings": body = adminSettings(); break;
      case "backup": body = adminBackup(); break;
      case "music": body = adminMusic(); break;
      default: body = adminLog();
    }
    return `${pageHead("RESTRICTED", "지휘 콘솔", "Command Console", `Signed in as ${esc(admin.email || "admin")}`, `<button class="btn sm" data-act="signout">Sign out</button>`)}
      ${DB.LIVE ? "" : `<div class="mode-banner">■ DEMO MODE: changes are saved only in this browser. Add your Supabase keys in config.js to go live.</div>`}
      <div class="admin-tabs">${tabs.map(([k, l]) => `<button class="chip ${UI.adminTab === k ? "on" : ""}" data-atab="${k}">${l}</button>`).join("")}</div>
      <div id="admin-body">${body}</div>`;
  }

  function adminGate() {
    const signedNotAdmin = admin.signedIn && !admin.isAdmin;
    return `<div class="gate panel brk cut">
      <span class="tag red">RESTRICTED</span>
      <h1>Command Console</h1>
      <div class="sub">${DB.LIVE ? "Sign in with your Command account." : `Demo mode. The passcode is set in config.js (default: <b>${esc((window.SITE_CONFIG || {}).DEMO_ADMIN_PASSCODE || "airborne")}</b>).`}</div>
      ${signedNotAdmin ? `<p class="err">Signed in as ${esc(admin.email)}, but this account isn't on the admins list. <button class="btn sm" data-act="signout">Sign out</button></p>` : ""}
      <form id="login-form">
        ${DB.LIVE ? `<label class="field"><span>Email</span><input class="in" name="email" type="email" autocomplete="username" required/></label>` : ""}
        <label class="field"><span>${DB.LIVE ? "Password" : "Passcode"}</span><input class="in" name="pass" type="password" autocomplete="current-password" required/></label>
        <div class="err" id="login-err"></div>
        <button class="btn primary" type="submit">Authenticate</button>
      </form></div>`;
  }

  const rankOptions = (sel) => `<option value="">— none —</option>` + S.settings.ranks.map((r) => `<option value="${esc(r)}" ${r === sel ? "selected" : ""}>${esc(r)}</option>`).join("") + (sel && !S.settings.ranks.includes(sel) ? `<option selected value="${esc(sel)}">${esc(sel)}</option>` : "");
  const detOptions = (sel, allowNone) => (allowNone ? `<option value="">— none —</option>` : "") + DET_KEYS.concat("hq").map((k) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(detName(k))}</option>`).join("");
  const sortedMembers = () => S.members.slice().sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || a.username.localeCompare(b.username, undefined, { sensitivity: "base" }));

  /* ---- Log / edit operation */
  function adminLog() {
    const e = UI.editEventId ? S.events.find((x) => x.id === UI.editEventId) : null;
    const v = e || { title: "", type: "training", outcome: "", event_date: todayISO(), host_id: "", proof_url: "", summary: "" };
    const pts = e ? e.points_each : defaultPoints(v.type, v.outcome);
    return `<form id="ev-form" class="panel brk" autocomplete="off">
      <div class="sec-h"><h2>${e ? `Edit OP-${String(S.opNo[e.id]).padStart(4, "0")}` : "Log new operation"}</h2>${e ? `<button type="button" class="btn sm" data-act="cancel-edit">Cancel edit</button>` : ""}</div>
      <div class="grid4">
        <label class="field span2"><span>Title</span><input class="in" name="title" required maxlength="120" value="${esc(v.title)}" placeholder="e.g. Raid: DMZ Listening Post"/></label>
        <label class="field"><span>Type</span><select class="in" name="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${v.type === k ? "selected" : ""}>${t.label}</option>`).join("")}</select></label>
        <label class="field"><span>Outcome</span><select class="in" name="outcome"><option value="">— none —</option><option value="victory" ${v.outcome === "victory" ? "selected" : ""}>Victory</option><option value="defeat" ${v.outcome === "defeat" ? "selected" : ""}>Defeat</option></select></label>
        <label class="field"><span>Date</span><input class="in" type="date" name="event_date" required value="${esc(v.event_date)}"/></label>
        <label class="field"><span>Host</span><select class="in" name="host_id"><option value="">— none —</option>${sortedMembers().map((m) => `<option value="${m.id}" ${v.host_id === m.id ? "selected" : ""}>${esc(m.username)}</option>`).join("")}</select></label>
        <label class="field"><span>Points per attendee</span><input class="in" type="number" min="0" max="100" name="points_each" value="${pts}"/></label>
        <label class="field"><span>Proof link</span><input class="in" name="proof_url" type="url" value="${esc(v.proof_url)}" placeholder="https://… screenshot / Discord msg"/></label>
        <label class="field span-all"><span>Summary (optional)</span><input class="in" name="summary" maxlength="400" value="${esc(v.summary)}"/></label>
      </div>
      <div class="field" style="margin-top:16px"><span>Attendees</span>
        <div class="picker">
          <div class="picker-top">
            <input class="in" id="pick-q" placeholder="Filter roster…" value="${esc(UI.pickQ)}"/>
            <button type="button" class="btn sm" data-act="pick-shown">Select shown</button>
            <button type="button" class="btn sm" data-act="pick-host">+ Host</button>
            <button type="button" class="btn sm" data-act="pick-clear">Clear</button>
            <span class="picker-count" id="pick-count"></span>
          </div>
          <div class="picker-list" id="pick-list"></div>
        </div>
      </div>
      <details style="margin-top:12px"><summary class="hint" style="cursor:pointer">Paste a list of usernames (from Discord, etc.)</summary>
        <div style="display:flex;gap:10px;margin-top:8px;align-items:flex-start;flex-wrap:wrap">
          <textarea class="in" id="pick-paste" placeholder="KimJaeho_ROK, Park_Sangwoo&#10;@Lee_Minjun" style="flex:1;min-width:220px"></textarea>
          <button type="button" class="btn sm" data-act="pick-paste">Add to attendees</button>
        </div><div class="hint" id="pick-paste-msg"></div>
      </details>
      <div class="btn-row" style="margin-top:18px;justify-content:flex-end">
        <span class="hint" id="ev-total" style="margin-right:auto;align-self:center"></span>
        <button class="btn primary" type="submit">${e ? "Save changes" : "Log operation"}</button>
      </div>
    </form>`;
  }

  function drawPicker() {
    const list = $("#pick-list"); if (!list) return;
    const q = UI.pickQ.trim().toLowerCase();
    const ms = sortedMembers().filter((m) => (m.status !== "discharged" || UI.pick.has(m.id)) && (!q || m.username.toLowerCase().includes(q) || (m.rank || "").toLowerCase().includes(q) || detName(m.detachment).toLowerCase().includes(q)));
    list.innerHTML = ms.map((m) => `<label class="${UI.pick.has(m.id) ? "sel" : ""}"><input type="checkbox" data-pick="${m.id}" ${UI.pick.has(m.id) ? "checked" : ""}/><span>${esc(m.username)}</span>${detBadge(m.detachment)}</label>`).join("") || `<div class="hint" style="padding:10px">No matches.</div>`;
    updatePickTotals();
  }
  function updatePickTotals() {
    const c = $("#pick-count"); if (c) c.textContent = `${UI.pick.size} SELECTED`;
    const f = $("#ev-form"); const tot = $("#ev-total");
    if (f && tot) { const p = +f.points_each.value || 0; tot.textContent = `${UI.pick.size} × ${p} = ${UI.pick.size * p} pts${+S.settings.points.host_bonus && f.host_id.value ? ` (+${S.settings.points.host_bonus} host)` : ""}`; }
  }

  /* ---- Operations list */
  function adminOps() {
    const q = UI.adminQ.trim().toLowerCase();
    const list = S.events.filter((e) => !q || e.title.toLowerCase().includes(q) || e.event_date.includes(q) || memberName(e.host_id).toLowerCase().includes(q));
    return `<div class="toolbar"><input class="in" id="admin-q" placeholder="Search operations…" value="${esc(UI.adminQ)}"/><button class="btn blue sm" data-atab="log" data-act="new-op">+ Log operation</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>OP</th><th>Date</th><th>Type</th><th>Title</th><th>Host</th><th class="n">Att.</th><th class="n">Pts</th><th></th></tr></thead>
    <tbody>${list.map((e) => { const t = TYPES[e.type] || TYPES.training; return `<tr><td class="hint">${String(S.opNo[e.id]).padStart(4, "0")}</td><td>${esc(e.event_date)}</td><td><span class="tt ${t.cls}">${t.label}</span> ${e.outcome ? `<span class="tt o-${esc(e.outcome)}">${esc(e.outcome)}</span>` : ""}</td><td>${esc(e.title)}</td><td>${esc(e.host_id ? memberName(e.host_id) : "—")}</td><td class="n">${(e.attendees || []).length}</td><td class="n">${fmtN(evPoints(e))}</td>
      <td><div class="row-actions"><button class="btn sm" data-editev="${e.id}">Edit</button><button class="btn sm danger" data-delev="${e.id}">Delete</button></div></td></tr>`; }).join("") || `<tr><td colspan="8"><div class="empty">No operations</div></td></tr>`}</tbody></table></div>`;
  }

  /* ---- Personnel */
  function adminPersonnel() {
    const q = UI.adminQ.trim().toLowerCase();
    const st = computeStats(S.events);
    const list = sortedMembers().filter((m) => !q || m.username.toLowerCase().includes(q) || (m.rank || "").toLowerCase().includes(q) || detName(m.detachment).toLowerCase().includes(q));
    return `
    <form id="mem-add" class="panel brk" style="margin-bottom:18px" autocomplete="off">
      <div class="sec-h"><h2>Enlist operative</h2></div>
      <div class="grid4">
        <label class="field"><span>Roblox username</span><input class="in" name="username" required maxlength="40"/></label>
        <label class="field"><span>Rank</span><select class="in" name="rank">${rankOptions(S.settings.ranks[0])}</select></label>
        <label class="field"><span>Detachment</span><select class="in" name="detachment">${detOptions("white_horse")}</select></label>
        <label class="field"><span>Joined</span><input class="in" type="date" name="joined_on" value="${todayISO()}"/></label>
      </div>
      <div class="btn-row" style="margin-top:14px;justify-content:space-between"><button type="button" class="btn sm" data-act="bulk">Bulk import…</button><button class="btn primary" type="submit">Add to roster</button></div>
    </form>
    <div class="toolbar"><input class="in" id="admin-q" placeholder="Search roster…" value="${esc(UI.adminQ)}"/><span class="hint">${S.members.length} on roster · ${S.members.filter((m) => m.status === "active").length} active</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Username</th><th>Rank</th><th>Det.</th><th>Status</th><th class="n">Att.</th><th class="n">Pts</th><th></th></tr></thead>
    <tbody>${list.map((m) => { const s = st[m.id] || { attended: 0, points: 0 }; return `<tr><td class="mem-cell"><a href="#/members/${m.id}">${esc(m.username)}</a></td><td style="font-size:12px">${rankHtml(m.rank)}</td><td>${detBadge(m.detachment)}</td><td class="hint">${esc(m.status || "active")}</td><td class="n">${s.attended}</td><td class="n">${s.points}</td>
      <td><div class="row-actions"><button class="btn sm" data-editmem="${m.id}">Edit</button><button class="btn sm danger" data-delmem="${m.id}">Remove</button></div></td></tr>`; }).join("") || `<tr><td colspan="7"><div class="empty">Roster is empty</div></td></tr>`}</tbody></table></div>`;
  }

  function memberModal(m) {
    openModal(`<form id="mem-edit"><div class="modal-h"><h2>Edit operative</h2><button type="button" class="x" data-act="close">×</button></div>
      <div class="modal-b"><div class="grid2">
        <label class="field"><span>Roblox username</span><input class="in" name="username" required value="${esc(m.username)}"/></label>
        <label class="field"><span>Rank</span><select class="in" name="rank">${rankOptions(m.rank)}</select></label>
        <label class="field"><span>Detachment</span><select class="in" name="detachment">${detOptions(m.detachment, true)}</select></label>
        <label class="field"><span>Status</span><select class="in" name="status">${["active", "inactive", "loa", "discharged"].map((s) => `<option ${m.status === s ? "selected" : ""} value="${s}">${s.toUpperCase()}</option>`).join("")}</select></label>
        <label class="field"><span>Joined</span><input class="in" type="date" name="joined_on" value="${esc(m.joined_on || "")}"/></label>
        <label class="field span-all"><span>Notes (not shown on the site, but not private)</span><input class="in" name="notes" value="${esc(m.notes || "")}"/></label>
      </div><p class="hint" style="margin:0">Discharged members are hidden from the leaderboard; their past attendance stays on the operations log.</p></div>
      <div class="modal-f"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Save</button></div>
      <input type="hidden" name="id" value="${esc(m.id)}"/></form>`);
  }

  function bulkModal() {
    openModal(`<form id="mem-bulk"><div class="modal-h"><h2>Bulk import personnel</h2><button type="button" class="x" data-act="close">×</button></div>
      <div class="modal-b">
        <p class="hint" style="margin:0">One operative per line: <b>username, rank, detachment</b>. Rank and detachment are optional. Rank can be the full rank text or just the English name (e.g. <i>Corporal</i>). Detachment: <i>white horse</i>, <i>fierce tiger</i> or <i>hq</i>. Existing usernames are skipped.</p>
        <textarea class="in" name="rows" rows="10" placeholder="KimJaeho_ROK, Sergeant, white horse&#10;Park_Sangwoo, Private, fierce tiger&#10;Lee_Minjun"></textarea>
        <div class="grid2"><label class="field"><span>Default detachment</span><select class="in" name="def_det">${detOptions("white_horse", true)}</select></label>
        <label class="field"><span>Default rank</span><select class="in" name="def_rank">${rankOptions(S.settings.ranks[0])}</select></label></div>
      </div>
      <div class="modal-f"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Import</button></div></form>`);
  }

  function matchRank(txt) {
    const t = (txt || "").trim().toLowerCase(); if (!t) return null;
    return S.settings.ranks.find((r) => r.toLowerCase() === t) || S.settings.ranks.find((r) => rankShort(r).toLowerCase() === t) || S.settings.ranks.find((r) => r.toLowerCase().includes(t)) || null;
  }
  function matchDet(txt) {
    const t = (txt || "").trim().toLowerCase().replace(/[^a-z가-힣]/g, ""); if (!t) return null;
    if (t.includes("white") || t.includes("백마") || t === "wh") return "white_horse";
    if (t.includes("tiger") || t.includes("맹호") || t === "ft") return "fierce_tiger";
    if (t.includes("hq") || t.includes("head") || t.includes("command")) return "hq";
    return null;
  }

  /* ---- Command staff admin */
  function adminStaff() {
    const list = S.leadership.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return `<div class="toolbar"><span class="hint">Shown on the Command Staff page, grouped by section in this order.</span><button class="btn blue sm" data-act="new-leader">+ Add officer</button></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Name</th><th>Position</th><th>Section</th><th>Rank</th><th>Order</th><th></th></tr></thead>
    <tbody>${list.map((l, i) => `<tr><td>${safeUrl(l.photo_url) ? `<img class="thumb" src="${esc(safeUrl(l.photo_url))}" alt=""/>` : `<div class="thumb-empty"></div>`}</td><td>${esc(l.name)}</td><td>${esc(l.position)}</td><td class="hint">${esc(l.section)}</td><td style="font-size:12px">${rankHtml(l.rank)}</td>
      <td><div class="row-actions" style="justify-content:flex-start"><button class="btn sm" data-move="${l.id}" data-dir="-1" ${i === 0 ? "disabled" : ""}>↑</button><button class="btn sm" data-move="${l.id}" data-dir="1" ${i === list.length - 1 ? "disabled" : ""}>↓</button></div></td>
      <td><div class="row-actions"><button class="btn sm" data-editlead="${l.id}">Edit</button><button class="btn sm danger" data-dellead="${l.id}">Remove</button></div></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">No command staff yet</div></td></tr>`}</tbody></table></div>`;
  }

  let pendingPhoto = null; // {blob, preview}
  function leaderModal(l) {
    pendingPhoto = null;
    const isNew = !l;
    l = l || { name: "", position: "", rank: "", section: (S.leadership[0] || {}).section || "Group Command", detachment: "hq", photo_url: "", bio: "", member_id: "" };
    const sections = Array.from(new Set(S.leadership.map((x) => x.section).filter(Boolean).concat(["Group Command", detName("white_horse"), detName("fierce_tiger")])));
    openModal(`<form id="lead-form"><div class="modal-h"><h2>${isNew ? "Add officer" : "Edit officer"}</h2><button type="button" class="x" data-act="close">×</button></div>
      <div class="modal-b">
        <div class="photo-edit">
          <div class="prev" id="lead-prev">${safeUrl(l.photo_url) ? `<img src="${esc(safeUrl(l.photo_url))}" alt=""/>` : "NO PHOTO"}</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <label class="field"><span>Upload photo</span><input class="in" type="file" accept="image/*" id="lead-file"/></label>
            <label class="field"><span>…or image URL</span><input class="in" name="photo_url" value="${esc(l.photo_url && !l.photo_url.startsWith("data:") ? l.photo_url : "")}" placeholder="https://…"/></label>
            <div class="btn-row"><button type="button" class="btn sm danger" data-act="clear-photo">Remove photo</button></div>
            <div class="hint">Photos are cropped to portrait and resized to 600px before saving.</div>
          </div>
        </div>
        <div class="grid2">
          <label class="field"><span>Link to roster member</span><select class="in" name="member_id"><option value="">— not linked —</option>${sortedMembers().map((m) => `<option value="${m.id}" ${l.member_id === m.id ? "selected" : ""}>${esc(m.username)}</option>`).join("")}</select></label>
          <label class="field"><span>Display name</span><input class="in" name="name" required value="${esc(l.name)}"/></label>
          <label class="field"><span>Position / billet</span><input class="in" name="position" required value="${esc(l.position)}" placeholder="Detachment Commander"/></label>
          <label class="field"><span>Rank</span><select class="in" name="rank">${rankOptions(l.rank)}</select></label>
          <label class="field"><span>Section (page heading)</span><input class="in" name="section" list="sec-list" value="${esc(l.section)}"/><datalist id="sec-list">${sections.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></label>
          <label class="field"><span>Detachment</span><select class="in" name="detachment">${detOptions(l.detachment, true)}</select></label>
          <label class="field span-all"><span>Bio (optional)</span><textarea class="in" name="bio" rows="3" maxlength="600">${esc(l.bio)}</textarea></label>
        </div>
      </div>
      <div class="modal-f"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">Save</button></div>
      <input type="hidden" name="id" value="${esc(l.id || "")}"/><input type="hidden" name="cur_photo" value="${esc(l.photo_url || "")}"/></form>`);
  }

  function resizeImage(file, maxW = 600, ratio = 4 / 5) {
    return new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        let sw = img.width, sh = img.height, sx = 0, sy = 0;
        if (sw / sh > ratio) { sw = sh * ratio; sx = (img.width - sw) / 2; } else { sh = sw / ratio; sy = Math.max(0, (img.height - sh) * 0.3); }
        const w = Math.min(maxW, Math.round(sw)), h = Math.round(w / ratio);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? res(b) : rej(new Error("Could not process image"))), "image/jpeg", 0.85);
      };
      img.onerror = () => rej(new Error("That file isn't a readable image."));
      img.src = url;
    });
  }

  /* ---- Settings */
  function adminSettings() {
    const s = S.settings;
    return `<form id="set-form" class="panel brk" autocomplete="off">
      <fieldset><legend>Identity</legend><div class="grid3">
        <label class="field"><span>Unit name</span><input class="in" name="unitName" value="${esc(s.unitName)}"/></label>
        <label class="field"><span>Short name</span><input class="in" name="unitShort" value="${esc(s.unitShort)}"/></label>
        <label class="field"><span>Korean name</span><input class="in" name="unitNameKr" value="${esc(s.unitNameKr)}"/></label>
        <label class="field"><span>Kicker</span><input class="in" name="kicker" value="${esc(s.kicker)}"/></label>
        <label class="field span2"><span>Motto line</span><input class="in" name="motto" value="${esc(s.motto)}"/></label>
        <label class="field span-all"><span>Home page intro</span><textarea class="in" name="heroText" rows="3">${esc(s.heroText)}</textarea></label>
        <label class="field span-all"><span>Command Staff page intro</span><textarea class="in" name="staffIntro" rows="2">${esc(s.staffIntro)}</textarea></label>
      </div></fieldset>
      <fieldset style="margin-top:14px"><legend>Detachments</legend><div class="grid3">
        ${DET_KEYS.map((k) => `<label class="field"><span>${k === "white_horse" ? "Detachment A" : "Detachment B"} full name</span><input class="in" name="det_${k}_name" value="${esc(s.detachments[k].name)}"/></label>
        <label class="field"><span>Short name</span><input class="in" name="det_${k}_short" value="${esc(s.detachments[k].short)}"/></label>
        <label class="field"><span>Korean</span><input class="in" name="det_${k}_kr" value="${esc(s.detachments[k].kr)}"/></label>`).join("")}
      </div></fieldset>
      <fieldset style="margin-top:14px"><legend>Points per operative listed</legend><div class="grid4" style="grid-template-columns:repeat(5,minmax(0,1fr))">
        ${[["training", "Training"], ["practice_raid", "Practice raid"], ["raid_victory", "Raid · victory"], ["raid_defeat", "Raid · defeat"], ["host_bonus", "Host bonus"]].map(([k, l]) => `<label class="field"><span>${l}</span><input class="in" type="number" min="0" max="100" name="pt_${k}" value="${esc(s.points[k])}"/></label>`).join("")}
      </div><p class="hint" style="margin:8px 0 0">New values apply to operations logged from now on. Past operations keep the points they were logged with (edit an operation to change it).</p></fieldset>
      <fieldset style="margin-top:14px"><legend>Feeds &amp; links</legend><div class="grid2">
        <label class="field"><span>Teletype ticker (one per line)</span><textarea class="in" name="ticker" rows="6">${esc(s.ticker.join("\n"))}</textarea></label>
        <label class="field"><span>Bottom subtitles (Speaker | line, one per line)</span><textarea class="in" name="transmissions" rows="6">${esc(s.transmissions.map((t) => `${t.speaker} | ${t.text}`).join("\n"))}</textarea></label>
        <label class="field"><span>Roblox community URL</span><input class="in" name="roblox" value="${esc(s.links.roblox)}" placeholder="https://www.roblox.com/communities/…"/></label>
        <label class="field"><span>Discord invite URL</span><input class="in" name="discord" value="${esc(s.links.discord)}" placeholder="https://discord.gg/…"/></label>
        <label class="span-all" style="display:flex;gap:10px;align-items:center;font-size:12px;cursor:pointer"><input type="checkbox" name="introEnabled" ${s.introEnabled !== false ? "checked" : ""} style="accent-color:var(--blue-hi)"/> Play the intro sequence on each visitor's first page load per session</label>
        <label class="span-all" style="display:flex;gap:10px;align-items:center;font-size:12px;cursor:pointer"><input type="checkbox" name="introSound" ${s.introSound !== false ? "checked" : ""} style="accent-color:var(--blue-hi)"/> Intro sound effects (visitors get a "click to establish uplink" screen first, because browsers only allow sound after a click)</label>
        <label class="span-all" style="display:flex;gap:10px;align-items:center;font-size:12px;cursor:pointer"><input type="checkbox" name="introMusic" ${s.introMusic !== false ? "checked" : ""} style="accent-color:var(--blue-hi)"/> Intro soundtrack (music bed under the sound effects)</label>
        <p class="hint span-all" style="margin:0">Upload and choose the loading-page music in the <button type="button" class="replay" data-atab="music" style="color:var(--blue-hi)">Music tab</button>.</p>
      </div></fieldset>
      <fieldset style="margin-top:14px"><legend>Rank list (lowest → highest)</legend>
        <textarea class="in" name="ranks" rows="10">${esc(s.ranks.join("\n"))}</textarea>
        <p class="hint" style="margin:8px 0 0">Format: <b>[CODE] Korean | ENGLISH</b>. Order matters: it's used for tie-breaks and sorting.</p></fieldset>
      <div class="btn-row" style="margin-top:16px;justify-content:flex-end"><button class="btn primary" type="submit">Save settings</button></div>
    </form>`;
  }

  /* ---- Music (loading-page soundtrack library) */
  const fmtDur = (d) => (d > 0 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")}` : "—");
  const MUSIC = { staged: null, stagedDur: 0, busy: false, playing: null, audio: null, url: null, timer: 0 };
  function adminMusic() {
    const s = S.settings, tracks = s.introTracks || [], sel = s.introTrackId || "";
    const cur = tracks.find((t) => t.id === sel);
    const row = (t) => `<tr data-track="${esc(t.id)}">
        <td><input type="radio" name="trackSel" value="${esc(t.id)}" ${sel === t.id ? "checked" : ""} style="accent-color:var(--blue-hi)" aria-label="Use ${esc(t.name)}"/></td>
        <td><input class="in" data-tf="name" value="${esc(t.name)}" maxlength="80" style="min-width:160px"/></td>
        <td class="n hint">${fmtDur(t.duration)}</td>
        <td><input class="in" type="number" data-tf="offset" min="0" step="0.1" value="${esc(t.offset || 0)}" style="width:90px"/></td>
        <td><input class="in" type="number" data-tf="volume" min="0" max="150" step="5" value="${esc(t.volume ?? 70)}" style="width:80px"/></td>
        <td><div class="row-actions"><button type="button" class="btn sm" data-preview="${esc(t.id)}">${MUSIC.playing === t.id ? "■ Stop" : "▶ Preview"}</button><button type="button" class="btn sm danger" data-deltrack="${esc(t.id)}">Delete</button></div></td>
      </tr>`;
    return `
    ${s.introMusic === false ? `<div class="mode-banner">■ The intro soundtrack is switched off in Site Settings, so no music plays on the loading page.</div>` : ""}
    <div class="grid2" style="margin-bottom:18px">
      <div class="panel brk">
        <div class="sec-h"><h2>Upload a track</h2></div>
        <div class="grid2">
          <label class="field span-all"><span>Audio file (MP3, M4A, OGG or WAV · up to 20 MB)</span><input class="in" type="file" id="music-file" accept="audio/*,.mp3,.m4a,.ogg,.oga,.wav"/></label>
          <label class="field span-all"><span>Track name</span><input class="in" id="music-name" maxlength="80" value="${esc(MUSIC.staged ? MUSIC.staged.name.replace(/\.[^.]+$/, "") : "")}" placeholder="e.g. Uplink theme"/></label>
        </div>
        <div class="btn-row" style="margin-top:12px;align-items:center"><button type="button" class="btn primary" data-act="music-upload" ${MUSIC.staged && !MUSIC.busy ? "" : "disabled"}>${MUSIC.busy ? "Uploading…" : "Upload"}</button><span class="hint" id="music-status">${MUSIC.staged ? `${esc(MUSIC.staged.name)} · ${(MUSIC.staged.size / 1048576).toFixed(1)} MB · ${fmtDur(MUSIC.stagedDur)}` : ""}</span></div>
        <p class="hint" style="margin:12px 0 0">Only upload music you have the rights to use on a public site. ${DB.LIVE ? "Files are stored in your Supabase storage." : "Demo mode: files are kept in this browser only, and aren't included in backups."}</p>
      </div>
      <div class="panel brk">
        <div class="sec-h"><h2>Loading page music</h2></div>
        <p style="margin:0 0 6px">Now playing: <b style="color:var(--hi)">${cur ? esc(cur.name) : "Uplink (built-in original)"}</b></p>
        <p class="hint" style="margin:0 0 14px">The track starts with the intro, stays in sync with it and fades out as the site appears. <b>Start at</b> skips into the track, so a big hit can land on the map cut at 7.3s (hit at 12.0s in the file → start at 4.7).</p>
        <div class="btn-row"><button type="button" class="btn blue" data-act="intro">▶ Test the intro</button></div>
      </div>
    </div>
    <form id="music-form" autocomplete="off">
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Use</th><th>Track</th><th class="n">Length</th><th>Start at (s)</th><th>Volume %</th><th></th></tr></thead>
        <tbody>
          <tr><td><input type="radio" name="trackSel" value="" ${!cur ? "checked" : ""} style="accent-color:var(--blue-hi)" aria-label="Use the built-in cue"/></td>
            <td><b style="color:var(--hi)">Uplink</b> <span class="hint">· built-in original cue, no file needed</span></td><td class="n hint">0:12</td><td class="hint">—</td><td class="hint">—</td>
            <td><div class="row-actions"><button type="button" class="btn sm" data-act="intro">▶ Hear it in the intro</button></div></td></tr>
          ${tracks.map(row).join("")}
        </tbody>
      </table></div>
      ${tracks.length ? "" : `<p class="hint" style="margin:10px 0 0">No uploaded tracks yet. Upload one above, then pick it here.</p>`}
      <div class="btn-row" style="margin-top:14px;justify-content:flex-end"><button class="btn primary" type="submit">Save music settings</button></div>
    </form>`;
  }
  function stopPreview() {
    clearTimeout(MUSIC.timer);
    if (MUSIC.audio) { try { MUSIC.audio.pause(); } catch (e) {} MUSIC.audio = null; }
    if (MUSIC.url) { URL.revokeObjectURL(MUSIC.url); MUSIC.url = null; }
    const was = MUSIC.playing; MUSIC.playing = null;
    if (was) { const b = document.querySelector(`[data-preview="${CSS.escape(was)}"]`); if (b) b.textContent = "▶ Preview"; }
  }
  async function preview(id) {
    if (MUSIC.playing === id) return stopPreview();
    stopPreview();
    const t = (S.settings.introTracks || []).find((x) => x.id === id); if (!t) return;
    const tr = document.querySelector(`tr[data-track="${CSS.escape(id)}"]`);
    const off = tr ? parseFloat(tr.querySelector('[data-tf="offset"]').value) || 0 : t.offset || 0;
    const vol = tr ? parseFloat(tr.querySelector('[data-tf="volume"]').value) : t.volume ?? 70;
    try {
      const blob = await DB.mediaBlob(t.src);
      MUSIC.url = URL.createObjectURL(blob);
      const a = new Audio(MUSIC.url); a.volume = Math.max(0, Math.min(1, (isNaN(vol) ? 70 : vol) / 100));
      await new Promise((res) => { a.addEventListener("loadedmetadata", res, { once: true }); a.addEventListener("error", res, { once: true }); });
      try { a.currentTime = off; } catch (e) {}
      await a.play();
      MUSIC.audio = a; MUSIC.playing = id;
      const b = document.querySelector(`[data-preview="${CSS.escape(id)}"]`); if (b) b.textContent = "■ Stop";
      MUSIC.timer = setTimeout(stopPreview, 12500);       // about the length of the intro
      a.addEventListener("ended", stopPreview, { once: true });
    } catch (e) { stopPreview(); toast("Couldn't play that track: " + (e.message || e), true); }
  }
  const audioDuration = (file) => new Promise((res) => {
    const u = URL.createObjectURL(file), a = new Audio();
    const done = (d) => { URL.revokeObjectURL(u); res(d); };
    a.preload = "metadata"; a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0); a.onerror = () => done(-1); a.src = u;
  });
  function readTrackRows() {
    return (S.settings.introTracks || []).map((t) => {
      const tr = document.querySelector(`tr[data-track="${CSS.escape(t.id)}"]`); if (!tr) return t;
      const q = (k) => tr.querySelector(`[data-tf="${k}"]`).value;
      return Object.assign({}, t, { name: q("name").trim() || t.name, offset: Math.max(0, parseFloat(q("offset")) || 0), volume: Math.max(0, Math.min(150, parseInt(q("volume"), 10) || 0)) });
    });
  }
  async function saveMusic(patch, msg) {
    const s2 = JSON.parse(JSON.stringify(S.settings));
    Object.assign(s2, patch); s2.introMusicSrc = "";     // the library replaces the old single-file setting
    const ok = await act(async () => { await DB.saveSettings(s2); await reload(); }, msg);
    if (ok) refresh();
    return ok;
  }

  /* ---- Backup */
  function adminBackup() {
    return `<div class="grid2">
      <div class="panel brk"><div class="sec-h"><h2>Export</h2></div><p class="hint">Download everything (roster, operations, command staff, settings) as one JSON file. Do this regularly.</p>
        <button class="btn primary" data-act="export">Download backup</button></div>
      <div class="panel brk"><div class="sec-h"><h2>Import</h2></div><p class="hint">Load a backup file. ${DB.LIVE ? "Rows are merged into Supabase (matching IDs are overwritten)." : "This replaces the demo data in this browser."} You can also use this to move your demo data into Supabase once you go live.</p>
        <input class="in" type="file" accept="application/json,.json" id="import-file"/></div>
      ${DB.LIVE ? "" : `<div class="panel brk"><div class="sec-h"><h2>Reset demo</h2></div><p class="hint">Wipe this browser's data and restore the sample roster.</p><button class="btn danger" data-act="reset">Reset demo data</button></div>`}
    </div>`;
  }

  /* ---------------------------------------------------------------- modal */
  function openModal(html) { const d = $("#modal"); d.innerHTML = html; if (!d.open) d.showModal(); }
  function closeModal() { const d = $("#modal"); if (d.open) d.close(); d.innerHTML = ""; }


  /* ================================================================ INTRO */
  // A two-faced coin with a stacked rim, so it reads as a solid disc when it turns edge-on.
  function coinLayers(thick = 10, src = "assets/emblem.png") {
    const h = thick / 2, n = Math.max(3, Math.min(8, Math.round(thick * 0.6)));
    let out = `<img class="face" src="${src}" alt="" style="transform:translateZ(${h}px)"/>`;
    for (let i = 0; i <= n; i++) out += `<img class="rim" src="${src}" alt="" style="transform:translateZ(${(-h + (thick * i) / n) * 0.98}px)"/>`;
    out += `<img class="back" src="${src}" alt="" style="transform:rotateY(180deg) translateZ(${h}px)"/>`;
    return out;
  }

  /* ================================================================== SFX
     Every sound is synthesised live with the Web Audio API (no audio files).
     Typing = short high beeps, one per character, ~30/s at 5–8.6 kHz, matched
     to the measurements of the reference intro. */
  const Sfx = (() => {
    const KEY = "1asfg_sound";
    let ctx = null, noise = null, bus = null, base = 0;
    const wanted = () => { try { return localStorage.getItem(KEY) !== "off" && localStorage.getItem("1asfg_intro_snd_off") !== "1"; } catch (e) { return true; } };
    const setWanted = (v) => { try { localStorage.setItem(KEY, v ? "on" : "off"); } catch (e) {} };
    function ensure() {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    function open(elapsed = 0) {
      if (!wanted() || !ensure()) return false;
      close(0.02);
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4;
      bus = ctx.createGain(); bus.gain.value = 0.85; bus.connect(comp); comp.connect(ctx.destination);
      base = ctx.currentTime + 0.04 - elapsed;   // intro time 0 in audio-clock seconds
      return true;
    }
    function close(fade = 0.25) {
      if (!bus || !ctx) return;
      const b = bus; bus = null;
      b.gain.cancelScheduledValues(ctx.currentTime);
      b.gain.setValueAtTime(b.gain.value, ctx.currentTime);
      b.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      setTimeout(() => { try { b.disconnect(); } catch (e) {} }, fade * 1000 + 300);
    }
    const at = (t) => base + t;
    const live = (t) => bus && at(t) >= ctx.currentTime - 0.01;
    function env(g, t, peak, a, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
    function tone(t, f, dur, { type = "sine", gain = 0.1, f2 = null, a = 0.004, curve = "exp", dest = null, detune = 0 } = {}) {
      if (!live(t)) return; const T = at(t);
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type;
      o.frequency.setValueAtTime(f, T);
      if (f2) curve === "lin" ? o.frequency.linearRampToValueAtTime(f2, T + dur) : o.frequency.exponentialRampToValueAtTime(f2, T + dur);
      o.detune.value = detune;
      env(g, T, gain, a, Math.max(0.005, dur - a)); o.connect(g); g.connect(dest || bus); o.start(T); o.stop(T + dur + 0.05);
    }
    function hiss(t, dur, { type = "bandpass", f = 3000, f2 = null, q = 1, gain = 0.1, a = 0.005, dest = null } = {}) {
      if (!live(t)) return; const T = at(t);
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, T);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, T + dur);
      const g = ctx.createGain(); env(g, T, gain, a, Math.max(0.005, dur - a));
      s.connect(fl); fl.connect(g); g.connect(dest || bus); s.start(T, Math.random() * 1.5); s.stop(T + dur + 0.05);
    }
    // one keystroke: a tiny pitched beep + a click of noise
    function tick(t, f, gain = 0.07) {
      tone(t, f * (1 + (Math.random() - 0.5) * 0.05), 0.009, { gain, a: 0.0008 });
      hiss(t, 0.004, { type: "highpass", f: 5000, gain: gain * 0.45, a: 0.0005 });
    }
    function type(t, n, dur, f, gain) { for (let i = 0; i < n; i++) tick(t + (i * dur) / Math.max(1, n), f, gain); }
    function glitch(t, dur, gain = 0.12) {
      for (let x = 0; x < dur; ) {
        const len = 0.012 + Math.random() * 0.045;
        hiss(t + x, len, { f: 600 + Math.random() * 6000, q: 0.7 + Math.random() * 4, gain: gain * (0.4 + Math.random() * 0.8), a: 0.001 });
        if (Math.random() < 0.35) tone(t + x, 120 + Math.random() * 1800, 0.02, { type: "square", gain: gain * 0.25, a: 0.001 });
        x += len + Math.random() * 0.03;
      }
    }
    function drone(t, end) {
      if (!bus) return; const T = at(Math.max(t, (ctx.currentTime - base))), E = at(end);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.018, T + 1.2);
      g.gain.setValueAtTime(0.018, E - 0.4); g.gain.exponentialRampToValueAtTime(0.0001, E);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 240; lp.Q.value = 0.5; lp.connect(g); g.connect(bus);
      [110, 164.8, 220.6].forEach((f, i) => { const o = ctx.createOscillator(); o.type = i === 1 ? "triangle" : "sine"; o.frequency.value = f; o.detune.value = (i - 1) * 6; o.connect(lp); o.start(T); o.stop(E + 0.1); });
      // faint electronic room tone, like the hum under the reference
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 6;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, T); ng.gain.exponentialRampToValueAtTime(0.025, T + 1); ng.gain.setValueAtTime(0.025, E - 0.4); ng.gain.exponentialRampToValueAtTime(0.0001, E);
      s.connect(bp); bp.connect(ng); ng.connect(bus); s.start(T); s.stop(E + 0.1);
    }


    /* ---- SOUNDTRACK: an original cue in the style of the reference (dark, D minor,
       ~82 bpm, driving 16th-note low ostinato, brass-like pads, low drum hits,
       dissonant high shimmer). Tempo is set so beat 10 lands exactly on the 7.3s map cut. */
    let rev = null;
    function reverbIR() {
      if (rev) return rev;
      const len = Math.floor(ctx.sampleRate * 2.8), b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
      return (rev = b);
    }
    function music(p) {
      let off = false; try { off = localStorage.getItem("1asfg_intro_music_off") === "1"; } catch (e) {}
      if (!bus || off) return false;
      /* "Uplink" — original cue. Dark, relentless action-score feel:
         full intensity almost at once, very heavy distorted sub, hollow mids,
         a bright high ticking figure on top, ~115 bpm. Beat 14 = the 7.3s map cut,
         beat 22 = the final hit as the site appears. */
      const B = 7.3 / 14;                               // ≈0.521 s per beat (115 bpm)
      const mb = ctx.createGain(); mb.gain.value = 0.82;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 28; hp.Q.value = 0.6;
      const scoop = ctx.createBiquadFilter(); scoop.type = "peaking"; scoop.frequency.value = 480; scoop.Q.value = 0.9; scoop.gain.value = -7; // hollow mids
      mb.connect(scoop); scoop.connect(hp); hp.connect(bus);
      const cv = ctx.createConvolver(); cv.buffer = reverbIR();
      const wet = ctx.createGain(); wet.gain.value = 0.45; cv.connect(wet); wet.connect(mb);
      const send = (amt) => { const g = ctx.createGain(); g.connect(mb); const s = ctx.createGain(); s.gain.value = amt; g.connect(s); s.connect(cv); return g; };
      // soft-clip saturation for the sub layer (gives the "growl" without harsh clipping)
      const sat = ctx.createWaveShaper(); const cu = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; cu[i] = Math.tanh(2.4 * x) / Math.tanh(2.4); }
      sat.curve = cu; sat.oversample = "2x";
      const subBus = ctx.createGain(); subBus.gain.value = 0.12; sat.connect(subBus); subBus.connect(mb);
      const lowBus = send(0.1), brassBus = send(0.3), topBus = send(0.5), drumBus = send(0.25), fx = send(0.6);

      const D1 = 36.71, D2 = 73.42, Eb2 = 77.78, F2 = 87.31, A1 = 55, Bb1 = 58.27, C2 = 65.41, Cs2 = 69.3;
      // harmony (my own progression): i – bVI – bVII (+ a chromatic C# push) – i – V – i
      const plan = [
        { at: 0,      root: D2,  fifth: D2 * 1.5 },
        { at: 6 * B,  root: Bb1, fifth: F2 },
        { at: 10 * B, root: C2,  fifth: C2 * 1.5 },
        { at: 12 * B, root: Cs2, fifth: Cs2 * 1.5 },     // chromatic climb into the cut
        { at: 14 * B, root: D2,  fifth: D2 * 1.5 },      // map cut
        { at: 18 * B, root: Eb2, fifth: Eb2 * 1.5 },     // Phrygian rub
        { at: 19 * B, root: A1,  fifth: A1 * 1.5 },
        { at: 22 * B, root: D2,  fifth: D2 * 1.5 },      // final hit
      ];
      const chordAt = (t) => { let c = plan[0]; for (const x of plan) if (x.at <= t + 1e-6) c = x; return c; };

      // 1) braams: swelling, distorted low brass on each chord change
      plan.forEach((c, i) => {
        const end = i < plan.length - 1 ? plan[i + 1].at : c.at + 3.4;
        const dur = end - c.at + 0.25; if (!live(c.at)) return;
        const T = at(c.at);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.2;
        lp.frequency.setValueAtTime(140, T); lp.frequency.exponentialRampToValueAtTime(i === 4 || i === 7 ? 1100 : 700, T + 0.35); lp.frequency.exponentialRampToValueAtTime(220, T + dur);
        const g = ctx.createGain(); const peak = i === 4 || i === 7 ? 0.16 : 0.11;
        g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(peak, T + (i === 0 ? 0.45 : 0.06)); g.gain.exponentialRampToValueAtTime(peak * 0.7, T + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
        [c.root / 2, c.root, c.fifth / 2].forEach((f, j) => [-11, 0, 11].forEach((dt) => {
          const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = dt + j * 2; o.connect(lp); o.start(T); o.stop(T + dur + 0.1);
        }));
        lp.connect(g); g.connect(brassBus);
        // the saturated sub under each braam (the very heavy low end)
        tone(c.at, c.root, dur, { gain: i === 4 || i === 7 ? 0.32 : 0.26, a: i === 0 ? 0.4 : 0.03, dest: sat });
      });

      // 2) 8th-note low pulse with my own accent pattern
      const accents = [1, 0, .6, 1, 0, .6, .8, .5];      // "DUM . da DUM . da da da"
      for (let k = 0; k < 48; k++) {
        const t = k * (B / 2); if (t > 11.9) break;
        const a = accents[k % 8]; if (!a || !live(t)) continue;
        const c = chordAt(t), d = B / 2 * 0.85, T = at(t);
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 4;
        lp.frequency.setValueAtTime(260 + 500 * a, T); lp.frequency.exponentialRampToValueAtTime(110, T + d);
        const g = ctx.createGain(); env(g, T, 0.13 * a * (t < 0.6 ? 0.4 + t : 1), 0.003, d);
        const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = c.root; o.connect(lp); lp.connect(g); g.connect(lowBus); o.start(T); o.stop(T + d + 0.05);
      }

      // 3) the bright edge: a high ticking semitone figure (800–2,500 Hz), 16ths, band-limited
      const fig = [0, 0, 1, 0, 0, 1, 0, 2, 0, 0, 1, 0, 2, 0, 1, 1];   // 0 = D6, 1 = Eb6 rub, 2 = A5
      const hz = [1174.66, 1244.51, 880];
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.5; const topGain = ctx.createGain(); topGain.gain.value = 28; bp.connect(topGain); topGain.connect(topBus);
      for (let k = 0; k < 96; k++) {
        const t = 0.5 + k * (B / 4); if (t > 11.4) break;
        const lvl = (k % 4 === 0 ? 0.05 : 0.032) * (t < 2 ? (t - 0.4) / 1.6 : 1);
        tone(t, hz[fig[k % 16]], 0.07, { type: "sawtooth", gain: lvl, a: 0.002, dest: bp });
      }
      // a thin high string line that rises a semitone into the cut, then holds
      tone(1.2, 587.33, 14 * B - 1.2, { type: "sawtooth", gain: 0.13, a: 1.4, dest: topBus });
      tone(12 * B, 622.25, 2 * B, { type: "sawtooth", gain: 0.13, a: 0.5, dest: topBus });
      tone(14 * B, 587.33, 8 * B + 1.5, { type: "sawtooth", gain: 0.15, a: 0.05, dest: topBus });

      // 4) drums: low hits on my own syncopated grid, denser after the cut
      const hit = (t, g = 0.5) => { tone(t, 120, 0.55, { gain: g * 0.6, f2: 48, a: 0.002, dest: drumBus }); hiss(t, 0.2, { type: "bandpass", f: 220, q: 0.9, gain: g * 0.55, a: 0.002, dest: drumBus }); hiss(t, 0.05, { f: 2200, q: 0.8, gain: g * 0.12, a: 0.001, dest: drumBus }); };
      [0, 3, 6, 8.5, 10, 11.5, 12, 13, 13.5].forEach((b) => hit(b * B, b < 6 ? 0.3 : 0.38));
      [14, 15.5, 16, 17, 17.5, 18, 19.5, 20, 20.75, 21, 21.25, 21.5, 21.75].forEach((b) => hit(b * B, b === 14 ? 0.8 : 0.45));
      for (let b = 14; b < 22; b += 0.5) hiss(b * B, 0.025, { type: "highpass", f: 8000, gain: 0.03, a: 0.001, dest: drumBus });
      // swell into the cut, then the impact
      hiss(14 * B - 1.6, 1.6, { f: 300, f2: 6000, q: 0.7, gain: 0.08, a: 1.55, dest: fx });
      tone(14 * B - 1.2, 300, 1.2, { type: "sawtooth", gain: 0.03, f2: 1200, a: 1.1, dest: fx });
      tone(14 * B, 58, 1.8, { gain: 0.3, f2: 32, a: 0.002, dest: sat });
      hiss(14 * B, 2.4, { f: 6000, f2: 1200, q: 0.6, gain: 0.09, a: 0.004, dest: fx });
      // final hit as the site appears; rings out underneath it
      hit(22 * B, 0.9); tone(22 * B, 55, 3, { gain: 0.3, f2: 32, a: 0.002, dest: sat });
      hiss(22 * B, 3.2, { f: 5200, f2: 1000, q: 0.6, gain: 0.09, a: 0.004, dest: fx });
      return true;
    }

    /* ---- CUSTOM MUSIC FILE (optional, set in Admin → Site Settings).
       Fetched as soon as settings load so it's ready by the time the visitor clicks;
       decoded and started in sync with the intro, faded out with everything else. */
    const track = { src: "", raw: null, buf: null, failed: false, loading: null, offset: 0, vol: 0.7 };
    function preload(src, offset = 0, vol = 70) {
      track.offset = Math.max(0, +offset || 0); track.vol = Math.max(0, Math.min(1.5, (+vol || 0) / 100));
      src = String(src || "").trim();
      if (src === track.src && !track.failed) return;
      Object.assign(track, { src, raw: null, buf: null, failed: false, loading: null });
      if (!src) return;
      track.loading = DB.mediaBlob(src).then((b) => b.arrayBuffer())
        .then((a) => { if (track.src === src) track.raw = a; })
        .catch((e) => { if (track.src === src) { track.failed = true; console.warn("Intro music could not be loaded:", src, e); } });
    }
    async function decoded() {
      if (track.buf) return track.buf;
      if (track.loading) await track.loading;
      if (!track.raw || !ctx) return null;
      try { track.buf = await new Promise((res, rej) => ctx.decodeAudioData(track.raw.slice(0), res, rej)); }
      catch (e) { track.failed = true; console.warn("Intro music could not be decoded:", e); }
      return track.buf;
    }
    function fileMusic() {
      if (!track.src || track.failed || !bus) return false;
      const myBus = bus;
      decoded().then((buf) => {
        if (!buf || bus !== myBus) return;               // skipped/muted while loading
        const now = ctx.currentTime, introT = Math.max(0, now - base);
        const from = track.offset + introT;              // stay in sync if it arrived late
        if (from >= buf.duration) return;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(Math.max(0.001, track.vol), now + (introT > 0.2 ? 0.25 : 0.05));
        src.connect(g); g.connect(myBus); src.start(now, from);
      });
      return true;
    }

    // the whole intro score; times are intro seconds (same clock as the CSS timeline)
    function intro(p, elapsed = 0) {
      if (!open(elapsed)) return;
      let scored = false;
      let musicOff = false; try { musicOff = localStorage.getItem("1asfg_intro_music_off") === "1"; } catch (e) {}
      try { scored = (!musicOff && fileMusic()) || music(p); } catch (e) { console.warn("music", e); }
      if (!scored) drone(0, p.end + 0.5);   // plain hum only when the soundtrack is off
      // materialise: sub thump + falling whoosh + the two digital chirps over a pulsing tone
      tone(0.02, 72, 1.1, { gain: 0.35, f2: 36, a: 0.02 });
      hiss(0.0, 1.35, { type: "lowpass", f: 7000, f2: 260, q: 0.8, gain: 0.22, a: 0.06 });
      tone(0.35, 7800, 1.25, { gain: 0.02, f2: 10400, a: 0.08 });
      tone(0.45, 8300, 1.1, { gain: 0.016, f2: 8650, a: 0.08 });
      for (let x = 0.3; x < 1.9; x += 0.0244) tone(x, 4650, 0.011, { gain: 0.012, a: 0.001 });
      // turns of the coin: a soft air swish each time it rotates
      for (let s = 1.5 + 0.99; s < 7.3; s += 2.75) hiss(s, 1.5, { f: 900, f2: 2600, q: 0.9, gain: 0.03, a: 0.5 });
      // name + bar typing
      type(1.5, p.nameLen, 1.1, 6500, 0.075);
      type(2.7, p.barLen, 0.6, 8600, 0.06);
      // HUD glitches in, then the big cut to the map + coin flying to the header
      glitch(6.2, 0.45, 0.07); glitch(6.8, 0.35, 0.05);
      glitch(7.15, 0.7, 0.14);
      hiss(7.62, 0.5, { type: "highpass", f: 500, f2: 6000, q: 0.7, gain: 0.07, a: 0.05 });
      // marker blinks, tags type line by line
      [7.9, 8.03, 8.28].forEach((x) => tone(x, 1180, 0.05, { type: "square", gain: 0.035 }));
      p.tags.forEach((tg) => type(tg.at, tg.n, tg.dur, 5000, 0.06));
      // lock-on, then glitch out
      tone(10.6, 990, 0.09, { gain: 0.06 }); tone(10.72, 1480, 0.16, { gain: 0.06 });
      glitch(p.end - 0.05, 0.55, 0.12);
    }
    return { wanted, setWanted, ensure, intro, close, preload, outro: () => { if (bus) { glitch((ctx.currentTime - base), 0.45, 0.1); close(1.1); } } };
  })();

  const Intro = (() => {
    const el = $("#intro");
    let timers = [], raf = 0, running = false, armed = false, t0 = 0;
    const SEEN = "1asfg_intro_seen", OFF = "1asfg_intro_off";
    const END_AT = 11400;
    const read = (k, ss = true) => { try { return (ss ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } };
    const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const TAG_START = 7.95, TAG_GAP = 0.58;

    function tagList() {
      const s = S.settings;
      const active = S.loaded ? S.members.filter((m) => m.status === "active").length : null;
      return [
        "TRACKING...",
        s.unitName.toUpperCase(),
        `${detName("white_horse", true).toUpperCase()} · ${detName("fierce_tiger", true).toUpperCase()}`,
        active === null ? "ROSTER SYNCING..." : `${fmtN(active)} OPERATIVES ACTIVE`,
        "SEOUL, REPUBLIC OF KOREA",
      ];
    }
    const tagDur = (t) => Math.min(0.75, 0.18 + t.length * 0.018);
    function tags() {
      $("#in-tags").innerHTML = tagList().map((t, i) =>
        `<span class="tag" data-i="${i}" style="--n:${t.length};--d:${tagDur(t).toFixed(2)}s;animation-delay:${(TAG_START + i * TAG_GAP).toFixed(2)}s">${esc(t)}</span>`).join("");
    }
    function score() {
      return { end: END_AT / 1000, nameLen: S.settings.unitName.length, barLen: Math.max(6, S.settings.unitNameKr.length * 2),
        tags: tagList().map((t, i) => ({ at: TAG_START + i * TAG_GAP, n: t.length, dur: tagDur(t) })) };
    }
    function sndLabel() {
      const on = Sfx.wanted();
      const b = $("#in-snd"); b.textContent = on ? "♪ Sound on" : "♪ Sound off"; b.classList.toggle("off", !on);
      $("#in-gate-snd").textContent = on ? "sound on" : "sound off";
    }
    function fill() {
      if (!el) return;
      const s = S.settings;
      const tk = (s.introTracks || []).find((t) => t.id === s.introTrackId);
      Sfx.preload(s.introMusic !== false && tk ? tk.src : "", tk ? tk.offset : 0, tk ? tk.volume : 70);
      $("#in-sys").textContent = `${s.unitShort.toUpperCase()} SYSTEMS`;
      $("#in-logo").textContent = s.unitShort.toUpperCase();
      $("#in-code").textContent = `RTWBN://${s.unitShort.toUpperCase()}-${String(S.events.length).padStart(4, "0")}-공수`;
      const nm = $("#in-name"); nm.textContent = s.unitName; nm.style.setProperty("--n", s.unitName.length);
      $("#in-kr").textContent = s.unitNameKr;
      const t = s.transmissions[0];
      if (t) $("#in-sub").innerHTML = `<b>${esc(t.speaker)}:</b> <span>${esc(t.text)}</span>`;
      const list = tagList();
      $$("#in-tags .tag").forEach((tg) => { const v = list[+tg.dataset.i]; if (v && tg.textContent !== v) { tg.textContent = v; tg.style.setProperty("--n", v.length); } });
      try {
        s.introEnabled === false ? localStorage.setItem(OFF, "1") : localStorage.removeItem(OFF);
        s.introSound === false ? localStorage.setItem("1asfg_intro_snd_off", "1") : localStorage.removeItem("1asfg_intro_snd_off");
        s.introMusic === false ? localStorage.setItem("1asfg_intro_music_off", "1") : localStorage.removeItem("1asfg_intro_music_off");
      } catch (e) {}
    }
    function feeds() {
      const rows = ["X_67001", "X_96105", "X_43552", "X_42309"];
      $("#in-feeds").innerHTML = rows.map((r) => `<tr><td>${r}</td>${[0, 1, 2].map(() => `<td>${(0.1 + Math.random() * 0.4).toFixed(2)}</td>`).join("")}</tr>`).join("");
    }
    function clock() {
      const alt = $("#in-alt"), lat = $("#in-lat"), lon = $("#in-lon");
      let last = 0;
      const step = (now) => {
        const t = (now - t0) / 1000;
        const f = Math.min(1, Math.max(0, (t - 7.3) / 4));
        alt.textContent = fmtN(Math.round((40000 - (1 - Math.pow(1 - f, 3)) * 27500) / 50) * 50);
        if (t < 8) {
          lat.textContent = `${30 + ((Math.random() * 12) | 0)}°${String((Math.random() * 60) | 0).padStart(2, "0")}′N`;
          lon.textContent = `${120 + ((Math.random() * 10) | 0)}°${String((Math.random() * 60) | 0).padStart(2, "0")}′E`;
        } else { lat.textContent = "37°34′N"; lon.textContent = "126°58′E"; }
        if (now - last > 450) { feeds(); last = now; }
        if (running) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    function end() {
      if (!running && !armed) return;
      const wasRunning = running;
      running = false; armed = false;
      timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf);
      try { sessionStorage.setItem(SEEN, "1"); } catch (e) {}
      if (wasRunning && performance.now() - t0 < END_AT - 200) Sfx.outro(); else Sfx.close(3.2);
      el.classList.remove("armed");
      el.classList.add("out");
      jumpLight("green");
      setTimeout(() => { el.hidden = true; el.classList.remove("play", "out"); document.body.classList.remove("intro-on"); }, 620);
    }
    function play() {
      if (!el || reduced()) { if (el) el.hidden = true; document.body.classList.remove("intro-on"); return; }
      timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf);
      armed = false; el.classList.remove("armed");
      const c = $("#in-coin3d"); if (!c.childNodes.length) c.innerHTML = coinLayers(Math.round(Math.min(innerHeight * 0.31, innerWidth * 0.52) * 0.05));
      tags(); feeds(); fill(); sndLabel();
      el.hidden = false; el.classList.remove("play", "out"); void el.offsetWidth;
      document.body.classList.add("intro-on");
      scrollTo(0, 0);
      running = true;
      el.classList.add("play");
      t0 = performance.now();
      Sfx.intro(score());
      clock();
      timers.push(setTimeout(end, END_AT));
    }
    // first visit with sound: wait for a click / key press (browsers block audio before one)
    function arm() {
      armed = true;
      fill(); sndLabel();
      el.hidden = false; el.classList.remove("play", "out"); el.classList.add("armed");
      document.body.classList.add("intro-on");
    }
    function boot() {
      if (!el) return;
      if (read(SEEN) || read(OFF, false) || reduced()) { el.hidden = true; return; }
      const activated = navigator.userActivation && navigator.userActivation.hasBeenActive;
      if (Sfx.wanted() && !activated) arm(); else play();
    }
    if (el) {
      $("#in-skip").addEventListener("click", (e) => { e.stopPropagation(); end(); });
      $("#in-snd").addEventListener("click", (e) => {
        e.stopPropagation();
        const on = !Sfx.wanted(); Sfx.setWanted(on); sndLabel();
        if (!on) Sfx.close(0.2);
        else if (running) Sfx.intro(score(), (performance.now() - t0) / 1000);
      });
      el.addEventListener("click", () => { if (armed) play(); else if (running) end(); });
      addEventListener("keydown", (e) => {
        if (armed) { e.preventDefault(); if (e.key === "Escape") end(); else play(); return; }
        if (running && ["Escape", "Enter", " "].includes(e.key)) { e.preventDefault(); end(); }
      });
    }
    return { boot, play, fill, end };
  })();

  /* --------------------------------------------------------------- router */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, "");
    const [path, qs] = h.split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const params = Object.fromEntries(new URLSearchParams(qs || ""));
    return { parts, params };
  }

  let rendering = 0;
  async function render(quiet) {
    const my = ++rendering;
    const { parts, params } = parseHash();
    const r = parts[0] || "command";
    const navR = r === "members" ? "leaderboard" : r;
    $$("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.route === navR));
    const PATHS = { command: "COMMAND", operations: "OPS-LOG", leaderboard: "MERIT", members: "PERSONNEL", staff: "COMMAND-STAFF", admin: "CONSOLE" };
    $("#tl-path").textContent = `${(S.settings.unitShort || "1ASFG").toUpperCase()} // OPS-NET // ${PATHS[r] || "COMMAND"}`;
    jumpLight("red");
    let html;
    try {
      if (!S.loaded) await reload();
      switch (r) {
        case "operations": html = parts[1] ? viewOperation(parts[1]) : viewOperations(params); break;
        case "leaderboard": html = viewLeaderboard(params); break;
        case "members": html = viewMember(parts[1]); break;
        case "staff": html = viewStaff(); break;
        case "admin": html = await viewAdmin(); break;
        default: html = viewCommand();
      }
    } catch (err) {
      console.error(err);
      html = `<div class="gate panel brk"><span class="tag red">UPLINK FAILURE</span><h1>No signal</h1><p class="err">${esc(err.message || err)}</p><p class="hint">Check SUPABASE_URL / SUPABASE_ANON_KEY in config.js and that supabase/schema.sql has been run.</p><button class="btn" onclick="location.reload()">Retry</button></div>`;
    }
    if (my !== rendering) return;
    const v = $("#view");
    v.innerHTML = html;
    if (!quiet) { v.classList.remove("enter"); void v.offsetWidth; v.classList.add("enter"); }
    setTimeout(() => jumpLight("green"), 350);
    updateAltimeter();
    if (r === "admin" && UI.adminTab === "log") drawPicker();
  }
  // re-render without re-animating or scrolling (for in-page filter changes)
  async function refresh() { const y = scrollY; await render(true); scrollTo(0, y); }

  async function act(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); }
    catch (e) { console.error(e); toast(e.message || "Something went wrong", true); return false; }
    return true;
  }

  /* --------------------------------------------------------------- events */
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("button, [data-act]"); if (!t) return;
    const d = t.dataset;

    if (d.optype) { UI.opsType = d.optype; if (location.hash.includes("type=")) history.replaceState(null, "", "#/operations"); return refresh(); }
    if (d.lbview) { UI.lbView = d.lbview; history.replaceState(null, "", "#/leaderboard"); return refresh(); }
    if (d.lbcat) { UI.lbCat = d.lbcat; return refresh(); }
    if (d.more) { const e = S.events.find((x) => x.id === d.more); if (e) t.closest(".att").outerHTML = attendeesHtml(e, 9999); return; }
    if (d.atab) { stopPreview(); if (d.act === "new-op") { UI.editEventId = null; UI.pick = new Set(); } UI.adminTab = d.atab; UI.adminQ = ""; return refresh(); }

    switch (d.act) {
      case "intro": return Intro.play();
      case "signout": await DB.signOut(); toast("Signed out"); return render();
      case "close": return closeModal();
      case "cancel-edit": UI.editEventId = null; UI.pick = new Set(); return refresh();
      case "pick-shown": $$("#pick-list [data-pick]").forEach((c) => UI.pick.add(c.dataset.pick)); return drawPicker();
      case "pick-clear": UI.pick.clear(); return drawPicker();
      case "pick-host": { const h = $("#ev-form").host_id.value; if (h) { UI.pick.add(h); drawPicker(); } else toast("Pick a host first", true); return; }
      case "pick-paste": {
        const raw = $("#pick-paste").value; const names = raw.split(/[\s,;]+/).map((x) => x.replace(/^@/, "").trim()).filter(Boolean);
        const idx = {}; S.members.forEach((m) => (idx[m.username.toLowerCase()] = m.id));
        const miss = []; let n = 0;
        names.forEach((nm) => { const id = idx[nm.toLowerCase()]; if (id) { if (!UI.pick.has(id)) n++; UI.pick.add(id); } else miss.push(nm); });
        $("#pick-paste-msg").innerHTML = `Added ${n}.` + (miss.length ? ` <span style="color:#ff8f86">Not on roster: ${esc(miss.join(", "))}</span>` : "");
        return drawPicker();
      }
      case "bulk": return bulkModal();
      case "new-leader": return leaderModal(null);
      case "clear-photo": pendingPhoto = { blob: null, clear: true }; $("#lead-prev").textContent = "NO PHOTO"; $("#lead-form").photo_url.value = ""; return;
      case "export": {
        const data = { exported_at: new Date().toISOString(), members: S.members, events: S.events, leadership: S.leadership, settings: S.settings };
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        a.download = `1asfg-backup-${todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); return;
      }
      case "reset": if (confirm("Reset all demo data in this browser?")) { await act(async () => { await DB.resetDemo(); await reload(); }, "Demo data restored"); refresh(); } return;
    }

    if (d.preview) return preview(d.preview);
    if (d.deltrack) {
      const t = (S.settings.introTracks || []).find((x) => x.id === d.deltrack);
      if (!t || !confirm(`Delete "${t.name}"? ${t.path ? "The file is removed from storage." : ""}`)) return;
      if (MUSIC.playing === t.id) stopPreview();
      try { await DB.deleteMedia(t.path); } catch (e) { console.warn(e); }
      return saveMusic({ introTracks: readTrackRows().filter((x) => x.id !== t.id), introTrackId: S.settings.introTrackId === t.id ? "" : S.settings.introTrackId }, "Track deleted");
    }
    if (d.act === "music-upload") {
      const f = MUSIC.staged; if (!f || MUSIC.busy) return;
      MUSIC.busy = true; t.disabled = true; t.textContent = "Uploading…";
      const name = ($("#music-name").value || f.name.replace(/\.[^.]+$/, "")).trim().slice(0, 80);
      try {
        const up = await DB.uploadMedia(f);
        const tr = { id: DB.uid(), name, src: up.src, path: up.path, offset: 0, volume: 70, duration: MUSIC.stagedDur > 0 ? MUSIC.stagedDur : 0 };
        MUSIC.staged = null; MUSIC.stagedDur = 0; MUSIC.busy = false;
        await saveMusic({ introTracks: readTrackRows().concat(tr), introTrackId: tr.id }, `Uploaded · now playing "${name}"`);
      } catch (e) { MUSIC.busy = false; t.disabled = false; t.textContent = "Upload"; toast("Upload failed: " + (e.message || e), true); }
      return;
    }
    if (d.editev) { const e = S.events.find((x) => x.id === d.editev); UI.editEventId = d.editev; UI.pick = new Set(e ? e.attendees : []); UI.adminTab = "log"; UI.pickQ = ""; scrollTo(0, 0); return render(); }
    if (d.delev) { const e = S.events.find((x) => x.id === d.delev); if (e && confirm(`Delete "${e.title}" (${e.event_date})? Its points are removed from everyone who attended.`)) { await act(async () => { await DB.deleteEvent(e.id); await reload(); }, "Operation deleted"); refresh(); } return; }
    if (d.editmem) { const m = S.byId[d.editmem]; if (m) memberModal(m); return; }
    if (d.delmem) { const m = S.byId[d.delmem]; if (m && confirm(`Remove ${m.username} from the roster entirely? Their attendance is removed from past operations too.\n\nTip: set status to DISCHARGED instead to keep history.`)) { await act(async () => { await DB.deleteMember(m.id); await reload(); }, "Removed from roster"); refresh(); } return; }
    if (d.editlead) { const l = S.leadership.find((x) => x.id === d.editlead); if (l) leaderModal(l); return; }
    if (d.dellead) { const l = S.leadership.find((x) => x.id === d.dellead); if (l && confirm(`Remove ${l.name} from Command Staff?`)) { await act(async () => { await DB.deleteLeader(l.id); await reload(); }, "Removed"); refresh(); } return; }
    if (d.move) {
      const list = S.leadership.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const i = list.findIndex((x) => x.id === d.move), j = i + +d.dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await act(async () => { for (let k = 0; k < list.length; k++) if (list[k].sort_order !== k + 1) { list[k].sort_order = k + 1; await DB.saveLeader(list[k]); } await reload(); });
      return refresh();
    }
  });

  document.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.id === "ops-q") { UI.opsQ = t.value; clearTimeout(t._d); t._d = setTimeout(async () => { await refresh(); const n = $("#ops-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); }
    if (t.id === "admin-q") { UI.adminQ = t.value; clearTimeout(t._d); t._d = setTimeout(async () => { await refresh(); const n = $("#admin-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); }
    if (t.id === "pick-q") { UI.pickQ = t.value; drawPicker(); }
    if (t.name === "points_each") updatePickTotals();
  });

  document.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.id === "ops-month") { UI.opsMonth = t.value; return refresh(); }
    if (t.id === "ops-det") { UI.opsDet = t.value; return refresh(); }
    if (t.id === "lb-period") { UI.lbPeriod = t.value; return refresh(); }
    if (t.id === "lb-det") { UI.lbDet = t.value; return refresh(); }
    if (t.dataset.pick) { t.checked ? UI.pick.add(t.dataset.pick) : UI.pick.delete(t.dataset.pick); t.closest("label").classList.toggle("sel", t.checked); return updatePickTotals(); }
    const f = t.form;
    if (f && f.getAttribute("id") === "ev-form" && (t.name === "type" || t.name === "outcome")) {
      if (t.name === "type" && t.value === "training") f.outcome.value = "";
      if (t.name === "type" && t.value === "raid" && !f.outcome.value) f.outcome.value = "victory";
      f.points_each.value = defaultPoints(f.type.value, f.outcome.value); updatePickTotals();
    }
    if (f && f.getAttribute("id") === "ev-form" && t.name === "host_id") updatePickTotals();
    if (t.id === "music-file") {
      const f = t.files[0]; MUSIC.staged = null; MUSIC.stagedDur = 0;
      if (f) {
        if (f.size > 20 * 1048576) { toast("That file is over 20 MB. Trim or compress it first.", true); t.value = ""; }
        else if (f.type && !/^audio\//.test(f.type)) { toast("That isn't an audio file.", true); t.value = ""; }
        else {
          const dur = await audioDuration(f);
          if (dur < 0) { toast("This browser can't play that file. Try MP3 or M4A.", true); t.value = ""; }
          else { MUSIC.staged = f; MUSIC.stagedDur = dur; }
        }
      }
      const n = $("#music-name"); if (n && MUSIC.staged && !n.value) n.value = MUSIC.staged.name.replace(/\.[^.]+$/, "");
      $("#music-status").textContent = MUSIC.staged ? `${MUSIC.staged.name} · ${(MUSIC.staged.size / 1048576).toFixed(1)} MB · ${fmtDur(MUSIC.stagedDur)}` : "";
      const b = document.querySelector('[data-act="music-upload"]'); if (b) b.disabled = !MUSIC.staged;
      return;
    }
    if (t.id === "lead-file" && t.files[0]) {
      try { const blob = await resizeImage(t.files[0]); pendingPhoto = { blob }; $("#lead-prev").innerHTML = `<img src="${URL.createObjectURL(blob)}" alt=""/>`; }
      catch (e) { toast(e.message, true); }
    }
    if (f && f.getAttribute("id") === "lead-form" && t.name === "member_id" && t.value) {
      const m = S.byId[t.value];
      if (m) { if (!f.name.value) f.name.value = m.username; if (!f.rank.value && m.rank) f.rank.value = m.rank; if (m.detachment) f.detachment.value = m.detachment; }
    }
    if (t.id === "import-file" && t.files[0]) {
      try {
        const data = JSON.parse(await t.files[0].text());
        if (!data || !Array.isArray(data.members)) throw new Error("That doesn't look like a 1ASFG backup file.");
        if (!confirm(`Import ${data.members.length} members, ${(data.events || []).length} operations, ${(data.leadership || []).length} staff?`)) return;
        await act(async () => { await DB.importAll(data); await reload(); }, "Backup imported");
        refresh();
      } catch (e) { toast(e.message, true); }
    }
  });

  document.addEventListener("submit", async (ev) => {
    const f = ev.target; ev.preventDefault();
    const btn = f.querySelector("[type=submit]"); if (btn) btn.disabled = true;
    const val = (n) => (f[n] ? f[n].value.trim() : "");
    try {
      switch (f.getAttribute("id")) {
        case "login-form": {
          try { await DB.signIn(val("email"), f.pass.value); await render(); }
          catch (e) { $("#login-err").textContent = e.message; }
          break;
        }
        case "ev-form": {
          if (!UI.pick.size && !confirm("No attendees selected. Log anyway?")) break;
          const editing = UI.editEventId;
          const e = { id: editing || null, title: val("title"), type: val("type"), outcome: val("outcome") || null, event_date: val("event_date"), host_id: val("host_id") || null,
            points_each: Math.max(0, parseInt(val("points_each"), 10) || 0), proof_url: val("proof_url"), summary: val("summary"), attendees: Array.from(UI.pick) };
          if (editing) { const old = S.events.find((x) => x.id === editing); if (old) e.created_at = old.created_at; }
          const ok = await act(async () => { await DB.saveEvent(e); await reload(); }, editing ? "Operation updated" : `Logged · ${e.attendees.length} × ${e.points_each} pts`);
          if (ok) { UI.editEventId = null; UI.pick = new Set(); UI.pickQ = ""; if (editing) UI.adminTab = "ops"; await refresh(); }
          break;
        }
        case "mem-add": {
          const ok = await act(async () => { await DB.saveMember({ username: val("username"), rank: val("rank"), detachment: val("detachment"), joined_on: val("joined_on"), status: "active", notes: "" }); await reload(); }, `${val("username")} enlisted`);
          if (ok) { await refresh(); const u = $("#mem-add [name=username]"); if (u) u.focus(); }
          break;
        }
        case "mem-edit": {
          const old = S.byId[val("id")];
          const ok = await act(async () => { await DB.saveMember(Object.assign({}, old, { username: val("username"), rank: val("rank"), detachment: val("detachment"), status: val("status"), joined_on: val("joined_on"), notes: val("notes") })); await reload(); }, "Saved");
          if (ok) { closeModal(); refresh(); }
          break;
        }
        case "mem-bulk": {
          const defDet = val("def_det"), defRank = val("def_rank");
          const rows = f.rows.value.split(/\n/).map((ln) => ln.trim()).filter(Boolean).map((ln) => {
            const [u, r, d] = ln.split(/\s*[,\t]\s*/);
            return { username: (u || "").replace(/^@/, ""), rank: matchRank(r) || defRank, detachment: matchDet(d) || defDet, joined_on: todayISO() };
          }).filter((r) => r.username);
          if (!rows.length) { toast("Nothing to import", true); break; }
          let n = 0;
          const ok = await act(async () => { n = await DB.bulkAddMembers(rows); await reload(); });
          if (ok) { toast(`Imported ${n} · skipped ${rows.length - n} existing`); closeModal(); refresh(); }
          break;
        }
        case "lead-form": {
          let photo = val("cur_photo");
          const urlField = val("photo_url");
          const ok = await act(async () => {
            if (pendingPhoto && pendingPhoto.blob) photo = await DB.uploadPhoto(pendingPhoto.blob);
            else if (pendingPhoto && pendingPhoto.clear) photo = urlField || "";
            else if (urlField) photo = urlField;
            const id = val("id");
            const old = id ? S.leadership.find((x) => x.id === id) : null;
            const maxOrder = S.leadership.reduce((a, x) => Math.max(a, x.sort_order || 0), 0);
            await DB.saveLeader({ id: id || null, name: val("name"), position: val("position"), rank: val("rank"), section: val("section") || "Command", detachment: val("detachment"), photo_url: photo, bio: val("bio"), member_id: val("member_id") || null, sort_order: old ? old.sort_order : maxOrder + 1 });
            await reload();
          }, "Command staff saved");
          if (ok) { closeModal(); refresh(); }
          break;
        }
        case "music-form": {
          stopPreview();
          const pick = f.querySelector('input[name="trackSel"]:checked');
          await saveMusic({ introTracks: readTrackRows(), introTrackId: pick ? pick.value : "" }, "Music settings saved");
          break;
        }
        case "set-form": {
          const s = JSON.parse(JSON.stringify(S.settings));
          ["unitName", "unitShort", "unitNameKr", "kicker", "motto", "heroText", "staffIntro"].forEach((k) => (s[k] = val(k) || s[k]));
          DET_KEYS.forEach((k) => ["name", "short", "kr"].forEach((p) => (s.detachments[k][p] = val(`det_${k}_${p}`) || s.detachments[k][p])));
          Object.keys(s.points).forEach((k) => (s.points[k] = Math.max(0, parseInt(val("pt_" + k), 10) || 0)));
          s.ticker = f.ticker.value.split("\n").map((x) => x.trim()).filter(Boolean);
          s.transmissions = f.transmissions.value.split("\n").map((x) => x.trim()).filter(Boolean).map((ln) => { const i = ln.indexOf("|"); return i < 0 ? { speaker: "Command", text: ln } : { speaker: ln.slice(0, i).trim() || "Command", text: ln.slice(i + 1).trim() }; });
          s.ranks = f.ranks.value.split("\n").map((x) => x.trim()).filter(Boolean);
          s.links = { roblox: val("roblox"), discord: val("discord") };
          s.introEnabled = f.introEnabled.checked;
          s.introSound = f.introSound.checked;
          s.introMusic = f.introMusic.checked;

          const ok = await act(async () => { await DB.saveSettings(s); await reload(); }, "Settings saved");
          if (ok) refresh();
          break;
        }
      }
    } finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
  });

  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
  window.addEventListener("hashchange", () => { closeModal(); stopPreview(); render(); scrollTo(0, 0); });

  Intro.boot();
  startHud();
  render();
})();
