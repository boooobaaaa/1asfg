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
const parseNames = s => [...new Set((s || "").split(/[\s,;]+/).map(x => x.trim().replace(/^@/, "")).filter(Boolean).map(x => x))]
  .filter((x, i, a) => a.findIndex(y => lc(y) === lc(x)) === i);
let toastT;
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.classList.toggle("bad", !!bad); t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800); }
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

/* ─── state ────────────────────────────────────────────────────────── */
const S = {
  units: [], settings: { bulletin: "", directive: "", defcon: 4, ticker: [], points: { training: 1, practice: 2, raid: 3 } },
  personnel: [], ops: [], unit: store.get("unit", null),
  opType: "all", period: "month", lbSort: { k: "points", dir: -1 },
  session: null, admin: false, editOp: null, editP: null
};
const pts = () => Object.assign({ training: 1, practice: 2, raid: 3 }, S.settings.points || {});
const unitOps = () => S.ops.filter(o => o.unit === S.unit);
const curUnit = () => S.units.find(u => u.id === S.unit) || S.units[0] || { id: "—", name: "Unit" };
const person = name => S.personnel.find(p => lc(p.username) === lc(name));

/* ─── data layer ───────────────────────────────────────────────────── */
const api = LIVE ? liveApi() : demoApi();

function liveApi() {
  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
  async function all(table, sel = "*") {
    const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      const { data, error } = await sb.from(table).select(sel).range(from, from + step - 1);
      if (error) throw error; out.push(...data); if (data.length < step) break;
    }
    return out;
  }
  const chk = ({ error }) => { if (error) throw error; };
  return {
    async load() {
      const [units, settings, personnel, ops, att] = await Promise.all([
        all("units"), sb.from("settings").select("*").eq("id", 1).maybeSingle(), all("personnel"), all("operations"), all("attendance")
      ]);
      const byOp = {}; for (const a of att) (byOp[a.op_id] ||= []).push(a.username);
      return { units: units.sort((a, b) => (a.sort || 0) - (b.sort || 0)), settings: settings.data || {}, personnel,
        ops: ops.map(o => ({ ...o, attendees: byOp[o.id] || [] })) };
    },
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async isAdmin(uid) { const { data } = await sb.from("admins").select("user_id").eq("user_id", uid).maybeSingle(); return !!data; },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return data.session; },
    async signOut() { await sb.auth.signOut(); },
    async saveOp(op, names) {
      let id = op.id;
      const row = { unit: op.unit, type: op.type, name: op.name, date: op.date, host: op.host || null, summary: op.summary || null, proof_url: op.proof_url || null };
      if (id) chk(await sb.from("operations").update(row).eq("id", id));
      else { const r = await sb.from("operations").insert(row).select("id").single(); chk(r); id = r.data.id; }
      chk(await sb.from("attendance").delete().eq("op_id", id));
      if (names.length) chk(await sb.from("attendance").insert(names.map(u => ({ op_id: id, username: u }))));
      const missing = names.concat(op.host ? [op.host] : []).filter(n => !person(n));
      if (missing.length) chk(await sb.from("personnel").upsert(missing.map(u => ({ username: u, unit: op.unit, joined: op.date, status: "active" })), { onConflict: "username", ignoreDuplicates: true }));
    },
    async deleteOp(id) { chk(await sb.from("operations").delete().eq("id", id)); },
    async savePerson(p) { const row = { username: p.username, rank: p.rank || null, unit: p.unit || null, joined: p.joined || null, status: p.status };
      chk(p.id ? await sb.from("personnel").update(row).eq("id", p.id) : await sb.from("personnel").insert(row)); },
    async deletePerson(id) { chk(await sb.from("personnel").delete().eq("id", id)); },
    async saveSettings(s) { chk(await sb.from("settings").upsert({ id: 1, ...s })); },
    async saveUnit(u) { chk(await sb.from("units").upsert(u)); },
    async deleteUnit(id) { chk(await sb.from("units").delete().eq("id", id)); }
  };
}

