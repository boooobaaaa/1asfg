/* OPSNET — front end. Works in two modes:
   LIVE  : SUPABASE_URL + SUPABASE_ANON_KEY set in config.js
   DEMO  : no keys → built-in sample data, changes kept in memory only */
(function () {
"use strict";
const CFG = window.OPSNET_CONFIG || {};
// Accept common paste mistakes: trailing slash, /rest/v1 paths, or the dashboard link.
if (CFG.SUPABASE_URL) {
  let u = String(CFG.SUPABASE_URL).trim();
  const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) u = "https://" + dash[1] + ".supabase.co";
  const m = u.match(/^(https?:\/\/[^\/?#]+)/i);
  CFG.SUPABASE_URL = m ? m[1] : u;
  CFG.SUPABASE_ANON_KEY = String(CFG.SUPABASE_ANON_KEY || "").trim();
}
const LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const TICKER = ["第1空輸特戰團", "안 되면 되게 하라", "全 部隊 注意 · 作戰 記錄 更新 中", "許可된 人員만 接近", "+++ 電文 終了 +++"];
const TYPES = { training: "Training", practice: "Practice raid", raid: "Raid" };
const DEFCON_TXT = { 5: "Normal readiness. Routine training cycle.", 4: "Increased intelligence watch and strengthened security.", 3: "Elevated readiness. Expect short-notice operations.", 2: "High alert. Stand by for deployment orders.", 1: "Maximum readiness. All hands report immediately." };

/* Unit rank list, lowest → highest */
const RANKS = [
  ["ENL", "Enlisted"], ["SSG", "Staff Sergeant"], ["SFC", "Sergeant First Class"], ["MSG", "Master Sergeant"],
  ["2LT", "Second Lieutenant"], ["1LT", "First Lieutenant"], ["CPT", "Captain"], ["MAJ", "Major"],
  ["LTC", "Lieutenant Colonel"], ["COL", "Colonel"]
];
const RANK_IDX = Object.fromEntries(RANKS.map(([c], i) => [c, i]));
const rankName = c => (RANKS.find(r => r[0] === c) || [c, c || "—"])[1];
const rankIdx = c => (c in RANK_IDX ? RANK_IDX[c] : -1);
const isOfficer = c => rankIdx(c) >= RANK_IDX["2LT"];

/* Billets */
const BILLETS = {
  GC:  { name: "Group Commander",            short: "GRP CDR", level: "hq",  order: 1 },
  DGC: { name: "Deputy Group Commander",     short: "DEP CDR", level: "hq",  order: 2 },
  COS: { name: "Chief of Staff",             short: "COS",     level: "hq",  order: 3 },
  CO:  { name: "Company Commanding Officer", short: "CO",      level: "coy", order: 1 },
  XO:  { name: "Company Executive Officer",  short: "XO",      level: "coy", order: 2 }
};
const HQ_BILLETS = ["GC", "DGC", "COS"], COY_BILLETS = ["CO", "XO"];

/* ─── tiny helpers ─────────────────────────────────────────────────── */
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const lc = s => (s || "").trim().toLowerCase();
const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const thisMonth = () => today().slice(0, 7);
const code = n => "OP-" + String(n || 0).padStart(4, "0");
const parseNames = s => [...new Set((s || "").split(/[\s,;]+/).map(x => x.trim().replace(/^@/, "")).filter(Boolean))]
  .filter((x, i, a) => a.findIndex(y => lc(y) === lc(x)) === i);
let toastT;
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.classList.toggle("bad", !!bad); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }
function armed(btn, fn) {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("armed")) { btn.classList.remove("armed"); btn.textContent = btn.dataset.l; fn(); return; }
    btn.dataset.l = btn.textContent; btn.classList.add("armed"); btn.textContent = "Confirm?";
    setTimeout(() => { if (btn.classList.contains("armed")) { btn.classList.remove("armed"); btn.textContent = btn.dataset.l; } }, 4000);
  });
}
const store = {
  get(k, d) { try { const v = localStorage.getItem("opsnet." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("opsnet." + k, JSON.stringify(v)); } catch {} }
};
function options(sel, list, keep = true) { const v = sel.value; sel.replaceChildren(...list.map(([val, txt]) => el("option", { value: val }, txt))); if (keep && list.some(o => o[0] === v)) sel.value = v; }

/* ─── state ────────────────────────────────────────────────────────── */
const S = {
  units: [], formations: [], settings: { bulletin: "", directive: "", defcon: 4, ticker: [], points: { training: 1, practice: 2, raid: 3 } },
  personnel: [], ops: [], unit: store.get("unit", null),
  opType: "all", period: "month", lbDet: "all", lbSort: { k: "points", dir: -1 },
  session: null, admin: false, editOp: null, editP: null, editF: null, missing: {}
};
const pts = () => Object.assign({ training: 1, practice: 2, raid: 3 }, S.settings.points || {});
const unitOps = () => S.ops.filter(o => o.unit === S.unit);
const curUnit = () => S.units.find(u => u.id === S.unit) || S.units[0] || { id: "—", name: "Unit" };
const person = name => S.personnel.find(p => lc(p.username) === lc(name));
const dets = () => S.formations.filter(f => f.kind === "detachment").sort((a, b) => (a.sort || 0) - (b.sort || 0));
const coys = det => S.formations.filter(f => f.kind === "company" && (!det || f.parent === det)).sort((a, b) => (a.sort || 0) - (b.sort || 0));
const fm = id => S.formations.find(f => f.id === id);
const detShort = id => { const d = fm(id); return d ? (d.name_local ? d.name_local + " " : "") + d.id : "Group-wide"; };
function assignLabel(p) {
  if (!p) return "—";
  if (p.billet && BILLETS[p.billet] && BILLETS[p.billet].level === "hq") return "HQ Element";
  const c = fm(p.company), d = fm(p.detachment || (c && c.parent));
  if (c && d) return d.id + " · " + c.name;
  if (d) return d.id;
  return "Unassigned";
}
const byRank = (a, b) => rankIdx(b.rank) - rankIdx(a.rank) || a.username.localeCompare(b.username);

/* ─── data layer ───────────────────────────────────────────────────── */
const api = LIVE ? liveApi() : demoApi();

function liveApi() {
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  async function all(table, optional) {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await sb.from(table).select("*").range(from, from + step - 1);
      if (error) { if (optional) { console.warn(table, error); S.missing[table] = error.message || "unreadable"; return []; } throw error; }
      out.push(...data); if (data.length < step) break;
    }
    return out;
  }
  const chk = ({ error }) => { if (error) throw error; };
  return {
    async load() {
      S.missing = {};
      const [units, formations, settings, personnel, ops, att] = await Promise.all([
        all("units"), all("formations", true), sb.from("settings").select("*").eq("id", 1).maybeSingle(), all("personnel"), all("operations"), all("attendance")
      ]);
      const byOp = {}; for (const a of att) (byOp[a.op_id] ||= []).push(a.username);
      return { units: units.sort((a, b) => (a.sort || 0) - (b.sort || 0)), formations, settings: settings.data || {}, personnel,
        ops: ops.map(o => ({ ...o, attendees: byOp[o.id] || [] })) };
    },
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async isAdmin(uid) { const { data } = await sb.from("admins").select("user_id").eq("user_id", uid).maybeSingle(); return !!data; },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return data.session; },
    async signOut() { await sb.auth.signOut(); },
    async saveOp(op, names) {
      let id = op.id;
      const row = { unit: op.unit, type: op.type, name: op.name, date: op.date, host: op.host || null, summary: op.summary || null, proof_url: op.proof_url || null, detachment: op.detachment || null };
      if (id) chk(await sb.from("operations").update(row).eq("id", id));
      else { const r = await sb.from("operations").insert(row).select("id").single(); chk(r); id = r.data.id; }
      chk(await sb.from("attendance").delete().eq("op_id", id));
      if (names.length) chk(await sb.from("attendance").insert(names.map(u => ({ op_id: id, username: u }))));
      const missing = names.concat(op.host ? [op.host] : []).filter(n => !person(n));
      if (missing.length) chk(await sb.from("personnel").upsert(missing.map(u => ({ username: u, unit: op.unit, joined: op.date, status: "active", rank: "ENL", detachment: op.detachment || null })), { onConflict: "username", ignoreDuplicates: true }));
    },
    async deleteOp(id) { chk(await sb.from("operations").delete().eq("id", id)); },
    async savePerson(p) {
      const row = { username: p.username, rank: p.rank || "ENL", unit: p.unit || null, joined: p.joined || null, status: p.status, detachment: p.detachment || null, company: p.company || null, billet: p.billet || null };
      chk(p.id ? await sb.from("personnel").update(row).eq("id", p.id) : await sb.from("personnel").insert(row));
    },
    async clearBillet(id) { chk(await sb.from("personnel").update({ billet: null }).eq("id", id)); },
    async deletePerson(id) { chk(await sb.from("personnel").delete().eq("id", id)); },
    async saveFormation(f) { chk(await sb.from("formations").upsert(f)); },
    async deleteFormation(id) { chk(await sb.from("formations").delete().eq("id", id)); },
    async saveSettings(s) { chk(await sb.from("settings").upsert({ id: 1, ...s })); },
    async saveUnit(u) { chk(await sb.from("units").upsert(u)); },
    async deleteUnit(id) { chk(await sb.from("units").delete().eq("id", id)); }
  };
}

