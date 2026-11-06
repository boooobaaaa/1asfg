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
  $("#identName").textContent = u.name; $("#identCode").textContent = u.id;
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
  $("#heroKicker").textContent = u.name + " · " + u.id;
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
  radar.setBlips(ops);
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
  radar.active(t === "command");
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

function renderAll() { renderChrome(); renderCommand(); renderOps(); renderLB(); renderRoster(); renderAdmin(); }

/* ─── radar scope ──────────────────────────────────────────────────── */
const radar = (() => {
  const c = $("#radar"), x = c.getContext("2d"); const W = c.width, R = W / 2 - 6;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let blips = [], ang = 0, on = true, raf = 0, last = 0;
  const col = { training: "127,182,255", practice: "255,200,87", raid: "255,90,74" };
  const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 13; h = Math.imul(h, 2246822507) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
  function setBlips(ops) {
    const now = Date.now();
    blips = ops.slice().sort(byNewest).slice(0, 24).map(o => {
      const age = Math.max(0, (now - new Date(o.date + "T12:00:00").getTime()) / 864e5);
      return { a: (hash(o.id) % 3600) / 3600 * Math.PI * 2, r: Math.min(0.94, 0.66 + age / 160), c: col[o.type] || "157,255,176", lit: 0 };
    });
    $("#contacts").textContent = String(blips.length).padStart(2, "0");
  }
  function frame(t) {
    const dt = Math.min(64, t - (last || t)); last = t; ang = (ang + dt * 0.0011) % (Math.PI * 2);
    x.clearRect(0, 0, W, W); x.save(); x.translate(W / 2, W / 2);
    x.fillStyle = "#031006"; x.beginPath(); x.arc(0, 0, R, 0, 7); x.fill();
    x.strokeStyle = "rgba(157,255,176,.18)"; x.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { x.beginPath(); x.arc(0, 0, R * i / 4, 0, 7); x.stroke(); }
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * R, Math.sin(a) * R); x.stroke(); }
    x.fillStyle = "rgba(157,255,176,.45)"; x.font = "14px VT323, monospace"; x.textAlign = "center"; x.textBaseline = "middle";
    ["000", "090", "180", "270"].forEach((s, i) => { const a = i * Math.PI / 2 - Math.PI / 2; x.fillText(s, Math.cos(a) * (R - 14), Math.sin(a) * (R - 14)); });
    for (let i = 0; i < 72; i++) { const a = i * Math.PI / 36, l = i % 6 ? 5 : 10; x.beginPath(); x.moveTo(Math.cos(a) * R, Math.sin(a) * R); x.lineTo(Math.cos(a) * (R - l), Math.sin(a) * (R - l)); x.stroke(); }
    for (let i = 0; i < 40; i++) {
      const a0 = ang - i * 0.02; x.fillStyle = "rgba(80,255,120," + (0.22 * (1 - i / 40)) + ")";
      x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, R, a0 - 0.02, a0); x.closePath(); x.fill();
    }
    x.strokeStyle = "rgba(157,255,176,.95)"; x.lineWidth = 2; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(ang) * R, Math.sin(ang) * R); x.stroke();
    for (const b of blips) {
      const d = ((ang - b.a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (d < 0.06) b.lit = 1; else b.lit = Math.max(0.12, b.lit - dt * 0.00035);
      const px = Math.cos(b.a) * b.r * R, py = Math.sin(b.a) * b.r * R;
      x.fillStyle = "rgba(" + b.c + "," + b.lit + ")"; x.shadowColor = "rgba(" + b.c + ",1)"; x.shadowBlur = 12 * b.lit;
      x.beginPath(); x.arc(px, py, 4, 0, 7); x.fill(); x.shadowBlur = 0;
    }
    x.restore();
    $("#brg").textContent = String(Math.round(((ang * 180 / Math.PI) + 90) % 360)).padStart(3, "0");
    if (on && !reduce) raf = requestAnimationFrame(frame);
  }
  return { setBlips(o) { setBlips(o); if (reduce) frame(performance.now()); }, active(v) { on = v; cancelAnimationFrame(raf); last = 0; if (v) raf = requestAnimationFrame(frame); } };
})();