function demoApi() {
  const names = ["danielmax","rikilol999","AAACarl_114514","eliteboi126","DESMON_66","ujim106","khalid_cool17","Cheese_boi429","coupchap","DaniloW50","knightofkneon","Tactical_Sheperd","CaptainTrike","paranormal_caramel","Soul_Zephyrus","ironwake_07","SableFox22","northgate_kid"];
  const ranks = ["SGT","CPL","SSG","PFC","PVT","CPT","1LT","SFC"];
  const personnel = names.map((u, i) => ({ id: "p" + i, username: u, rank: ranks[i % ranks.length], unit: "1ASFG", joined: "2026-09-15", status: i === 17 ? "inactive" : "active" }));
  const tpl = [["Training Operation","training"],["Money Farm","training"],["Beach Landing Drill","practice"],["Operation Strait Watch","raid"],["Night Patrol","training"],["Harbor Breach","practice"],["Operation Iron Tide","raid"],["Formation & Drill","training"]];
  const ops = []; let n = 0;
  for (let d = 2; d <= 48; d += 3) {
    const t = tpl[n % tpl.length]; const dt = new Date(); dt.setDate(dt.getDate() - d + 3);
    const date = dt.toISOString().slice(0, 10); if (date > today()) continue;
    const pool = names.slice(0, 17); const cnt = 2 + ((n * 7) % 9);
    const att = pool.filter((_, i) => (i * 3 + n * 5) % 17 < cnt);
    ops.push({ id: "o" + n, num: n + 1, unit: "1ASFG", type: t[1], name: t[0], date, host: att[0] || names[0],
      summary: "Sample record for demo mode.", proof_url: n % 2 ? "https://example.com/proof" : null, attendees: att });
    n++;
  }
  const db = {
    units: [{ id: "1ASFG", name: "1st Airborne Special Forces Group", name_local: "第1空輸特戰團", tagline: "공수 특전 · Official Cold War faction", sort: 1 }],
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
      else db.ops.push({ ...op, id: "o" + seq, num: Math.max(0, ...db.ops.map(o => o.num)) + 1, attendees: names, _s: seq++ });
      for (const u of names.concat(op.host ? [op.host] : [])) if (!db.personnel.some(p => lc(p.username) === lc(u))) db.personnel.push({ id: "p" + seq++, username: u, unit: op.unit, joined: op.date, status: "active" });
    },
    async deleteOp(id) { db.ops = db.ops.filter(o => o.id !== id); },
    async savePerson(p) { if (p.id) Object.assign(db.personnel.find(x => x.id === p.id), p); else db.personnel.push({ ...p, id: "p" + seq++ }); },
    async deletePerson(id) { db.personnel = db.personnel.filter(p => p.id !== id); },
    async saveSettings(s) { Object.assign(db.settings, s); },
    async saveUnit(u) { const i = db.units.findIndex(x => x.id === u.id); i >= 0 ? (db.units[i] = { ...db.units[i], ...u }) : db.units.push(u); },
    async deleteUnit(id) { db.units = db.units.filter(u => u.id !== id); db.ops = db.ops.filter(o => o.unit !== id); }
  };
}

async function reload() {
  try {
    const d = await api.load();
    Object.assign(S, { units: d.units, personnel: d.personnel, ops: d.ops });
    S.settings = Object.assign(S.settings, d.settings || {});
    if (!S.units.some(u => u.id === S.unit)) S.unit = S.units[0] ? S.units[0].id : null;
    $("#link").textContent = LIVE ? "SECURE" : "DEMO";
  } catch (e) {
    console.error(e); $("#link").textContent = "LOST";
    const msg = (e && (e.message || e.error_description || e.hint)) || String(e);
    const hint = /relation .* does not exist|Could not find the table|schema cache/i.test(msg) ? " → Run supabase/schema.sql in the SQL Editor."
      : /Invalid API key|JWT|apikey|No API key/i.test(msg) ? " → Check SUPABASE_ANON_KEY in config.js."
      : /Failed to fetch|NetworkError|Load failed/i.test(msg) ? " → Check SUPABASE_URL, and that the project isn't paused."
      : "";
    const box = $("#demoBanner"); box.hidden = false; box.textContent = "DATABASE ERROR: " + msg + hint;
    toast("Database error: " + msg, true);
  }
  renderAll();
}