function demoApi() {
  // [username, rank, billet, detachment, company]
  const roster = [
    ["danielmax", "COL", "GC", null, null], ["rikilol999", "LTC", "DGC", null, null], ["AAACarl_114514", "MAJ", "COS", null, null],
    ["eliteboi126", "CPT", "CO", "FTAD", "FT-1"], ["DESMON_66", "1LT", "XO", "FTAD", "FT-1"], ["ujim106", "MSG", null, "FTAD", "FT-1"], ["knightofkneon", "SSG", null, "FTAD", "FT-1"], ["Soul_Zephyrus", "ENL", null, "FTAD", "FT-1"],
    ["Tactical_Sheperd", "CPT", "CO", "FTAD", "FT-2"], ["paranormal_caramel", "SFC", null, "FTAD", "FT-2"], ["ironwake_07", "ENL", null, "FTAD", "FT-2"],
    ["khalid_cool17", "CPT", "CO", "WHAD", "WH-1"], ["Cheese_boi429", "2LT", "XO", "WHAD", "WH-1"], ["coupchap", "SFC", null, "WHAD", "WH-1"], ["DaniloW50", "ENL", null, "WHAD", "WH-1"],
    ["CaptainTrike", "1LT", "CO", "WHAD", "WH-2"], ["SableFox22", "SSG", null, "WHAD", "WH-2"], ["northgate_kid", "ENL", null, "WHAD", "WH-2"], ["wcnmbdnnb", "ENL", null, "WHAD", null]
  ];
  const personnel = roster.map(([u, rank, billet, detachment, company], i) => ({ id: "p" + i, username: u, rank, billet, detachment, company, unit: "1ASFG", joined: "2026-09-15", status: u === "northgate_kid" ? "inactive" : "active" }));
  const tpl = [["Training Operation", "training", "FTAD"], ["Money Farm", "training", "WHAD"], ["Airborne Insertion Drill", "practice", null], ["Operation Night Falcon", "raid", "WHAD"], ["Night Patrol", "training", "FTAD"], ["Compound Breach", "practice", "FTAD"], ["Operation Iron Eagle", "raid", null], ["Formation & Drill", "training", "WHAD"]];
  const ops = []; let n = 0;
  for (let d = 2; d <= 48; d += 3) {
    const [name, type, det] = tpl[n % tpl.length]; const dt = new Date(); dt.setDate(dt.getDate() - d + 3);
    const date = dt.toISOString().slice(0, 10); if (date > today()) continue;
    const pool = personnel.filter(p => p.status === "active" && (!det || !p.detachment || p.detachment === det)).map(p => p.username);
    const att = pool.filter((_, i) => (i * 7 + n * 3) % 10 < 4 + (n % 5));
    ops.push({ id: "o" + n, num: n + 1, unit: "1ASFG", type, name, date, detachment: det, host: att[0] || pool[0],
      summary: "Sample record for demo mode.", proof_url: n % 2 ? "https://example.com/proof" : null, attendees: att });
    n++;
  }
  const db = {
    units: [{ id: "1ASFG", name: "1st Airborne Special Forces Group", name_local: "第1空輸特戰團", tagline: "공수 특전 · Official Cold War faction", sort: 1 }],
    formations: [
      { id: "FTAD", kind: "detachment", parent: null, name: "Fierce Tiger Airborne Detachment", name_local: "猛虎", region: "EU / ASIA", sort: 1 },
      { id: "WHAD", kind: "detachment", parent: null, name: "White Horse Airborne Detachment", name_local: "白馬", region: "AMERICAS", sort: 2 },
      { id: "FT-1", kind: "company", parent: "FTAD", name: "1st Company", sort: 1 }, { id: "FT-2", kind: "company", parent: "FTAD", name: "2nd Company", sort: 2 },
      { id: "WH-1", kind: "company", parent: "WHAD", name: "1st Company", sort: 1 }, { id: "WH-2", kind: "company", parent: "WHAD", name: "2nd Company", sort: 2 }
    ],
    settings: { bulletin: "ALL UNITS: OPSNET IS ONLINE.\nPRIORITY RAID SCHEDULED THIS WEEKEND. CHECK DISCORD FOR TIMING.", directive: "Report to the staging area 10 minutes before every hosted event. Hosts log attendance at roll call.", defcon: 3,
      ticker: TICKER, points: { training: 1, practice: 2, raid: 3 } },
    personnel, ops
  };
  let seq = 1000; const clone = x => JSON.parse(JSON.stringify(x));
  return {
    async load() { return clone(db); },
    async session() { return S.session; },
    async isAdmin() { return true; },
    async signIn(email) { return { user: { id: "demo", email } }; },
    async signOut() {},
    async saveOp(op, names) {
      if (op.id) Object.assign(db.ops.find(o => o.id === op.id), op, { attendees: names });
      else db.ops.push({ ...op, id: "o" + seq++, num: Math.max(0, ...db.ops.map(o => o.num)) + 1, attendees: names });
      for (const u of names.concat(op.host ? [op.host] : [])) if (!db.personnel.some(p => lc(p.username) === lc(u))) db.personnel.push({ id: "p" + seq++, username: u, rank: "ENL", unit: op.unit, joined: op.date, status: "active", detachment: op.detachment || null });
    },
    async deleteOp(id) { db.ops = db.ops.filter(o => o.id !== id); },
    async savePerson(p) { if (p.id) Object.assign(db.personnel.find(x => x.id === p.id), p); else db.personnel.push({ ...p, id: "p" + seq++ }); },
    async clearBillet(id) { const p = db.personnel.find(x => x.id === id); if (p) p.billet = null; },
    async deletePerson(id) { db.personnel = db.personnel.filter(p => p.id !== id); },
    async saveFormation(f) { const i = db.formations.findIndex(x => x.id === f.id); i >= 0 ? (db.formations[i] = { ...db.formations[i], ...f }) : db.formations.push(f); },
    async deleteFormation(id) {
      const kill = new Set([id, ...db.formations.filter(f => f.parent === id).map(f => f.id)]);
      db.formations = db.formations.filter(f => !kill.has(f.id));
      for (const p of db.personnel) { if (kill.has(p.detachment)) p.detachment = null; if (kill.has(p.company)) p.company = null; }
      for (const o of db.ops) if (kill.has(o.detachment)) o.detachment = null;
    },
    async saveSettings(s) { Object.assign(db.settings, s); },
    async saveUnit(u) { const i = db.units.findIndex(x => x.id === u.id); i >= 0 ? (db.units[i] = { ...db.units[i], ...u }) : db.units.push(u); },
    async deleteUnit(id) { db.units = db.units.filter(u => u.id !== id); db.ops = db.ops.filter(o => o.unit !== id); }
  };
}

async function reload() {
  try {
    const d = await api.load();
    Object.assign(S, { units: d.units, personnel: d.personnel, ops: d.ops, formations: d.formations || [] });
    S.settings = Object.assign(S.settings, d.settings || {});
    if (!S.units.some(u => u.id === S.unit)) S.unit = S.units[0] ? S.units[0].id : null;
    $("#link").textContent = LIVE ? "SECURE" : "DEMO";
    if (LIVE) $("#demoBanner").hidden = true;
    if (LIVE && !S.formations.length && S.admin) { const b = $("#demoBanner"); b.hidden = false; b.textContent = (S.missing.formations ? "Structure table missing: " : "No detachments found: ") + "run supabase/update-orbat.sql in Supabase → SQL Editor, then refresh."; }
  } catch (e) {
    console.error(e); $("#link").textContent = "LOST";
    const msg = (e && (e.message || e.error_description || e.hint)) || String(e);
    const hint = /column .* does not exist|detachment|billet|company/i.test(msg) ? " → Run supabase/update-orbat.sql in the SQL Editor."
      : /relation .* does not exist|Could not find the table|schema cache/i.test(msg) ? " → Run supabase/schema.sql in the SQL Editor."
      : /Invalid API key|JWT|apikey|No API key/i.test(msg) ? " → Check SUPABASE_ANON_KEY in config.js."
      : /Failed to fetch|NetworkError|Load failed/i.test(msg) ? " → Check SUPABASE_URL, and that the project isn't paused."
      : "";
    const box = $("#demoBanner"); box.hidden = false; box.textContent = "DATABASE ERROR: " + msg + hint;
    toast("Database error: " + msg, true);
  }
  renderAll();
}

/* ─── scoring ──────────────────────────────────────────────────────── */
// Attendance rate counts group-wide events plus events hosted for the operator's own detachment,
// from their join date (or first logged event) onward.
function standings(period) {
  const P = pts(); const m = thisMonth();
  const ops = unitOps().filter(o => period === "all" || (o.date || "").startsWith(m));
  const rows = {};
  const row = name => {
    const k = lc(name);
    if (!rows[k]) {
      const p = person(name) || {};
      const c = fm(p.company);
      rows[k] = { username: p.username || name, rank: p.rank || "ENL", rankIdx: rankIdx(p.rank || "ENL"), billet: p.billet || null, status: p.status || "active", joined: p.joined || null,
        detachment: p.detachment || (c && c.parent) || null, company: p.company || null, assign: assignLabel(p.username ? p : null),
        training: 0, practice: 0, raid: 0, attended: 0, points: 0 };
    }
    return rows[k];
  };
  for (const p of S.personnel) if (p.unit === S.unit && p.status !== "inactive") row(p.username);
  for (const o of ops) for (const a of o.attendees || []) { const r = row(a); r[o.type]++; r.attended++; r.points += +P[o.type] || 0; }
  const firstAll = {}; for (const o of unitOps()) for (const a of o.attendees || []) { const k = lc(a); if (!firstAll[k] || o.date < firstAll[k]) firstAll[k] = o.date; }
  for (const [k, r] of Object.entries(rows)) {
    const since = r.joined || firstAll[k] || null;
    const eligible = ops.filter(o => (!since || o.date >= since) && (!o.detachment || !r.detachment || o.detachment === r.detachment)).length;
    r.eligible = Math.max(eligible, r.attended); r.rate = r.eligible ? Math.min(1, r.attended / r.eligible) : 0;
  }
  return Object.values(rows);
}

/* ─── render: chrome & command ─────────────────────────────────────── */
function renderChrome() {
  const u = curUnit();
  $("#identName").textContent = u.id + " Systems"; $("#identSub").textContent = u.name;
  $$(".unitCode").forEach(x => (x.textContent = u.id));
  document.title = (u.id && u.id !== "—" ? u.id + " · " : "") + (CFG.SITE_NAME || "OPSNET") + " Activity Log";
  const sw = $("#unitSwitch"); sw.replaceChildren(...S.units.map(x => el("button", { type: "button", "aria-pressed": String(x.id === S.unit), onclick: () => { S.unit = x.id; store.set("unit", x.id); renderAll(); } }, x.id)));
  sw.hidden = S.units.length < 2;
  $$(".unit-only").forEach(x => (x.hidden = S.units.length < 2));
  const lines = (S.settings.ticker && S.settings.ticker.length ? S.settings.ticker : [u.name]);
  const t = $("#ticker"); t.replaceChildren(...[...lines, ...lines].map(s => el("span", null, s)));
  t.style.animationDuration = Math.max(20, lines.join("").length * 0.9) + "s";
  // detachment filter controls
  const detOpts = [["all", "All detachments"], ["group", "Group-wide events"], ...dets().map(d => [d.id, (d.name_local ? d.name_local + " " : "") + d.name])];
  options($("#opDet"), detOpts);
  const seg = $("#lbDetSeg"); const segOpts = [["all", "All"], ...dets().map(d => [d.id, d.name_local || d.id])];
  if (!segOpts.some(o => o[0] === S.lbDet)) S.lbDet = "all";
  seg.replaceChildren(...segOpts.map(([v, txt]) => el("button", { type: "button", "aria-pressed": String(v === S.lbDet), title: v === "all" ? "All detachments" : (fm(v) || {}).name, onclick: () => { S.lbDet = v; renderChrome(); renderLB(); } }, txt)));
  seg.hidden = !dets().length;
}