/* ─── emblem, clock, FX, boot ──────────────────────────────────────── */
// Emblem: config.js EMBLEM if set, otherwise assets/emblem.png; falls back to a drawn radar mark if the image is missing.
const EMBLEM = CFG.EMBLEM || "assets/emblem.png";
{
  const big = $("#emblem"); big.onerror = () => (big.hidden = true); big.onload = () => (big.hidden = false); big.src = EMBLEM;
  const small = el("img", { src: EMBLEM, alt: "" }); small.onerror = () => { small.remove(); drawMark(); }; $("#identMark").append(small);
}
function drawMark() {
  const m = el("canvas", { width: 76, height: 76 }); $("#identMark").append(m);
  const g = m.getContext("2d"); g.strokeStyle = "#9dffb0"; g.lineWidth = 2;
  [30, 20, 10].forEach(r => { g.beginPath(); g.arc(38, 38, r, 0, 7); g.stroke(); });
  g.beginPath(); g.moveTo(38, 38); g.lineTo(62, 18); g.stroke(); g.fillStyle = "#e6d35a"; g.beginPath(); g.arc(50, 48, 3, 0, 7); g.fill();
}
setInterval(() => ($("#clock").textContent = new Date().toISOString().slice(11, 19) + "Z"), 1000);

function setFx(v) { document.body.classList.toggle("fx", v); const b = $("#fxToggle"); b.setAttribute("aria-pressed", String(v)); b.textContent = "CRT effects: " + (v ? "on" : "off"); store.set("fx", v); }
$("#fxToggle").addEventListener("click", () => setFx(!document.body.classList.contains("fx")));
setFx(store.get("fx", true));

function boot() {
  const box = $("#boot"), pre = $("#bootText");
  let seen = false; try { seen = sessionStorage.getItem("opsnet.boot") === "1"; sessionStorage.setItem("opsnet.boot", "1"); } catch {}
  if (seen || matchMedia("(prefers-reduced-motion: reduce)").matches) { box.remove(); return; }
  const lines = ["OPSNET SECURE TERMINAL  REV 4.2", "COPYRIGHT (C) 1983 // CLASSIFIED", "", "MEMORY CHECK ........ 640K OK", "CRYPTO MODULE ....... KEYED", "UPLINK .............. " + (LIVE ? "ESTABLISHED" : "DEMO LOOPBACK"), "AUTHENTICATING ...... GRANTED", "", "> LOADING ORDER OF BATTLE"];
  let i = 0, j = 0; pre.classList.add("cursor");
  const step = () => {
    if (i >= lines.length) { setTimeout(() => { box.classList.add("done"); setTimeout(() => box.remove(), 450); }, 250); return; }
    const L = lines[i]; j = Math.min(L.length, j + 3);
    pre.textContent = lines.slice(0, i).join("\n") + (i ? "\n" : "") + L.slice(0, j);
    if (j >= L.length) { i++; j = 0; setTimeout(step, 70); } else setTimeout(step, 12);
  };
  box.addEventListener("click", () => { i = lines.length; box.classList.add("done"); setTimeout(() => box.remove(), 450); });
  step();
}

/* ─── start ────────────────────────────────────────────────────────── */
(async () => {
  boot();
  $("#demoBanner").hidden = LIVE;
  if (!LIVE) { S.session = { user: { email: "demo@opsnet" } }; S.admin = true; }
  else { try { S.session = await api.session(); if (S.session) S.admin = await api.isAdmin(S.session.user.id); } catch {} }
  route(); await reload(); fillSettings(); resetOp(); resetP(); resetF();
})();
})();