/* ─── scoring ──────────────────────────────────────────────────────── */
function standings(period) {
  const P = pts(); const m = thisMonth();
  const ops = unitOps().filter(o => period === "all" || (o.date || "").startsWith(m));
  const rows = {};
  const row = name => { const k = lc(name); if (!rows[k]) { const p = person(name) || {}; rows[k] = { username: p.username || name, rank: p.rank || "", status: p.status || "active", joined: p.joined || null, training: 0, practice: 0, raid: 0, attended: 0, points: 0, first: null }; } return rows[k]; };
  for (const p of S.personnel) if (p.unit === S.unit && p.status !== "inactive") row(p.username);
  for (const o of ops) for (const a of o.attendees || []) { const r = row(a); r[o.type]++; r.attended++; r.points += +P[o.type] || 0; if (!r.first || o.date < r.first) r.first = o.date; }
  // first-ever attendance in this unit, used when no joined date is set
  const firstAll = {}; for (const o of unitOps()) for (const a of o.attendees || []) { const k = lc(a); if (!firstAll[k] || o.date < firstAll[k]) firstAll[k] = o.date; }
  for (const [k, r] of Object.entries(rows)) {
    const since = r.joined || firstAll[k] || null;
    const eligible = ops.filter(o => !since || o.date >= since).length;
    r.eligible = eligible; r.rate = eligible ? Math.min(1, r.attended / eligible) : 0;
  }
  return Object.values(rows);
}

/* ─── render ───────────────────────────────────────────────────────── */
function renderChrome() {
  const u = curUnit();
  $("#identName").textContent = u.name; $("#identCode").textContent = u.id;
  $$(".unitCode").forEach(x => (x.textContent = u.id));
  document.title = (u.id && u.id !== "—" ? u.id + " · " : "") + (CFG.SITE_NAME || "OPSNET") + " Activity Log";
  const sw = $("#unitSwitch"); sw.replaceChildren(...S.units.map(x => el("button", { type: "button", "aria-pressed": String(x.id === S.unit), onclick: () => { S.unit = x.id; store.set("unit", x.id); renderAll(); } }, x.id)));
  sw.hidden = S.units.length < 2;
  const lines = (S.settings.ticker && S.settings.ticker.length ? S.settings.ticker : [u.name]);
  const t = $("#ticker"); t.replaceChildren(...[...lines, ...lines].map(s => el("span", null, s)));
  t.style.animationDuration = Math.max(20, lines.join("").length * 0.9) + "s";
}