function renderCommand() {
  const u = curUnit();
  $("#heroKicker").textContent = "Operations database // " + u.id; $("#heroStrip").textContent = u.name;
  const title = $("#heroTitle"); const local = u.name_local || u.name;
  title.textContent = local; title.classList.toggle("latin", !/[㐀-鿿가-힯]/.test(local));
  $("#heroTag").textContent = u.tagline || ""; $("#heroName").textContent = u.name;
  const ops = unitOps(); const P = pts();
  const people = new Set(S.personnel.filter(p => p.unit === u.id && p.status !== "inactive").map(p => lc(p.username)));
  for (const o of ops) for (const a of o.attendees || []) people.add(lc(a));
  $("#stOps").textContent = ops.length; $("#stPers").textContent = people.size;
  $("#stPts").textContent = ops.reduce((s, o) => s + (o.attendees || []).length * (+P[o.type] || 0), 0);
  $("#bulletin").textContent = S.settings.bulletin || "AWAITING TRANSMISSION FROM COMMAND.";
  $("#directive").textContent = S.settings.directive || "";
  $("#ttStamp").textContent = "DTG " + today().replaceAll("-", "");
  const d = +S.settings.defcon || 4;
  $("#defcon").replaceChildren(...[5, 4, 3, 2, 1].map(i => el("span", { class: i === d ? "on" + (d <= 2 ? " hot" : "") : "" }, i)));
  $("#defconLbl").textContent = "DEFCON " + d; $("#defconTxt").textContent = DEFCON_TXT[d];
  const recent = [...ops].sort(byNewest).slice(0, 3);
  $("#recentOps").replaceChildren(...(recent.length ? recent.map(o => opCard(o, 6)) : [el("div", { class: "empty" }, "No operations logged yet.")]));
  const month = standings("month");
  // detachment rivalry
  const totals = dets().map(dt => {
    const rows = month.filter(r => r.detachment === dt.id);
    const active = rows.filter(r => r.status !== "inactive");
    return { dt, pts: rows.reduce((s, r) => s + r.points, 0), n: active.length, rate: active.length ? active.reduce((s, r) => s + r.rate, 0) / active.length : 0 };
  });
  const max = Math.max(1, ...totals.map(t => t.pts));
  const lead = totals.length > 1 && totals[0].pts !== totals[1].pts ? totals.reduce((a, b) => (b.pts > a.pts ? b : a)) : null;
  $("#rivalry").replaceChildren(...(totals.length ? totals.map(t => el("div", { class: "riv" + (lead === t ? " lead" : "") },
    el("div", { class: "riv-top" }, el("span", { class: "riv-local" }, t.dt.name_local || t.dt.id), el("span", { class: "riv-name" }, t.dt.name, el("small", null, (t.dt.region ? t.dt.region + " · " : "") + t.n + " active · " + Math.round(t.rate * 100) + "% attendance")), el("b", { class: "riv-pts" }, t.pts)),
    el("div", { class: "riv-bar" }, el("i", { style: "width:" + Math.round(t.pts / max * 100) + "%" }))))
    : [el("div", { class: "empty" }, "No detachments set up yet.")]));
  const top = month.filter(r => r.points > 0).sort((a, b) => b.points - a.points || a.username.localeCompare(b.username)).slice(0, 6);
  $("#topBoard").replaceChildren(...(top.length ? top.map((r, i) => el("li", null, el("span", { class: "n" }, "#" + (i + 1)), el("span", { class: "u" }, el("em", { class: "rk", title: rankName(r.rank) }, r.rank), r.username), el("span", { class: "p" }, r.points + " pts")))
    : [el("li", { style: "display:block;color:var(--fg-dim)" }, "No points awarded this month yet.")]));
  heroMap.setOps(ops);
  renderFeeds(ops);
}
const byNewest = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.num || 0) - (a.num || 0);

function opCard(o, limit) {
  const P = pts(); const att = o.attendees || [];
  const chipsWrap = el("div", { class: "chips" });
  const drawChips = all => {
    const list = all || !limit ? att : att.slice(0, limit);
    chipsWrap.replaceChildren(...list.map(a => el("span", { class: "chip" }, a, el("i", null, "+" + (+P[o.type] || 0)))));
    if (!all && limit && att.length > limit) chipsWrap.append(el("button", { class: "more", type: "button", onclick: () => drawChips(true) }, "+" + (att.length - limit) + " more"));
  };
  drawChips(false);
  return el("article", { class: "op" },
    el("div", { class: "op-top" },
      el("span", { class: "op-tags" }, el("span", { class: "op-code" }, code(o.num)), el("span", { class: "tag " + o.type }, TYPES[o.type] || o.type), el("span", { class: "det-tag" + (o.detachment ? "" : " all") }, detShort(o.detachment))),
      el("span", { class: "op-date" }, "▣ " + (o.date || "—"))),
    el("p", { class: "op-name" }, o.name || "Unnamed operation"),
    el("p", { class: "op-host" }, "Hosted by ", el("b", null, o.host || "—")),
    o.summary ? el("p", { class: "op-sum" }, o.summary) : null,
    att.length ? chipsWrap : null,
    el("div", { class: "op-foot" }, el("span", null, el("b", null, att.length), " attended"), el("span", null, el("b", null, att.length * (+P[o.type] || 0)), " pts awarded"),
      o.proof_url && /^https?:\/\//i.test(o.proof_url) ? el("a", { href: o.proof_url, target: "_blank", rel: "noopener" }, "▤ Proof") : null));
}

/* ─── render: ops log ──────────────────────────────────────────────── */
function renderOps() {
  const q = lc($("#q").value); const mo = $("#month").value; const s = $("#sort").value; const dt = $("#opDet").value || "all";
  let ops = unitOps().filter(o => S.opType === "all" || o.type === S.opType).filter(o => !mo || (o.date || "").startsWith(mo))
    .filter(o => dt === "all" || (dt === "group" ? !o.detachment : o.detachment === dt));
  if (q) ops = ops.filter(o => [code(o.num), o.name, o.host, o.summary, TYPES[o.type], o.date, detShort(o.detachment), ...(o.attendees || [])].join(" ").toLowerCase().includes(q));
  ops.sort(s === "old" ? (a, b) => -byNewest(a, b) : s === "att" ? (a, b) => (b.attendees || []).length - (a.attendees || []).length : byNewest);
  $("#opCount").textContent = ops.length + " of " + unitOps().length + " records";
  $("#opList").replaceChildren(...(ops.length ? ops.map(o => opCard(o, 12)) : [el("div", { class: "empty" }, unitOps().length ? "No operations match." : "No operations logged yet.")]));
}

/* ─── render: leaderboard ──────────────────────────────────────────── */
function renderLB() {
  const q = lc($("#lq").value);
  let rows = standings(S.period).filter(r => S.lbDet === "all" || r.detachment === S.lbDet);
  const ranked = [...rows].sort((a, b) => b.points - a.points || b.rate - a.rate || a.username.localeCompare(b.username));
  const rank = new Map(ranked.map((r, i) => [r, i + 1]));
  const { k, dir } = S.lbSort;
  rows.sort((a, b) => { const x = a[k], y = b[k]; return typeof x === "number" ? dir * (x - y) || rank.get(a) - rank.get(b) : dir * String(x || "").localeCompare(String(y || "")); });
  if (q) rows = rows.filter(r => lc(r.username + " " + r.rank + " " + rankName(r.rank) + " " + r.assign).includes(q));
  $$(".lb th[data-k]").forEach(th => th.dataset.k === k ? th.setAttribute("data-sort", dir > 0 ? "asc" : "desc") : th.removeAttribute("data-sort"));
  $("#lbBody").replaceChildren(...(rows.length ? rows.map(r => {
    const pct = Math.round(r.rate * 100);
    return el("tr", { class: (rank.get(r) <= 3 && r.points > 0 ? "top " : "") + (r.status === "inactive" ? "inactive" : "") },
      el("td", { class: "r" }, String(rank.get(r)).padStart(2, "0")),
      el("td", null, r.username, r.billet && BILLETS[r.billet] ? el("span", { class: "billet", title: BILLETS[r.billet].name }, BILLETS[r.billet].short) : null),
      el("td", { title: rankName(r.rank) }, el("span", { class: "rk" + (isOfficer(r.rank) ? " off" : "") }, r.rank)),
      el("td", { class: "dim" }, r.assign),
      el("td", { class: "num" }, r.training), el("td", { class: "num" }, r.practice), el("td", { class: "num" }, r.raid),
      el("td", { class: "num" }, el("span", { class: "meter" }, el("i", null, el("b", { class: pct < 50 ? "low" : pct < 75 ? "mid" : "", style: "width:" + pct + "%" })), pct + "% (" + r.attended + "/" + r.eligible + ")")),
      el("td", { class: "num pts" }, r.points));
  }) : [el("tr", null, el("td", { colspan: "9", style: "text-align:center;color:var(--fg-dim);padding:28px" }, "No one on the board for this period yet."))]));
  const P = pts();
  $("#legend").textContent = "Scoring: Training " + P.training + " · Practice raid " + P.practice + " · Raid " + P.raid + " points per event attended. " +
    (S.period === "month" ? "Monthly board resets on the 1st. " : "") + "Attendance counts group-wide events plus events hosted for the operator's own detachment, from their join date onward. Click a column to sort.";
}
$$(".lb th[data-k]").forEach(th => th.addEventListener("click", () => { const k = th.dataset.k; S.lbSort = { k, dir: S.lbSort.k === k ? -S.lbSort.dir : (k === "username" || k === "assign" ? 1 : -1) }; renderLB(); }));

/* ─── render: roster / ORBAT ───────────────────────────────────────── */
function renderRoster() {
  const q = lc($("#rq").value);
  const ppl = S.personnel.filter(p => p.unit === S.unit);
  const month = standings("month"); const mp = new Map(month.map(r => [lc(r.username), r.points]));
  const match = p => !q || lc(p.username + " " + p.rank + " " + rankName(p.rank) + " " + (p.billet ? BILLETS[p.billet].name : "")).includes(q);
  const hits = ppl.filter(match).length;
  $("#rosterCount").textContent = (q ? hits + " match · " : "") + ppl.filter(p => p.status !== "inactive").length + " active · " + ppl.filter(p => p.status === "inactive").length + " inactive";

  const holder = (b, company) => ppl.find(p => p.billet === b && (!company || p.company === company));
  const slot = (b, company) => {
    const p = holder(b, company);
    return el("div", { class: "slot" + (p ? "" : " vacant") + (p && q && !match(p) ? " faded" : "") },
      el("span", { class: "slot-role" }, BILLETS[b].name),
      p ? el("span", { class: "slot-who" }, el("em", { class: "rk off", title: rankName(p.rank) }, p.rank), p.username) : el("span", { class: "slot-who" }, "— VACANT —"));
  };
  const memberRow = p => el("li", { class: (p.status === "inactive" ? "inactive " : "") + (q && !match(p) ? "faded" : q ? "hit" : "") },
    el("em", { class: "rk" + (isOfficer(p.rank) ? " off" : ""), title: rankName(p.rank) }, p.rank || "ENL"), el("span", { class: "nm" }, p.username), el("span", { class: "mp" }, (mp.get(lc(p.username)) || 0) + " pts"));

  const hq = el("div", { class: "hq" },
    el("div", { class: "fm-head" }, el("span", { class: "fm-local" }, "本部"), el("span", null, el("b", null, "Headquarters Element"), el("small", null, curUnit().id + " · Group command"))),
    el("div", { class: "slots three" }, ...HQ_BILLETS.map(b => slot(b))));

  const detEls = dets().map(dt => {
    const inDet = ppl.filter(p => (p.detachment === dt.id || (fm(p.company) || {}).parent === dt.id) && !(p.billet && BILLETS[p.billet].level === "hq"));
    const coyEls = coys(dt.id).map(c => {
      const mem = inDet.filter(p => p.company === c.id && !COY_BILLETS.includes(p.billet)).sort(byRank);
      return el("div", { class: "coy" },
        el("div", { class: "coy-head" }, el("b", null, c.name), el("small", null, c.id + " · " + inDet.filter(p => p.company === c.id && p.status !== "inactive").length + " active")),
        el("div", { class: "coy-hq" }, el("span", { class: "coy-hq-lbl" }, "Company Headquarters"), el("div", { class: "slots" }, ...COY_BILLETS.map(b => slot(b, c.id)))),
        mem.length ? el("ul", { class: "members" }, ...mem.map(memberRow)) : el("p", { class: "none" }, "No members assigned."));
    });
    const loose = inDet.filter(p => !p.company || !coys(dt.id).some(c => c.id === p.company)).sort(byRank);
    return el("div", { class: "det" },
      el("div", { class: "fm-head" }, el("span", { class: "fm-local" }, dt.name_local || dt.id), el("span", null, el("b", null, dt.name), el("small", null, dt.id + (dt.region ? " · " + dt.region : "") + " · " + inDet.filter(p => p.status !== "inactive").length + " active"))),
      el("div", { class: "coys" }, ...coyEls),
      loose.length ? el("div", { class: "coy loose" }, el("div", { class: "coy-head" }, el("b", null, "Detachment pool"), el("small", null, "No company yet")), el("ul", { class: "members" }, ...loose.map(memberRow))) : null);
  });
  $("#orbat").replaceChildren(hq, el("div", { class: "dets" }, ...(detEls.length ? detEls : [el("div", { class: "empty" }, "No detachments set up yet. Add them in Admin → Structure.")])));

  const un = ppl.filter(p => !p.detachment && !p.company && !(p.billet && BILLETS[p.billet].level === "hq")).sort(byRank);
  $("#unassigned").replaceChildren(...(un.length ? [el("div", { class: "coy loose unassigned" }, el("div", { class: "coy-head" }, el("b", null, "Awaiting assignment"), el("small", null, un.length + " personnel · assign a detachment in Admin → Personnel")), el("ul", { class: "members" }, ...un.map(memberRow)))] : []));
  $("#rankKey").replaceChildren(el("span", { class: "sub" }, "Rank key"), ...RANKS.map(([c, n]) => el("span", null, el("em", { class: "rk" + (isOfficer(c) ? " off" : "") }, c), n)));
}

/* ─── admin ────────────────────────────────────────────────────────── */
function renderAdmin() {
  const signedIn = !!S.session;
  $("#loginForm").hidden = signedIn; $("#notAdmin").hidden = !signedIn || S.admin; $("#console").hidden = !(signedIn && S.admin);
  if (!(signedIn && S.admin)) return;
  $("#whoami").textContent = "Cleared: " + ((S.session.user && S.session.user.email) || "admin") + (LIVE ? "" : " (demo)");
  const unitList = S.units.map(u => [u.id, u.id + " — " + u.name]);
  options($("#fUnit"), unitList); if (!$("#fUnit").value) $("#fUnit").value = S.unit; options($("#pUnit"), unitList); if (!$("#pUnit").value) $("#pUnit").value = S.unit;
  options($("#fDet"), [["", "Group-wide (all members)"], ...dets().map(d => [d.id, (d.name_local ? d.name_local + " " : "") + d.name])]);
  options($("#pRank"), RANKS.map(([c, n]) => [c, c + " — " + n]).reverse());
  options($("#pBillet"), [["", "None"], ...HQ_BILLETS.map(b => [b, "HQ Element · " + BILLETS[b].name]), ...COY_BILLETS.map(b => [b, "Company HQ · " + BILLETS[b].name])]);
  options($("#pDet"), [["", "— None —"], ...dets().map(d => [d.id, d.id + " — " + d.name])]);
  syncCoyOptions();
  options($("#pqDet"), [["all", "All"], ...dets().map(d => [d.id, d.id]), ["hq", "HQ Element"], ["none", "Unassigned"]]);
  options($("#fmParent"), dets().length ? [["", "— Pick a detachment —"], ...dets().map(d => [d.id, d.id + " — " + d.name])] : [["", "No detachments yet: add one first"]]);
  const note = $("#fmNote");
  if (S.missing.formations) { note.hidden = false; note.textContent = "The structure table isn't set up in the database yet (" + S.missing.formations + "). Run supabase/update-orbat.sql in Supabase → SQL Editor, then refresh this page."; }
  else if (!dets().length) { note.hidden = false; note.textContent = "No detachments on file. Run supabase/update-orbat.sql to load Fierce Tiger and White Horse with their companies, or add a detachment below (set Type to Detachment)."; }
  else note.hidden = true;
  $("#userList").replaceChildren(...S.personnel.map(p => el("option", { value: p.username })));
  // ops list
  const mq = lc($("#mq").value);
  const ops = [...S.ops].sort(byNewest).filter(o => !mq || lc([code(o.num), o.name, o.unit, o.host, o.date, detShort(o.detachment)].join(" ")).includes(mq));
  $("#mOps").replaceChildren(...(ops.length ? ops.map(o => {
    const del = el("button", { class: "btn sm danger", type: "button" }, "Delete"); armed(del, () => run(() => api.deleteOp(o.id), code(o.num) + " deleted"));
    return el("div", { class: "mrow" }, el("span", { class: "t" }, code(o.num) + " · " + (o.name || ""), el("small", null, TYPES[o.type] + " · " + detShort(o.detachment) + " · " + o.date + " · " + (o.attendees || []).length + " present")),
      el("span", { class: "btnrow" }, el("button", { class: "btn sm", type: "button", onclick: () => editOp(o) }, "Edit"), del));
  }) : [el("div", { class: "mrow" }, "No operations on file.")]));
  // people
  const pq = lc($("#pq").value), pd = $("#pqDet").value || "all";
  const ppl = [...S.personnel].sort(byRank).filter(p => !pq || lc(p.username + " " + (p.rank || "") + " " + assignLabel(p)).includes(pq)).filter(p => {
    if (pd === "all") return true; const hq = p.billet && BILLETS[p.billet] && BILLETS[p.billet].level === "hq";
    if (pd === "hq") return hq; const det = p.detachment || (fm(p.company) || {}).parent;
    if (pd === "none") return !hq && !det; return !hq && det === pd;
  });
  $("#mPeople").replaceChildren(...(ppl.length ? ppl.map(p => {
    const del = el("button", { class: "btn sm danger", type: "button" }, "Remove"); armed(del, () => run(() => api.deletePerson(p.id), p.username + " removed"));
    return el("div", { class: "mrow" }, el("span", { class: "t" }, el("em", { class: "rk" + (isOfficer(p.rank) ? " off" : "") }, p.rank || "ENL"), " " + p.username, p.billet && BILLETS[p.billet] ? el("span", { class: "billet" }, BILLETS[p.billet].short) : null,
      el("small", null, assignLabel(p) + " · joined " + (p.joined || "—") + (p.status === "inactive" ? " · INACTIVE" : ""))),
      el("span", { class: "btnrow" }, el("button", { class: "btn sm", type: "button", onclick: () => editPerson(p) }, "Edit"), del));
  }) : [el("div", { class: "mrow" }, "No personnel match.")]));
  // formations
  const fl = dets().flatMap(d => [d, ...coys(d.id)]).concat(S.formations.filter(f => f.kind === "company" && !fm(f.parent)));
  $("#mForm").replaceChildren(...(fl.length ? fl.map(f => {
    const del = el("button", { class: "btn sm danger", type: "button" }, "Delete"); armed(del, () => run(() => api.deleteFormation(f.id), f.id + " deleted"));
    const n = S.personnel.filter(p => p.detachment === f.id || p.company === f.id).length;
    return el("div", { class: "mrow" + (f.kind === "company" ? " indent" : "") }, el("span", { class: "t" }, (f.kind === "company" ? "└ " : "") + f.id + " — " + (f.name_local ? f.name_local + " " : "") + f.name, el("small", null, (f.kind === "detachment" ? "Detachment" + (f.region ? " · " + f.region : "") : "Company") + " · " + n + " personnel")),
      el("span", { class: "btnrow" }, el("button", { class: "btn sm", type: "button", onclick: () => editFormation(f) }, "Edit"), del));
  }) : [el("div", { class: "mrow" }, "No detachments yet.")]));
  // units
  $("#mUnits").replaceChildren(...S.units.map(u => {
    const del = el("button", { class: "btn sm danger", type: "button", disabled: S.units.length < 2 }, "Delete"); armed(del, () => run(() => api.deleteUnit(u.id), u.id + " deleted"));
    return el("div", { class: "mrow" }, el("span", { class: "t" }, u.id + " — " + u.name, el("small", null, u.name_local || "")),
      el("span", { class: "btnrow" }, el("button", { class: "btn sm", type: "button", onclick: () => { $("#uId").value = u.id; $("#uName").value = u.name || ""; $("#uLocal").value = u.name_local || ""; $("#uTag").value = u.tagline || ""; } }, "Edit"), del));
  }));
}
function syncCoyOptions() {
  const d = $("#pDet").value; const b = $("#pBillet").value;
  options($("#pCoy"), [["", d ? "— Detachment pool —" : "— None —"], ...coys(d || null).filter(c => d || true).map(c => [c.id, (d ? "" : c.parent + " · ") + c.name])]);
  const hq = HQ_BILLETS.includes(b);
  $("#pDet").disabled = hq; $("#pCoy").disabled = hq || !d;
  $("#pHint").textContent = hq ? BILLETS[b].name + " sits in the Headquarters Element, above the detachments." :
    COY_BILLETS.includes(b) ? "Pick the company this " + BILLETS[b].short + " leads." : "Headquarters Element billets sit above the detachments. Company CO and XO need a company.";
}
$("#pDet").addEventListener("change", syncCoyOptions);
$("#pBillet").addEventListener("change", syncCoyOptions);

function fillSettings() {
  const s = S.settings, P = pts();
  $("#sBul").value = s.bulletin || ""; $("#sDir").value = s.directive || ""; $("#sDef").value = String(s.defcon || 4);
  $("#sPT").value = P.training; $("#sPP").value = P.practice; $("#sPR").value = P.raid; $("#sTick").value = (s.ticker || []).join("\n");
}
async function run(fn, ok) {
  try { await fn(); toast(ok); await reload(); return true; }
  catch (e) { console.error(e); toast((e && e.message) || "Could not save.", true); return false; }
}
$$(".atabs button").forEach(b => b.addEventListener("click", () => {
  $$(".atabs button").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  $$("[data-pane]").forEach(p => (p.hidden = p.dataset.pane !== b.dataset.a));
}));
function showPane(a) { $(".atabs button[data-a='" + a + "']").click(); }

/* ops form */
function resetOp() { S.editOp = null; $("#opForm").reset(); $("#fDate").value = today(); $("#fUnit").value = S.unit || ""; $("#fDet").value = ""; $("#opFormTitle").textContent = "Log an operation"; $("#opSave").textContent = "Log operation"; $("#opCancel").hidden = true; previewAtt(); }
function editOp(o) {
  S.editOp = o.id; showPane("log");
  $("#fUnit").value = o.unit; $("#fType").value = o.type; $("#fDate").value = o.date; $("#fHost").value = o.host || ""; $("#fName").value = o.name || "";
  $("#fDet").value = o.detachment || ""; $("#fProof").value = o.proof_url || ""; $("#fSum").value = o.summary || ""; $("#fAtt").value = (o.attendees || []).join("\n");
  $("#opFormTitle").textContent = "Edit " + code(o.num); $("#opSave").textContent = "Save changes"; $("#opCancel").hidden = false; previewAtt();
  $("#opForm").scrollIntoView({ behavior: "smooth", block: "start" });
}
function previewAtt() { const n = parseNames($("#fAtt").value); const fresh = n.filter(x => !person(x)).length; $("#attPreview").textContent = n.length + " attendee" + (n.length === 1 ? "" : "s") + (fresh ? " · " + fresh + " new to roster" : ""); }
$("#fAtt").addEventListener("input", previewAtt);
$("#opCancel").addEventListener("click", resetOp);
$("#opForm").addEventListener("submit", async e => {
  e.preventDefault();
  const names = parseNames($("#fAtt").value).map(n => (person(n) || {}).username || n);
  const op = { id: S.editOp, unit: $("#fUnit").value || S.unit, type: $("#fType").value, date: $("#fDate").value, host: $("#fHost").value.trim().replace(/^@/, ""), name: $("#fName").value.trim(), detachment: $("#fDet").value || null, proof_url: $("#fProof").value.trim(), summary: $("#fSum").value.trim() };
  if (!op.name) return;
  if (await run(() => api.saveOp(op, names), op.id ? "Operation updated" : "Operation logged")) resetOp();
});

/* personnel form */
function resetP() { S.editP = null; $("#pForm").reset(); $("#pUnit").value = S.unit || ""; $("#pRank").value = "ENL"; $("#pBillet").value = ""; $("#pDet").value = ""; $("#pJoin").value = today(); syncCoyOptions(); $("#pTitle").textContent = "Add personnel"; $("#pSave").textContent = "Add"; $("#pCancel").hidden = true; }
function editPerson(p) {
  S.editP = p.id; $("#pUser").value = p.username; $("#pRank").value = RANK_IDX[p.rank] != null ? p.rank : "ENL"; $("#pBillet").value = p.billet || "";
  $("#pDet").value = p.detachment || (fm(p.company) || {}).parent || ""; syncCoyOptions(); $("#pCoy").value = p.company || "";
  $("#pUnit").value = p.unit || S.unit; $("#pJoin").value = p.joined || ""; $("#pStatus").value = p.status || "active";
  $("#pTitle").textContent = "Edit " + p.username; $("#pSave").textContent = "Save"; $("#pCancel").hidden = false; $("#pForm").scrollIntoView({ behavior: "smooth", block: "center" });
}
$("#pCancel").addEventListener("click", resetP);
$("#pForm").addEventListener("submit", async e => {
  e.preventDefault();
  const billet = $("#pBillet").value || null; const hq = HQ_BILLETS.includes(billet);
  const p = { id: S.editP, username: $("#pUser").value.trim().replace(/^@/, ""), rank: $("#pRank").value, billet, unit: $("#pUnit").value || S.unit,
    detachment: hq ? null : ($("#pDet").value || null), company: hq ? null : ($("#pCoy").value || null), joined: $("#pJoin").value, status: $("#pStatus").value };
  if (!p.username) return;
  if (!p.id && person(p.username)) { toast(p.username + " is already on the roster", true); return; }
  if (COY_BILLETS.includes(billet) && !p.company) { toast("Pick a company for the " + BILLETS[billet].name, true); return; }
  if (p.company && !p.detachment) p.detachment = (fm(p.company) || {}).parent || null;
  // one holder per billet: hand the slot over
  const prev = billet ? S.personnel.find(x => x.id !== p.id && x.billet === billet && (hq || x.company === p.company)) : null;
  const ok = await run(async () => { if (prev) await api.clearBillet(prev.id); await api.savePerson(p); },
    (p.id ? "Record updated" : p.username + " added") + (prev ? " · replaced " + prev.username + " as " + BILLETS[billet].short : ""));
  if (ok) resetP();
});
["mq", "pq"].forEach(id => $("#" + id).addEventListener("input", renderAdmin));
$("#pqDet").addEventListener("change", renderAdmin);

/* structure form */
function resetF() { S.editF = null; $("#fmForm").reset(); $("#fmId").disabled = false; $("#fmSave").textContent = "Save"; syncFmKind(); }
function editFormation(f) {
  S.editF = f.id; $("#fmId").value = f.id; $("#fmId").disabled = true; $("#fmKind").value = f.kind; $("#fmParent").value = f.parent || ""; $("#fmSort").value = f.sort || 0;
  $("#fmName").value = f.name || ""; $("#fmLocal").value = f.name_local || ""; $("#fmRegion").value = f.region || ""; $("#fmSave").textContent = "Save changes"; syncFmKind();
  $("#fmForm").scrollIntoView({ behavior: "smooth", block: "center" });
}
function syncFmKind() { const c = $("#fmKind").value === "company"; $("#fmParent").disabled = !c; $("#fmRegion").disabled = c; }
$("#fmKind").addEventListener("change", syncFmKind);
$("#fmCancel").addEventListener("click", resetF);
$("#fmForm").addEventListener("submit", async e => {
  e.preventDefault();
  const kind = $("#fmKind").value;
  const f = { id: (S.editF || $("#fmId").value.trim().toUpperCase().replace(/\s+/g, "-")), kind, parent: kind === "company" ? ($("#fmParent").value || null) : null,
    name: $("#fmName").value.trim(), name_local: $("#fmLocal").value.trim() || null, region: kind === "detachment" ? ($("#fmRegion").value.trim() || null) : null, sort: +$("#fmSort").value || 0 };
  if (!f.id || !f.name) return;
  if (kind === "company" && !f.parent) { toast("A company needs a parent detachment", true); return; }
  if (!S.editF && fm(f.id)) { toast(f.id + " already exists. Use Edit instead.", true); return; }
  if (await run(() => api.saveFormation(f), f.id + " saved")) resetF();
});

/* settings */
$("#sForm").addEventListener("submit", e => {
  e.preventDefault();
  const s = { bulletin: $("#sBul").value.trim(), directive: $("#sDir").value.trim(), defcon: +$("#sDef").value,
    points: { training: +$("#sPT").value || 0, practice: +$("#sPP").value || 0, raid: +$("#sPR").value || 0 },
    ticker: $("#sTick").value.split("\n").map(x => x.trim()).filter(Boolean) };
  run(() => api.saveSettings(s), "Settings transmitted");
});
$("#uSave").addEventListener("click", () => {
  const u = { id: $("#uId").value.trim().toUpperCase().replace(/\s+/g, ""), name: $("#uName").value.trim(), name_local: $("#uLocal").value.trim() || null, tagline: $("#uTag").value.trim() || null };
  if (!u.id || !u.name) { toast("A unit needs a code and a full name", true); return; }
  if (!S.units.some(x => x.id === u.id)) u.sort = S.units.length + 1;
  run(() => api.saveUnit(u), u.id + " saved").then(() => ["uId", "uName", "uLocal", "uTag"].forEach(i => ($("#" + i).value = "")));
});

$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault(); $("#lgErr").hidden = true;
  try { S.session = await api.signIn($("#lgEmail").value.trim(), $("#lgPass").value); S.admin = await api.isAdmin(S.session.user.id); $("#lgPass").value = ""; renderAll(); fillSettings(); resetOp(); resetP(); resetF(); }
  catch (err) { $("#lgErr").textContent = "Access denied: " + ((err && err.message) || "check your email and password."); $("#lgErr").hidden = false; }
});
$$("[data-signout]").forEach(b => b.addEventListener("click", async () => { await api.signOut(); S.session = null; S.admin = false; renderAll(); }));