function renderCommand() {
  const u = curUnit();
  $("#heroKicker").textContent = u.name + " · " + u.id;
  const title = $("#heroTitle"); const local = u.name_local || u.name;
  title.textContent = local; title.classList.toggle("latin", !/[㐀-鿿]/.test(local));
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
  const top = standings("month").filter(r => r.points > 0).sort((a, b) => b.points - a.points || a.username.localeCompare(b.username)).slice(0, 6);
  $("#topBoard").replaceChildren(...(top.length ? top.map((r, i) => el("li", null, el("span", { class: "n" }, "#" + (i + 1)), el("span", { class: "u" }, r.username), el("span", { class: "p" }, r.points + " pts")))
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
    el("div", { class: "op-top" }, el("span", null, el("span", { class: "op-code" }, code(o.num)), el("span", { class: "tag " + o.type }, TYPES[o.type] || o.type)), el("span", { class: "op-date" }, "▣ " + (o.date || "—"))),
    el("p", { class: "op-name" }, o.name || "Unnamed operation"),
    el("p", { class: "op-host" }, "Hosted by ", el("b", null, o.host || "—")),
    o.summary ? el("p", { class: "op-sum" }, o.summary) : null,
    att.length ? chipsWrap : null,
    el("div", { class: "op-foot" }, el("span", null, el("b", null, att.length), " attended"), el("span", null, el("b", null, att.length * (+P[o.type] || 0)), " pts awarded"),
      o.proof_url && /^https?:\/\//i.test(o.proof_url) ? el("a", { href: o.proof_url, target: "_blank", rel: "noopener" }, "▤ Proof") : null));
}

function renderOps() {
  const q = lc($("#q").value); const mo = $("#month").value; const s = $("#sort").value;
  let ops = unitOps().filter(o => S.opType === "all" || o.type === S.opType).filter(o => !mo || (o.date || "").startsWith(mo));
  if (q) ops = ops.filter(o => [code(o.num), o.name, o.host, o.summary, TYPES[o.type], o.date, ...(o.attendees || [])].join(" ").toLowerCase().includes(q));
  ops.sort(s === "old" ? (a, b) => -byNewest(a, b) : s === "att" ? (a, b) => (b.attendees || []).length - (a.attendees || []).length : byNewest);
  $("#opCount").textContent = ops.length + " of " + unitOps().length + " records";
  $("#opList").replaceChildren(...(ops.length ? ops.map(o => opCard(o, 12)) : [el("div", { class: "empty" }, unitOps().length ? "No operations match." : "No operations logged yet.")]));
}

function renderLB() {
  const q = lc($("#lq").value); let rows = standings(S.period);
  const ranked = [...rows].sort((a, b) => b.points - a.points || b.rate - a.rate || a.username.localeCompare(b.username));
  const rank = new Map(ranked.map((r, i) => [r, i + 1]));
  const { k, dir } = S.lbSort;
  rows.sort((a, b) => { const x = a[k], y = b[k]; return typeof x === "number" ? dir * (x - y) || rank.get(a) - rank.get(b) : dir * String(x || "").localeCompare(String(y || "")); });
  if (q) rows = rows.filter(r => lc(r.username + " " + r.rank).includes(q));
  $$(".lb th[data-k]").forEach(th => th.dataset.k === k ? th.setAttribute("data-sort", dir > 0 ? "asc" : "desc") : th.removeAttribute("data-sort"));
  $("#lbBody").replaceChildren(...(rows.length ? rows.map(r => {
    const pct = Math.round(r.rate * 100);
    return el("tr", { class: (rank.get(r) <= 3 && r.points > 0 ? "top " : "") + (r.status === "inactive" ? "inactive" : "") },
      el("td", { class: "r" }, String(rank.get(r)).padStart(2, "0")), el("td", null, r.username), el("td", null, r.rank || "—"),
      el("td", { class: "num" }, r.training), el("td", { class: "num" }, r.practice), el("td", { class: "num" }, r.raid),
      el("td", { class: "num" }, el("span", { class: "meter" }, el("i", null, el("b", { class: pct < 50 ? "low" : pct < 75 ? "mid" : "", style: "width:" + pct + "%" })), pct + "% (" + r.attended + "/" + r.eligible + ")")),
      el("td", { class: "num pts" }, r.points));
  }) : [el("tr", null, el("td", { colspan: "8", style: "text-align:center;color:var(--fg-dim);padding:28px" }, "No one on the board for this period yet."))]));
  const P = pts();
  $("#legend").textContent = "Scoring: Training " + P.training + " · Practice raid " + P.practice + " · Raid " + P.raid + " points per event attended. " +
    (S.period === "month" ? "Monthly board resets on the 1st. " : "") + "Attendance counts events held in this unit since the operator's join date (or first event, if no join date is set). Click a column to sort.";
}
$$(".lb th[data-k]").forEach(th => th.addEventListener("click", () => { const k = th.dataset.k; S.lbSort = { k, dir: S.lbSort.k === k ? -S.lbSort.dir : (k === "username" || k === "rank" ? 1 : -1) }; renderLB(); }));

/* ─── admin ────────────────────────────────────────────────────────── */
function renderAdmin() {
  const signedIn = !!S.session;
  $("#loginForm").hidden = signedIn; $("#notAdmin").hidden = !signedIn || S.admin; $("#console").hidden = !(signedIn && S.admin);
  if (!(signedIn && S.admin)) return;
  $("#whoami").textContent = "Cleared: " + ((S.session.user && S.session.user.email) || "admin") + (LIVE ? "" : " (demo)");
  const unitOpts = sel => { const v = sel.value; sel.replaceChildren(...S.units.map(u => el("option", { value: u.id }, u.id + " — " + u.name))); sel.value = v || S.unit; };
  unitOpts($("#fUnit")); unitOpts($("#pUnit"));
  $("#userList").replaceChildren(...S.personnel.map(p => el("option", { value: p.username })));
  // ops list
  const mq = lc($("#mq").value);
  const ops = [...S.ops].sort(byNewest).filter(o => !mq || lc([code(o.num), o.name, o.unit, o.host, o.date].join(" ")).includes(mq));
  $("#mOps").replaceChildren(...(ops.length ? ops.map(o => {
    const del = el("button", { class: "btn sm danger", type: "button" }, "Delete"); armed(del, () => run(() => api.deleteOp(o.id), code(o.num) + " deleted"));
    return el("div", { class: "mrow" }, el("span", { class: "t" }, code(o.num) + " · " + (o.name || ""), el("small", null, o.unit + " · " + TYPES[o.type] + " · " + o.date + " · " + (o.attendees || []).length + " present")),
      el("span", { class: "btnrow" }, el("button", { class: "btn sm", type: "button", onclick: () => editOp(o) }, "Edit"), del));
  }) : [el("div", { class: "mrow" }, "No operations on file.")]));
  // people
  const pq = lc($("#pq").value);
  const ppl = [...S.personnel].sort((a, b) => a.username.localeCompare(b.username)).filter(p => !pq || lc(p.username + " " + (p.rank || "") + " " + (p.unit || "")).includes(pq));
  $("#mPeople").replaceChildren(...(ppl.length ? ppl.map(p => {
    const del = el("button", { class: "btn sm danger", type: "button" }, "Remove"); armed(del, () => run(() => api.deletePerson(p.id), p.username + " removed"));
    return el("div", { class: "mrow" }, el("span", { class: "t" }, (p.rank ? p.rank + " " : "") + p.username, el("small", null, (p.unit || "—") + " · joined " + (p.joined || "—") + (p.status === "inactive" ? " · INACTIVE" : ""))),
      el("span", { class: "btnrow" }, el("button", { class: "btn sm", type: "button", onclick: () => editPerson(p) }, "Edit"), del));
  }) : [el("div", { class: "mrow" }, "Roster is empty.")]));
  // units
  $("#mUnits").replaceChildren(...S.units.map(u => {
    const del = el("button", { class: "btn sm danger", type: "button", disabled: S.units.length < 2 }, "Delete"); armed(del, () => run(() => api.deleteUnit(u.id), u.id + " deleted"));
    return el("div", { class: "mrow" }, el("span", { class: "t" }, u.id + " — " + u.name, el("small", null, u.name_local || "")),
      el("span", { class: "btnrow" }, el("button", { class: "btn sm", type: "button", onclick: () => { $("#uId").value = u.id; $("#uName").value = u.name || ""; $("#uLocal").value = u.name_local || ""; $("#uTag").value = u.tagline || ""; } }, "Edit"), del));
  }));
}
function fillSettings() {
  const s = S.settings, P = pts();
  $("#sBul").value = s.bulletin || ""; $("#sDir").value = s.directive || ""; $("#sDef").value = String(s.defcon || 4);
  $("#sPT").value = P.training; $("#sPP").value = P.practice; $("#sPR").value = P.raid; $("#sTick").value = (s.ticker || []).join("\n");
}
async function run(fn, ok) {
  try { await fn(); toast(ok); await reload(); }
  catch (e) { console.error(e); toast((e && e.message) || "Could not save.", true); }
}
$$(".atabs button").forEach(b => b.addEventListener("click", () => {
  $$(".atabs button").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  $$("[data-pane]").forEach(p => (p.hidden = p.dataset.pane !== b.dataset.a));
}));
function showPane(a) { $(".atabs button[data-a='" + a + "']").click(); }

function resetOp() { S.editOp = null; $("#opForm").reset(); $("#fDate").value = today(); $("#fUnit").value = S.unit || ""; $("#opFormTitle").textContent = "Log an operation"; $("#opSave").textContent = "Log operation"; $("#opCancel").hidden = true; previewAtt(); }
function editOp(o) {
  S.editOp = o.id; showPane("log");
  $("#fUnit").value = o.unit; $("#fType").value = o.type; $("#fDate").value = o.date; $("#fHost").value = o.host || ""; $("#fName").value = o.name || "";
  $("#fProof").value = o.proof_url || ""; $("#fSum").value = o.summary || ""; $("#fAtt").value = (o.attendees || []).join("\n");
  $("#opFormTitle").textContent = "Edit " + code(o.num); $("#opSave").textContent = "Save changes"; $("#opCancel").hidden = false; previewAtt();
  $("#opForm").scrollIntoView({ behavior: "smooth", block: "start" });
}
function previewAtt() { const n = parseNames($("#fAtt").value); const fresh = n.filter(x => !person(x)).length; $("#attPreview").textContent = n.length + " attendee" + (n.length === 1 ? "" : "s") + (fresh ? " · " + fresh + " new to roster" : ""); }
$("#fAtt").addEventListener("input", previewAtt);
$("#opCancel").addEventListener("click", resetOp);
$("#opForm").addEventListener("submit", e => {
  e.preventDefault();
  const names = parseNames($("#fAtt").value).map(n => (person(n) || {}).username || n);
  const op = { id: S.editOp, unit: $("#fUnit").value, type: $("#fType").value, date: $("#fDate").value, host: $("#fHost").value.trim().replace(/^@/, ""), name: $("#fName").value.trim(), proof_url: $("#fProof").value.trim(), summary: $("#fSum").value.trim() };
  if (!op.name) return;
  const was = S.editOp;
  run(() => api.saveOp(op, names), was ? "Operation updated" : "Operation logged").then(resetOp);
});

function resetP() { S.editP = null; $("#pForm").reset(); $("#pUnit").value = S.unit || ""; $("#pJoin").value = today(); $("#pTitle").textContent = "Add personnel"; $("#pSave").textContent = "Add"; $("#pCancel").hidden = true; }
function editPerson(p) { S.editP = p.id; $("#pUser").value = p.username; $("#pRank").value = p.rank || ""; $("#pUnit").value = p.unit || ""; $("#pJoin").value = p.joined || ""; $("#pStatus").value = p.status || "active"; $("#pTitle").textContent = "Edit " + p.username; $("#pSave").textContent = "Save"; $("#pCancel").hidden = false; $("#pForm").scrollIntoView({ behavior: "smooth", block: "center" }); }
$("#pCancel").addEventListener("click", resetP);
$("#pForm").addEventListener("submit", e => {
  e.preventDefault();
  const p = { id: S.editP, username: $("#pUser").value.trim().replace(/^@/, ""), rank: $("#pRank").value.trim().toUpperCase(), unit: $("#pUnit").value, joined: $("#pJoin").value, status: $("#pStatus").value };
  if (!p.username) return;
  if (!p.id && person(p.username)) { toast(p.username + " is already on the roster", true); return; }
  run(() => api.savePerson(p), p.id ? "Record updated" : p.username + " added").then(resetP);
});
["mq", "pq"].forEach(id => $("#" + id).addEventListener("input", renderAdmin));

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
  try { S.session = await api.signIn($("#lgEmail").value.trim(), $("#lgPass").value); S.admin = await api.isAdmin(S.session.user.id); $("#lgPass").value = ""; renderAll(); fillSettings(); resetOp(); resetP(); }
  catch (err) { $("#lgErr").textContent = "Access denied: " + ((err && err.message) || "check your email and password."); $("#lgErr").hidden = false; }
});
$$("[data-signout]").forEach(b => b.addEventListener("click", async () => { await api.signOut(); S.session = null; S.admin = false; renderAll(); }));

/* ─── filters & routing ────────────────────────────────────────────── */
function seg(id, key, after) { $("#" + id).addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S[key] = b.dataset.v; $$("#" + id + " button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); after(); }); }
seg("typeSeg", "opType", renderOps); seg("periodSeg", "period", renderLB);
["q", "sort", "month"].forEach(id => $("#" + id).addEventListener("input", renderOps));
$("#lq").addEventListener("input", renderLB);

const TABS = ["command", "ops", "leaderboard", "admin"];
function route() {
  const h = location.hash.slice(1); const t = TABS.includes(h) ? h : "command";
  TABS.forEach(x => ($("#v-" + x).hidden = x !== t));
  $$(".nav a").forEach(a => a.dataset.tab === t ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  radar.active(t === "command");
}
window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });

function renderAll() { renderChrome(); renderCommand(); renderOps(); renderLB(); renderAdmin(); }

/* ─── radar scope ──────────────────────────────────────────────────── */
const radar = (() => {
  const c = $("#radar"), x = c.getContext("2d"); const W = c.width, R = W / 2 - 6;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let blips = [], ang = 0, on = true, raf = 0, last = 0;
  const col = { training: "127,182,255", practice: "255,200,87", raid: "255,90,74" };
  const hash = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  function setBlips(ops) {
    const now = Date.now();
    blips = ops.slice().sort(byNewest).slice(0, 24).map(o => {
      const age = Math.max(0, (now - new Date(o.date + "T12:00:00").getTime()) / 864e5);
      return { a: (hash(o.id) % 3600) / 3600 * Math.PI * 2, r: Math.min(0.92, 0.18 + age / 40), c: col[o.type] || "157,255,176", lit: 0 };
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
    // sweep trail
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
  const lines = ["OPSNET SECURE TERMINAL  REV 4.1", "COPYRIGHT (C) 1983 // CLASSIFIED", "", "MEMORY CHECK ........ 640K OK", "CRYPTO MODULE ....... KEYED", "UPLINK .............. " + (LIVE ? "ESTABLISHED" : "DEMO LOOPBACK"), "AUTHENTICATING ...... GRANTED", "", "> LOADING ACTIVITY LOG"];
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
  route(); await reload(); fillSettings(); resetOp(); resetP();
})();
})();