/* ─── filters & routing ────────────────────────────────────────────── */
function seg(id, key, after) { $("#" + id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S[key] = b.dataset.v; $$("#" + id + " button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); after(); }); }
seg("typeSeg", "opType", renderOps); seg("periodSeg", "period", renderLB);
["q", "sort", "month", "opDet"].forEach(id => $("#" + id).addEventListener("input", renderOps));
$("#lq").addEventListener("input", renderLB);
$("#rq").addEventListener("input", renderRoster);

const TABS = ["command", "ops", "leaderboard", "roster", "admin"];
function route() {
  const h = location.hash.slice(1); const t = TABS.includes(h) ? h : "command";
  TABS.forEach(x => ($("#v-" + x).hidden = x !== t));
  $$(".nav a").forEach(a => a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  heroMap.active(t === "command" && !intro.running());
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

function renderAll() { renderChrome(); renderCommand(); renderOps(); renderLB(); renderRoster(); renderAdmin(); }

/* ─── East Asia / Korean peninsula outline (lon, lat pairs; hand-traced, simplified) ─ */
const GEO = (() => {
  const P = a => { const o = []; for (let i = 0; i < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
  const koreaCoast = P([124.30,39.85, 124.62,39.62, 124.98,39.58, 125.30,39.52, 125.55,39.36, 125.45,39.12, 125.28,38.92, 125.18,38.72, 124.98,38.58, 124.85,38.38, 124.70,38.12, 124.88,37.98, 125.12,37.88, 125.30,37.72, 125.55,37.80, 125.78,37.92, 126.02,37.80, 126.25,37.78, 126.42,37.80, 126.52,37.70, 126.58,37.58, 126.60,37.45, 126.70,37.32, 126.78,37.12, 126.92,36.96, 126.75,36.92, 126.50,36.98, 126.28,36.92, 126.12,36.80, 126.18,36.62, 126.42,36.48, 126.52,36.28, 126.58,36.12, 126.70,35.98, 126.55,35.82, 126.45,35.62, 126.42,35.40, 126.30,35.18, 126.40,35.00, 126.32,34.82, 126.25,34.62, 126.40,34.40, 126.55,34.30, 126.80,34.42, 127.05,34.52, 127.30,34.48, 127.48,34.65, 127.70,34.72, 127.90,34.88, 128.10,34.88, 128.35,34.84, 128.55,34.92, 128.72,35.02, 128.90,35.08, 129.05,35.08, 129.18,35.18, 129.32,35.36, 129.42,35.58, 129.52,35.88, 129.57,36.06, 129.42,36.10, 129.38,36.40, 129.45,36.80, 129.38,37.05, 129.25,37.32, 129.10,37.55, 128.92,37.78, 128.72,38.00, 128.58,38.22, 128.40,38.52, 128.20,38.80, 127.95,39.05, 127.62,39.15, 127.42,39.30, 127.50,39.55, 127.62,39.78, 127.90,39.88, 128.20,40.02, 128.55,40.22, 128.90,40.42, 129.20,40.62, 129.62,40.82, 129.72,41.10, 129.70,41.40, 129.82,41.75, 130.05,41.98, 130.40,42.22, 130.69,42.29]);
  const nkBorder = P([130.69,42.29, 130.45,42.55, 130.25,42.88, 129.90,42.98, 129.60,42.45, 129.30,42.42, 128.95,42.05, 128.06,42.00, 127.60,41.60, 127.15,41.50, 126.90,41.75, 126.55,41.35, 126.10,40.95, 125.60,40.75, 125.15,40.50, 124.70,40.25, 124.35,40.05, 124.30,39.85]);
  const dmz = P([126.68,37.77, 126.95,37.92, 127.10,38.12, 127.40,38.30, 127.75,38.32, 128.05,38.30, 128.25,38.45, 128.37,38.61]);
  const chinaCoast = P([124.30,39.85, 123.70,39.80, 123.10,39.62, 122.45,39.35, 121.95,38.98, 121.55,38.82, 121.20,38.78, 121.15,38.95, 121.55,39.30, 121.75,39.60, 122.15,40.20, 122.25,40.55, 121.90,40.85, 121.30,40.90, 120.70,40.50, 120.10,40.05, 119.55,39.85, 119.05,39.25, 118.40,39.10, 117.75,38.95, 117.65,38.55, 118.05,38.15, 118.90,37.95, 119.15,37.40, 119.75,37.15, 120.30,37.55, 120.80,37.75, 121.45,37.55, 122.15,37.45, 122.60,37.35, 122.45,36.95, 121.85,36.85, 121.05,36.55, 120.55,36.15, 120.15,35.90, 119.55,35.45, 119.25,34.85, 119.80,34.45, 120.30,34.15, 120.75,33.20, 121.15,32.55, 121.70,32.05, 121.90,31.70, 121.85,31.05, 121.40,30.75, 121.95,30.15, 121.80,29.40, 121.55,28.70, 121.05,28.10, 120.60,27.40, 120.10,26.75, 119.65,26.00, 119.30,25.40, 118.75,24.70, 118.10,24.45, 117.40,23.80, 116.70,23.25, 115.80,22.85, 114.80,22.65, 114.20,22.30, 113.50,22.20, 113.00,21.85, 112.00,21.75, 110.60,21.20]);
  const russiaCoast = P([130.69,42.29, 130.90,42.55, 131.25,42.70, 131.55,43.05, 131.90,43.05, 132.30,42.85, 132.85,42.80, 133.50,42.75, 134.10,43.05, 134.80,43.40, 135.50,43.95, 136.20,44.50, 136.90,45.10, 137.70,45.90, 138.30,46.60, 138.70,47.30, 139.40,48.00, 140.20,48.60, 140.45,49.40, 140.55,50.30, 140.90,51.40, 141.30,52.30]);
  const ring = (cx, cy, rx, ry, n = 18, rot = 0) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; const x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]; });
  const islands = [
    P([129.70,33.20, 129.60,33.60, 130.40,33.95, 130.95,33.95, 131.70,33.50, 131.90,32.80, 131.40,31.40, 130.80,31.00, 130.20,31.20, 130.30,31.90, 130.10,32.60, 129.80,32.70]), // Kyushu
    P([132.00,33.00, 132.60,33.90, 133.50,34.30, 134.60,34.20, 134.70,33.80, 134.20,33.25, 133.00,32.75]), // Shikoku
    P([130.90,34.00, 131.40,34.40, 132.20,35.00, 133.00,35.50, 134.00,35.55, 135.20,35.75, 136.00,35.90, 136.70,36.90, 137.30,36.75, 138.20,37.00, 139.00,37.90, 139.60,38.60, 140.00,39.60, 140.00,40.40, 140.30,41.25, 141.20,41.20, 141.50,40.60, 142.00,39.60, 141.60,38.40, 141.00,38.20, 140.90,37.00, 140.60,36.30, 140.80,35.70, 140.40,35.20, 139.80,35.00, 139.60,35.30, 139.10,35.20, 138.80,34.65, 138.20,34.60, 137.00,34.60, 136.80,34.30, 136.00,33.50, 135.30,33.70, 135.10,34.30, 134.30,34.70, 133.00,34.35, 132.10,33.95, 131.60,34.00]), // Honshu
    P([140.00,41.50, 140.10,42.60, 140.50,43.20, 141.40,43.30, 141.70,44.30, 141.90,45.50, 142.90,44.70, 144.30,44.00, 145.30,43.40, 145.60,43.30, 144.90,42.90, 143.30,42.00, 141.60,42.50, 140.90,41.80]), // Hokkaido
    P([141.70,46.00, 142.00,47.50, 142.00,49.00, 142.20,50.50, 142.80,51.30, 143.20,49.30, 143.00,47.60, 142.50,46.60, 142.10,46.00]), // Sakhalin
    P([120.10,23.00, 120.70,22.00, 121.00,22.20, 121.60,23.50, 121.90,25.00, 121.50,25.30, 120.70,24.60]), // Taiwan
    P([129.20,34.10, 129.48,34.30, 129.45,34.70, 129.25,34.60, 129.18,34.30]), // Tsushima
    ring(126.55, 33.38, .38, .16, 20, .08),  // Jeju
    ring(130.87, 37.50, .045, .04, 10),      // Ulleungdo
    ring(126.45, 37.70, .08, .07, 12),       // Ganghwa
    ring(126.50, 37.47, .06, .045, 12),      // Yeongjong
    ring(128.62, 34.86, .1, .09, 12),        // Geoje
    ring(126.15, 36.95, .05, .03, 10)        // Taean offshore
  ];
  function inside(pt, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
  // scatter the island-dense southwest and west coasts
  const korea = koreaCoast.concat(nkBorder.slice(1));
  { let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const boxes = [[125.9, 34.0, 127.9, 34.75, 140], [125.95, 34.7, 126.45, 36.5, 60], [126.2, 37.0, 126.6, 37.6, 18], [127.7, 34.55, 128.8, 34.95, 40]];
    for (const [x0, y0, x1, y1, n] of boxes) for (let k = 0; k < n; k++) {
      const p = [x0 + r() * (x1 - x0), y0 + r() * (y1 - y0)]; if (inside(p, korea)) continue;
      const rr = .008 + Math.pow(r(), 3) * .07; islands.push(ring(p[0], p[1], rr * (1 + r() * .8), rr, 8, r() * 3));
    } }
  const han = P([127.42,37.52, 127.30,37.53, 127.18,37.57, 127.10,37.54, 127.02,37.52, 126.98,37.515, 126.93,37.53, 126.88,37.55, 126.82,37.58, 126.76,37.63, 126.70,37.68, 126.62,37.74, 126.52,37.76]);
  return { center: [126.978, 37.566], han, koreaCoast, nkBorder, dmz, chinaCoast, russiaCoast, islands,
    mainlandClose: P([100, 21, 100, 58, 145, 58]) };
})();

/* ─── terrain generator (procedural "satellite" imagery) ───────────── */
const Terrain = (() => {
  const SIZE = 760;
  let promise = null, holdMs = 0;
  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function noise(seed) {
    const r = rng(seed), p = new Uint8Array(512), perm = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [perm[i], perm[k]] = [perm[k], perm[i]]; }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const V = new Float32Array(256); for (let i = 0; i < 256; i++) V[i] = r();
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
      const a = V[p[p[X] + Y]], b = V[p[p[X + 1] + Y]], c = V[p[p[X] + Y + 1]], d = V[p[p[X + 1] + Y + 1]];
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  function fbm(n, x, y, oct) { let s = 0, a = .5, f = 1, t = 0; for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); t += a; a *= .5; f *= 2.03; } return s / t; }
  function layer(kind, seed) {
    const S2 = SIZE, c = document.createElement("canvas"); c.width = c.height = S2;
    const g = c.getContext("2d"), img = g.createImageData(S2, S2), d = img.data;
    const n1 = noise(seed), n2 = noise(seed + 7), n3 = noise(seed + 13), n4 = noise(seed + 29), r = rng(seed + 3);
    const base = kind === "region" ? 3 : kind === "valley" ? 4.4 : 7;
    const Hm = new Float32Array(S2 * S2), Al = new Float32Array(S2 * S2), Wt = new Uint8Array(S2 * S2);
    const cell = 9, cells = Math.ceil(S2 / cell) + 2, rc = rng(seed + 99), NC = cells * cells;
    const jx = new Float32Array(NC), jy = new Float32Array(NC), tone = new Float32Array(NC), ang = new Float32Array(NC);
    for (let i = 0; i < NC; i++) { jx[i] = rc(); jy[i] = rc(); tone[i] = rc(); ang[i] = rc() * Math.PI; }
    for (let y = 0; y < S2; y++) for (let x = 0; x < S2; x++) {
      const u = x / S2 * base, v = y / S2 * base, i = y * S2 + x;
      const e = fbm(n1, u, v, 6), ridge = 1 - Math.abs(fbm(n2, u * 1.9, v * 1.9, 5) * 2 - 1);
      const fine = n4(u * 22, v * 22) - .5;
      let h = e * .75 + ridge * ridge * .35 + fine * .015, a;
      if (kind === "region" || kind === "land") {
        if (kind === "region" && e < .44) { Wt[i] = 1; a = 30 + fbm(n3, u * 5, v * 5, 2) * 14; h = .44; }
        else a = 118 + (e - .44) * 150 + fine * 18 + (e < .452 ? 30 : 0);
      } else {
        a = 128 + (fbm(n3, u * 3, v * 3, 3) - .5) * 40 + fine * 22;
        const rv = Math.abs(fbm(n3, u * .45, v * .45, 3) - .5);
        if (rv < .03) { a = 206 + (.03 - rv) * 600 + fine * 10; h -= .02; Wt[i] = 2; }
        else if (rv < .05) a -= 22;
        else if (kind === "fields" && e > .46 && rv > .065) {
          const cx = Math.floor(x / cell), cy = Math.floor(y / cell); let best = 1e9, second = 1e9, k0 = 0;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const gx = cx + ox, gy = cy + oy; if (gx < 0 || gy < 0 || gx >= cells || gy >= cells) continue;
            const k = gy * cells + gx, px = (gx + jx[k]) * cell, py = (gy + jy[k]) * cell, dd = (px - x) * (px - x) + (py - y) * (py - y);
            if (dd < best) { second = best; best = dd; k0 = k; } else if (dd < second) second = dd;
          }
          const rows = Math.sin((x * Math.cos(ang[k0]) + y * Math.sin(ang[k0])) * 1.9) > .55 ? -9 : 0;
          a = 92 + tone[k0] * 70 + rows + fine * 30;
          if (Math.sqrt(second) - Math.sqrt(best) < 1.1) a = 74 + fine * 14;
          h = h * .4 + .3;
        }
      }
      Hm[i] = h; Al[i] = a;
    }
    const gain = kind === "region" ? 2600 : 1900;
    for (let y = 0; y < S2; y++) for (let x = 0; x < S2; x++) {
      const i = y * S2 + x, x0 = Math.max(0, x - 1), y0 = Math.max(0, y - 1), x1 = Math.min(S2 - 1, x + 1), y1 = Math.min(S2 - 1, y + 1);
      const shade = Wt[i] === 1 ? 0 : (Hm[y0 * S2 + x0] - Hm[y1 * S2 + x1]) * gain;
      let L = Al[i] + Math.max(-70, Math.min(70, shade)) + (r() - .5) * 12;
      const o = i * 4;
      d[o] = Math.max(0, Math.min(255, L * 1.04 + 6)); d[o + 1] = Math.max(0, Math.min(255, L * .98 + 2)); d[o + 2] = Math.max(0, Math.min(255, L * .86 - 4)); d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    if (kind !== "region") {
      const rb = rng(seed + 51), clusters = kind === "fields" ? 90 : 34, sz = kind === "fields" ? 4.5 : 2.6;
      for (let k = 0; k < clusters; k++) {
        const cx = rb() * S2, cy = rb() * S2, n = 8 + rb() * 26, spread = 20 + rb() * 34;
        for (let m = 0; m < n; m++) {
          const w = 1.5 + rb() * sz, h = 1.5 + rb() * sz, x = cx + (rb() - .5) * spread * 2, y = cy + (rb() - .5) * spread * 2;
          g.fillStyle = "rgba(18,16,12,.5)"; g.fillRect(x + 1.2, y + 1.2, w, h);
          g.fillStyle = rb() > .45 ? "rgba(226,216,194,.9)" : "rgba(160,150,128,.9)"; g.fillRect(x, y, w, h);
        }
      }
    }
    return c;
  }
  function geoLayer(span, tex, n) {
    const c = document.createElement("canvas"); c.width = c.height = SIZE; const g = c.getContext("2d");
    const [c0, c1] = GEO.center, k = Math.cos(c1 * Math.PI / 180), nz = noise(4242 + n);
    const pr = ([lon, lat]) => [SIZE / 2 + (lon - c0) * k / span * SIZE, SIZE / 2 - (lat - c1) / span * SIZE];
    function rough(pts, closed) {
      const P0 = pts.map(pr); if (closed) P0.push(P0[0]);
      let xs = Infinity, xe = -Infinity, ys = Infinity, ye = -Infinity; for (const [x, y] of P0) { xs = Math.min(xs, x); xe = Math.max(xe, x); ys = Math.min(ys, y); ye = Math.max(ye, y); }
      const rad = Math.max(xe - xs, ye - ys) / 2;
      if (closed && rad < .7) return null;
      const amp = closed ? Math.min(3.2, rad * .3) : 3.2, out = []; let s = 0, total = 0;
      for (let i = 1; i < P0.length; i++) total += Math.hypot(P0[i][0] - P0[i - 1][0], P0[i][1] - P0[i - 1][1]);
      for (let i = 1; i < P0.length; i++) {
        const [ax, ay] = P0[i - 1], [bx, by] = P0[i], L = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.ceil(L / 2.5)), nx = -(by - ay) / (L || 1), ny = (bx - ax) / (L || 1);
        for (let q = 0; q < m; q++) {
          const t = q / m, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, ss = s + L * t;
          const w = closed ? 1 : Math.min(1, ss / 24, (total - ss) / 24);
          const o = (fbm(nz, ss / 16, n * 7.3 + i * .01, 3) - .5) * 2 * amp * w;
          out.push([x + nx * o, y + ny * o]);
        }
        s += L;
      }
      if (!closed) out.push(P0[P0.length - 1]);
      return out;
    }
    const kc = rough(GEO.koreaCoast, false), cc = rough(GEO.chinaCoast, false), rc = rough(GEO.russiaCoast, false);
    const isl = GEO.islands.map(r => rough(r, true)).filter(Boolean);
    const border = GEO.nkBorder.slice(1).map(pr), close = GEO.mainlandClose.map(pr);
    const land = new Path2D(), poly = pts => { pts.forEach(([x, y], i) => (i ? land.lineTo(x, y) : land.moveTo(x, y))); land.closePath(); };
    poly(kc.concat(border)); poly(cc.concat(close, rc.slice().reverse(), border)); isl.forEach(poly);
    // water
    g.fillStyle = "#1b1a16"; g.fillRect(0, 0, SIZE, SIZE);
    g.globalAlpha = .1; g.drawImage(tex, 0, 0, SIZE, SIZE); g.globalAlpha = 1;
    // shoreline glow
    g.save(); g.shadowColor = "rgba(214,204,176,.4)"; g.shadowBlur = 16; g.fillStyle = "#3b382f"; g.fill(land); g.restore();
    // land texture
    g.save(); g.clip(land); g.translate(SIZE / 2, SIZE / 2); g.rotate(n * Math.PI / 2); g.drawImage(tex, -SIZE / 2, -SIZE / 2, SIZE, SIZE); g.restore();
    // graticule
    const step = span > 20 ? 5 : span > 5 ? 2 : .5;
    g.strokeStyle = "rgba(236,232,221,.09)"; g.lineWidth = 1; g.fillStyle = "rgba(236,232,221,.4)"; g.font = Math.round(SIZE / 52) + "px 'Share Tech Mono', monospace";
    const lonSpan = span / k / 2, latSpan = span / 2;
    for (let lon = Math.ceil((c0 - lonSpan) / step) * step; lon <= c0 + lonSpan; lon += step) { const [x] = pr([lon, c1]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SIZE); g.stroke(); g.fillText((+lon.toFixed(1)) + "°E", x + 4, SIZE * .06); }
    for (let lat = Math.ceil((c1 - latSpan) / step) * step; lat <= c1 + latSpan; lat += step) { const [, y] = pr([c0, lat]); g.beginPath(); g.moveTo(0, y); g.lineTo(SIZE, y); g.stroke(); g.fillText((+lat.toFixed(1)) + "°N", SIZE * .03, y - 4); }
    // coastlines
    g.strokeStyle = "rgba(236,230,210,.6)"; g.lineWidth = 1.2; g.lineJoin = "round";
    const line = pts => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
    [kc, cc, rc].forEach(line); isl.forEach(r => line(r.concat([r[0]])));
    // Han River through Seoul (about 1 km wide)
    const kmPx = span * 111 / SIZE;
    if (kmPx < 1) { g.setLineDash([]); g.strokeStyle = "rgba(236,230,210,.45)"; g.lineWidth = 1.2 / kmPx + 1.6; line(GEO.han.map(pr)); g.strokeStyle = "#24221d"; g.lineWidth = 1.2 / kmPx; line(GEO.han.map(pr)); }
    // borders: China–DPRK, and the DMZ in gold
    g.setLineDash([5, 4]); g.strokeStyle = "rgba(236,232,221,.4)"; g.lineWidth = 1.1; line(GEO.nkBorder.map(pr));
    g.setLineDash([7, 4]); g.strokeStyle = "rgba(214,176,86,.95)"; g.lineWidth = 1.8; line(GEO.dmz.map(pr)); g.setLineDash([]);
    return c;
  }
  const wait = ms => new Promise(res => setTimeout(res, ms));
  return {
    hold(ms) { holdMs = ms; },
    layers() {
      if (!promise) promise = (async () => {
        if (holdMs) await wait(holdMs);
        const seed = 1983; await wait(16);
        const tex = layer("land", seed); await wait(16);
        const out = [30, 10, 10 / 3].map((span, n) => geoLayer(span, tex, n)); await wait(16);
        out.push(layer("valley", seed + 101)); await wait(16);
        out.push(layer("fields", seed + 202));
        return out;
      })();
      return promise;
    },
    // zoom through the layer stack: p = 0 (region) … 2 (fields)
    draw(ctx, W, H, layers, p, rot, ox = 0, oy = 0, blur = 0) {
      ctx.fillStyle = "#0a0a09"; ctx.fillRect(0, 0, W, H);
      const n = layers.length; p = Math.max(0, Math.min(n - 1, p));
      const i = Math.min(n - 2, Math.floor(p)), t = p - i, D = Math.hypot(W, H) * 1.08;
      const one = (L, s, a) => { if (a <= 0.003) return; ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2 + ox, H / 2 + oy); ctx.rotate(rot); const z = D * s; ctx.drawImage(L, -z / 2, -z / 2, z, z); ctx.restore(); };
      const useBlur = blur > .3 && "filter" in ctx; if (useBlur) ctx.filter = "blur(" + blur.toFixed(1) + "px)";
      one(layers[i], Math.pow(3, t), 1);
      one(layers[i + 1], Math.pow(3, t) / 3, t * t * (3 - 2 * t));
      if (useBlur) ctx.filter = "none";
    }
  };
})();
const fitCanvas = (cv, cap = 1.5) => {
  const dpr = Math.min(cap, window.devicePixelRatio || 1), W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  return { W, H, dpr };
};
const hashStr = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 13; h = Math.imul(h, 2246822507) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
const gridRef = s => { const h = hashStr(s); return "52S CG " + String(h % 10000).padStart(4, "0") + " " + String((h >>> 14) % 10000).padStart(4, "0"); };
function labelStack(box, lines) {
  box.replaceChildren(...lines.filter(Boolean).map(([txt, cls]) => el("span", { class: cls || null }, txt)));
}

/* ─── hero map: terrain + tracking reticle cycling recent operations ─ */
const heroMap = (() => {
  const cv = $("#heroMap"), ctx = cv.getContext("2d"), ret = $("#heroReticle"), tgt = $("#heroTarget"), reg = $("#heroRegion");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let layers = null, ops = [], idx = -1, on = false, raf = 0, cycle = 0, sub = 0;
  const pan = { x: 0, y: 0, tx: 0, ty: 0 };
  function spot() { const W = cv.clientWidth, H = cv.clientHeight; return W < 760 ? { x: W * .7, y: H * .15 } : { x: W * .7, y: H * .46 }; }
  function place() {
    const s = spot(); ret.style.left = s.x + "px"; ret.style.top = s.y + "px";
    const W = cv.clientWidth; const lw = tgt.offsetWidth || 280;
    let lx = s.x + 34; if (lx + lw > W - 16) lx = Math.max(16, s.x - lw - 34);
    tgt.style.left = lx + "px"; tgt.style.top = (s.y - 14) + "px";
  }
  function show(o, locked) {
    if (!o) { labelStack(tgt, [["No operations logged", "s"]]); labelStack(reg, [["AO " + curUnit().id + " // AWAITING TRAFFIC"]]); place(); return; }
    const det = fm(o.detachment);
    labelStack(reg, [[(det ? "AO " + (det.name_local || det.id) : "AO " + curUnit().id) + " // " + gridRef(o.id)]]);
    labelStack(tgt, locked ? [["Located", "s"], [code(o.num) + " · " + (TYPES[o.type] || o.type)], [o.name || "Operation"], [detShort(o.detachment) + " · " + (o.date || "")], [(o.attendees || []).length + " present · host " + (o.host || "—")]]
      : [["Tracking...", "s blink"], [code(o.num)], [o.name || "Operation"]]);
    ret.classList.toggle("lock", locked); place();
  }
  function next() {
    if (!ops.length) { show(null); return; }
    idx = (idx + 1) % ops.length; const o = ops[idx];
    const h = hashStr(o.id); pan.tx = ((h % 200) - 100) * .9; pan.ty = (((h >>> 9) % 160) - 80) * .9;
    ret.classList.remove("lock"); void ret.offsetWidth;
    show(o, false); clearTimeout(sub); sub = setTimeout(() => show(o, true), reduce ? 0 : 1100);
  }
  function frame(t) {
    if (!layers) return;
    const { W, H, dpr } = fitCanvas(cv);
    pan.x += (pan.tx - pan.x) * .03; pan.y += (pan.ty - pan.y) * .03;
    const p = 3.52 + Math.sin(t / 9000) * .07, rot = -.42 + Math.sin(t / 14000) * .03;
    Terrain.draw(ctx, W, H, layers, p, rot, pan.x * dpr, pan.y * dpr, 0);
    if (on && !reduce && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function start() { cancelAnimationFrame(raf); if (layers) raf = requestAnimationFrame(frame); clearInterval(cycle); if (!reduce) cycle = setInterval(next, 6000); }
  window.addEventListener("resize", () => { place(); if (reduce && layers) frame(0); });
  document.addEventListener("visibilitychange", () => { if (on && !document.hidden) start(); });
  return {
    setOps(list) { const fresh = list.slice().sort(byNewest).slice(0, 8); const changed = fresh.map(o => o.id).join() !== ops.map(o => o.id).join(); ops = fresh; if (changed || idx < 0) { idx = -1; next(); } },
    active(v) {
      on = v; cancelAnimationFrame(raf); clearInterval(cycle);
      if (!v) return;
      if (!layers) Terrain.layers().then(L => { layers = L; if (on) { start(); if (reduce) frame(0); } });
      else { start(); if (reduce) frame(0); }
    }
  };
})();

function renderFeeds(ops) {
  const m = thisMonth(), P = pts(), mo = ops.filter(o => (o.date || "").startsWith(m));
  const c = t => mo.filter(o => o.type === t).length;
  const total = mo.reduce((s, o) => s + (o.attendees || []).length * (+P[o.type] || 0), 0);
  $("#feeds").replaceChildren("TRN ", el("b", null, c("training")), "  PRC ", el("b", null, c("practice")), "  RAID ", el("b", null, c("raid")), "  PTS ", el("b", null, total));
}

/* ─── emblem, clock, FX ────────────────────────────────────────────── */
// Emblem: config.js EMBLEM if set, otherwise assets/emblem.png; falls back to a drawn mark if the image is missing.
const EMBLEM = CFG.EMBLEM || "assets/emblem.png";
{
  $$(".em, .em-small").forEach(i => { i.src = EMBLEM; });
  // stacked layers give the intro badge real thickness when it spins
  const stack = $("#em3d"), N = 18, T = 16;
  for (let i = 0; i < N; i++) {
    const z = T / 2 - (i / (N - 1)) * T, front = i === 0, back = i === N - 1;
    stack.append(el("img", { src: EMBLEM, alt: "", class: "em-layer" + (front ? " em-front" : back ? " em-back" : ""),
      style: back ? "transform:rotateY(180deg) translateZ(" + (T / 2) + "px)" : "transform:translateZ(" + z.toFixed(2) + "px)" + (front ? "" : ";filter:brightness(" + (.28 + .22 * Math.sin(i / N * Math.PI)).toFixed(2) + ") saturate(.55)") }));
  }
  $("#intro").style.setProperty("--em-mask", "url(\"" + EMBLEM + "\")");
  const small = el("img", { src: EMBLEM, alt: "" }); small.onerror = () => { small.remove(); drawMark(); }; $("#identMark").append(small);
}
function drawMark() {
  const m = el("canvas", { width: 76, height: 76 }); $("#identMark").append(m);
  const g = m.getContext("2d"); g.strokeStyle = "#c9a24b"; g.lineWidth = 2;
  [30, 20, 10].forEach(r => { g.beginPath(); g.arc(38, 38, r, 0, 7); g.stroke(); });
  g.beginPath(); g.moveTo(38, 38); g.lineTo(62, 18); g.stroke();
}
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function tickClock() {
  const d = new Date();
  $("#clock").textContent = d.toISOString().slice(11, 19) + "Z";
  $("#dtg").textContent = String(d.getUTCDate()).padStart(2, "0") + String(d.getUTCHours()).padStart(2, "0") + String(d.getUTCMinutes()).padStart(2, "0") + "Z " + MON[d.getUTCMonth()] + " " + String(d.getUTCFullYear()).slice(2);
}
tickClock(); setInterval(tickClock, 1000);

function setFx(v) { document.body.classList.toggle("fx", v); const b = $("#fxToggle"); b.setAttribute("aria-pressed", String(v)); b.textContent = "Screen FX: " + (v ? "on" : "off"); store.set("fx", v); }
$("#fxToggle").addEventListener("click", () => setFx(!document.body.classList.contains("fx")));
setFx(store.get("fx", true));

/* ─── intro: emblem reveal → satellite tracking HUD ────────────────── */
const intro = (() => {
  const box = $("#intro"), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let timers = [], raf = 0, running = false, feedT = 0;
  const T = (ms, fn) => timers.push(setTimeout(fn, ms));
  function seen() { try { return sessionStorage.getItem("opsnet.intro") === "1"; } catch { return false; } }
  function mark() { try { sessionStorage.setItem("opsnet.intro", "1"); } catch {} }
  function names() {
    const u = curUnit(); if (!u || u.id === "—") return;
    $("#introName").textContent = u.name; $("#introTag").textContent = u.name_local || u.id;
    $$(".introSys").forEach(e => (e.textContent = u.id + " Systems"));
    $("#introNet").textContent = "NTWRK>>" + u.id + "-OPS-" + (hashStr(u.name) % 0xffff).toString(16).toUpperCase().padStart(4, "0");
  }
  function featured() {
    const top = standings("month").filter(r => r.points > 0).sort((a, b) => b.points - a.points)[0];
    if (top) {
      const p = person(top.username) || {}, c = fm(p.company), d = fm(top.detachment);
      const hq = p.billet && BILLETS[p.billet] && BILLETS[p.billet].level === "hq";
      return { region: d ? (d.region || d.name) : "Group headquarters", key: top.username,
        lines: [top.rank + ". " + top.username, hq ? BILLETS[p.billet].name : c && d ? c.name + ", " + d.name : d ? d.name : "Awaiting assignment", curUnit().name],
        aoLabel: d ? "AO " + (d.name_local || d.id) : "AO " + curUnit().id };
    }
    const o = unitOps().slice().sort(byNewest)[0];
    if (o) return { region: (fm(o.detachment) || {}).region || "Theater", key: o.id, lines: [code(o.num) + " · " + (o.name || ""), detShort(o.detachment), curUnit().name], aoLabel: "AO " + curUnit().id };
    return { region: "Theater", key: "x", lines: [curUnit().name, "Operations database online"], aoLabel: "AO " + curUnit().id };
  }
  function feeds() {
    const r = () => (Math.random() * .9).toFixed(2), rows = ["C_STEP", "N_GAIN", "T_LOCK", "R_HOLD", "Z_DRFT"];
    $("#introFeeds").textContent = "POINTER   X     Y     Z\n" + rows.map(k => k.padEnd(9) + " " + r() + "  " + r() + "  " + r()).join("\n");
    $("#introTele").textContent = "SAT_LINK>> KH-" + (1983 + Math.floor(Math.random() * 3)) + "\nCALIBRATION_____OK\nALIGNMENT___" + (30 + Math.floor(Math.random() * 9)) + "°" + String(Math.floor(Math.random() * 60)).padStart(2, "0") + "'";
    $("#introCd").textContent = "CD_" + (performance.now() / 1000).toFixed(3).padStart(7, "0");
  }
  function type(elm, speaker, text, ms) {
    const full = text.length > 110 ? text.slice(0, 107).replace(/\s+\S*$/, "") + "…" : text; let i = 0;
    const go = () => { elm.replaceChildren(el("span", { class: "sp" }, speaker + ": "), full.slice(0, i)); if (i++ < full.length) T(ms, go); };
    go();
  }
  function hud(layers) {
    box.classList.add("hud");
    const cv = $("#introMap"), ctx = cv.getContext("2d"), ret = $("#introReticle"), tgt = $("#introTarget"), reg = $("#introRegion");
    const f = featured();
    tgt.replaceChildren();
    const place = (x, y) => {
      ret.style.left = x + "px"; ret.style.top = y + "px";
      const W = cv.clientWidth, lw = tgt.offsetWidth || 300; let lx = x + 40; if (lx + lw > W - 16) lx = Math.max(16, x - lw - 40);
      tgt.style.left = lx + "px"; tgt.style.top = (y - 18) + "px";
      reg.style.left = Math.max(16, x - 300) + "px"; reg.style.top = Math.max(96, y - 170) + "px";
    };
    const W0 = () => cv.clientWidth, H0 = () => cv.clientHeight;
    ret.style.width = ret.style.height = Math.min(360, W0() * .6) + "px"; ret.classList.remove("lock");
    place(W0() * .5, H0() * .5);
    const dur = 6000, t0 = performance.now(), h = hashStr(f.key);
    const stages = [[0, "East Asia"], [.75, "Republic of Korea"], [1.7, "Seoul // Gyeonggi-do"], [2.75, null]]; let stage = -1;
    const ox = 0, oy = 0;
    const frame = t => {
      const k = Math.min(1, (t - t0) / dur), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const { W, H, dpr } = fitCanvas(cv, 1.25);
      const blur = Math.sin(Math.PI * Math.min(1, k * 1.15)) * 5 * dpr;
      const p = e * 3.8;
      Terrain.draw(ctx, W, H, layers, p, Math.max(0, p - 2) * -.2, ox * dpr * Math.max(0, 1 - p / 2.4), oy * dpr * Math.max(0, 1 - p / 2.4), p < 2.2 ? blur * .35 : blur);
      let s = 0; while (s + 1 < stages.length && p >= stages[s + 1][0]) s++;
      if (s !== stage) { stage = s; labelStack(reg, [[stages[s][1] || (f.aoLabel + " // " + gridRef(f.key))]]); }
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    feeds(); feedT = setInterval(feeds, 140);
    T(700, () => { labelStack(tgt, [["Tracking...", "s blink"], ...f.lines.map(l => [l])]); place(W0() * .5, H0() * .5); });
    T(900, () => type($("#introSub"), "Command", (S.settings.bulletin || "All units, stand by. Operations database is online.").split("\n")[0], 22));
    T(5200, () => {
      ret.classList.add("lock"); ret.style.width = ret.style.height = Math.min(220, W0() * .45) + "px";
      labelStack(tgt, [["Located", "s"], ...f.lines.map(l => [l])]); place(W0() * .5, H0() * .5);
    });
    T(7700, finish);
  }
  function finish() {
    if (!running) return;
    running = false; timers.forEach(clearTimeout); timers = []; cancelAnimationFrame(raf); clearInterval(feedT);
    box.classList.add("fade");
    setTimeout(() => { box.hidden = true; box.className = "intro"; $("#introSub").textContent = ""; heroMap.active(location.hash.slice(1) === "command" || !location.hash); }, 620);
    document.removeEventListener("keydown", onKey);
  }
  const onKey = e => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); } };
  function play(ready) {
    if (running) return; running = true; mark();
    heroMap.active(false);
    box.className = "intro"; box.hidden = false; void box.offsetWidth; box.classList.add("play");
    names(); if (ready) ready.then(names);
    document.addEventListener("keydown", onKey);
    const layersP = Terrain.layers();
    T(3500, () => box.classList.add("out"));
    T(3950, async () => { const L = await layersP; if (!running) return; if (ready) await Promise.race([ready, new Promise(r => setTimeout(r, 800))]); names(); hud(L); });
  }
  $("#introSkip").addEventListener("click", finish);
  $("#replayIntro").addEventListener("click", () => { window.scrollTo(0, 0); play(null); });
  return {
    running: () => running,
    shouldPlay() { return !reduce && !seen(); },
    auto(ready) { if (this.shouldPlay()) play(ready); }
  };
})();

/* ─── start ────────────────────────────────────────────────────────── */
(async () => {
  $("#demoBanner").hidden = LIVE;
  if (intro.shouldPlay()) Terrain.hold(2300);
  const ready = (async () => {
    if (!LIVE) { S.session = { user: { email: "demo@opsnet" } }; S.admin = true; }
    else { try { S.session = await api.session(); if (S.session) S.admin = await api.isAdmin(S.session.user.id); } catch {} }
    route(); await reload(); fillSettings(); resetOp(); resetP(); resetF();
  })();
  intro.auto(ready);
})();
})();
