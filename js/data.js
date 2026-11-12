/* ==========================================================================
   1ASFG DATA LAYER
   One API, two backends:
     • LIVE  — Supabase (tables from supabase/schema.sql)
     • DEMO  — this browser's localStorage, seeded with sample data
   ========================================================================== */
(function () {
  "use strict";
  const CFG = window.SITE_CONFIG || {};
  const LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const PHOTO_BUCKET = "photos";

  const uid = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------------------------------------------------------------- defaults */
  const DEFAULT_SETTINGS = {
    unitName: "1st Airborne Special Forces Group",
    unitShort: "1ASFG",
    unitNameKr: "제1공수특전단",
    kicker: "Official Cold War faction · Roblox",
    heroText:
      "Every training, practice raid and raid the Group runs is logged here by Command and tallied into the merit leaderboard. White Horse and Fierce Tiger compete for the detachment standard.",
    motto: "안되면 되게 하라 · Make the impossible possible",
    ticker: [
      "TRANSMISSION BEGINS",
      "제1공수특전단",
      "AUTHORIZED PERSONNEL ONLY",
      "WHITE HORSE · 백마",
      "FIERCE TIGER · 맹호",
      "안되면 되게 하라",
      "OPERATIONS LOG UPDATING",
    ],
    transmissions: [
      { speaker: "Command", text: "Every jump is logged. Every operative is accounted for." },
      { speaker: "Command", text: "White Horse, Fierce Tiger — the standard goes to whoever shows up." },
      { speaker: "Jumpmaster", text: "Check your static line. Stand in the door." },
      { speaker: "Command", text: "Make the impossible possible." },
    ],
    staffIntro:
      "The officers and NCOs who lead the 1st Airborne Special Forces Group and its two detachments.",
    points: { training: 1, practice_raid: 3, raid_victory: 5, raid_defeat: 4, host_bonus: 0 },
    detachments: {
      white_horse: { name: "White Horse Airborne Detachment", short: "White Horse", kr: "백마" },
      fierce_tiger: { name: "Fierce Tiger Airborne Detachment", short: "Fierce Tiger", kr: "맹호" },
    },
    ranks: [
      "[EN-I] 이병 | PRIVATE",
      "[EN-II] 일병 | PRIVATE FIRST CLASS",
      "[EN-III] 상병 | CORPORAL",
      "[EN-IV] 병장 | SERGEANT",
      "[NCO-I] 하사 | STAFF SERGEANT",
      "[NCO-II] 중사 | SERGEANT FIRST CLASS",
      "[NCO-III] 상사 | MASTER SERGEANT",
      "[NCO-IV] 원사 | SERGEANT MAJOR",
      "[OF-I] 소위 | SECOND LIEUTENANT",
      "[OF-II] 중위 | FIRST LIEUTENANT",
      "[OF-III] 대위 | CAPTAIN",
      "[OF-IV] 소령 | MAJOR",
      "[OF-V] 중령 | LIEUTENANT COLONEL",
      "[OF-VI] 대령 | COLONEL",
      "[GO-I] 준장 | BRIGADIER GENERAL",
    ],
    links: { roblox: "", discord: "" },
    introEnabled: true,
    introSound: true,
    introMusic: true,
    introMusicSrc: "",          // legacy single-file setting (still honoured)
    introMusicOffset: 0,
    introMusicVolume: 70,
    introTracks: [],            // [{ id, name, src, path, offset, volume, duration }]
    introTrackId: "",           // "" = built-in cue
  };

  function mergeSettings(s) {
    s = s || {};
    const d = clone(DEFAULT_SETTINGS);
    const out = Object.assign(d, s);
    out.points = Object.assign({}, DEFAULT_SETTINGS.points, s.points || {});
    out.links = Object.assign({}, DEFAULT_SETTINGS.links, s.links || {});
    out.detachments = {
      white_horse: Object.assign({}, DEFAULT_SETTINGS.detachments.white_horse, (s.detachments || {}).white_horse || {}),
      fierce_tiger: Object.assign({}, DEFAULT_SETTINGS.detachments.fierce_tiger, (s.detachments || {}).fierce_tiger || {}),
    };
    if (!Array.isArray(out.introTracks)) out.introTracks = [];
    ["ticker", "transmissions", "ranks"].forEach((k) => {
      if (!Array.isArray(out[k]) || !out[k].length) out[k] = clone(DEFAULT_SETTINGS[k]);
    });
    return out;
  }

  /* ------------------------------------------------------------- demo seed */
  function seed() {
    let r = 7;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const names = [
      "KimJaeho_ROK", "Park_Sangwoo", "ColdSteel_92", "Lee_Minjun", "Ghost_of_Inje", "Choi_Hyunwoo",
      "Jung_Dohyun", "SilentWing", "Kang_Taeyang", "HalfMoonJumper", "Yoon_Seojin", "Han_Jisung",
      "Static_Line", "Oh_Jinwoo", "Seo_Kyungmin", "NightDrop_7", "Shin_Woojin", "Kwon_Hyuk",
      "Hwang_Sungmin", "Baek_Dongha", "TigerClaw_Kr", "Ahn_Yejun", "Song_Minho", "Jeon_Haneul",
      "Moon_Seungri", "Ryu_Kangdae", "WhiteMane_01", "Jang_Wonbin", "Im_Chanwoo", "Nam_Gyuri",
      "Cha_Eunsoo", "DMZ_Recon", "Yu_Jihoon", "Go_Taehyun", "Bae_Junseo", "Hong_Sejin",
    ];
    const ranks = DEFAULT_SETTINGS.ranks;
    const members = names.map((n, i) => {
      const det = i < 3 ? "hq" : i % 2 ? "white_horse" : "fierce_tiger";
      let ri = i < 3 ? [13, 11, 7][i] : i < 9 ? 8 + (i % 3) : Math.floor(rnd() * 7);
      return {
        id: uid(),
        username: n,
        rank: ranks[ri],
        detachment: det,
        status: i > 32 ? "inactive" : "active",
        joined_on: `2026-${String(4 + Math.floor(rnd() * 5)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}`,
        notes: "",
        created_at: new Date().toISOString(),
      };
    });
    const active = members.filter((m) => m.status === "active");
    const hosts = members.slice(0, 9);
    const P = DEFAULT_SETTINGS.points;
    const titles = {
      training: ["Static-Line Jump Training", "HALO Familiarisation", "Close Quarters Drill", "Land Navigation", "Infiltration Drill", "Marksmanship Range"],
      practice_raid: ["Practice Raid: Hill 351", "Mock Assault: Radar Site", "Night Raid Rehearsal", "Joint Detachment Exercise"],
      raid: ["Raid: Kaesong Outpost", "Raid: DMZ Listening Post", "Raid: Wonsan Supply Depot", "Raid vs. KPA Recon", "Raid: Northern Airfield"],
    };
    const events = [];
    const months = ["2026-09", "2026-10", "2026-11"];
    for (let i = 0; i < 26; i++) {
      const t = rnd();
      const type = t < 0.45 ? "training" : t < 0.7 ? "practice_raid" : "raid";
      const month = months[Math.min(2, Math.floor(i / 10))];
      const day = month === "2026-11" ? 1 + Math.floor(rnd() * 6) : 1 + Math.floor(rnd() * 28);
      const outcome = type === "training" ? null : rnd() < 0.68 ? "victory" : "defeat";
      const pts =
        type === "training" ? P.training : type === "practice_raid" ? P.practice_raid : outcome === "victory" ? P.raid_victory : P.raid_defeat;
      const host = pick(hosts);
      const att = new Set([host.id]);
      const n = 4 + Math.floor(rnd() * 12);
      while (att.size < n) att.add(pick(active).id);
      events.push({
        id: uid(),
        title: pick(titles[type]),
        type,
        outcome,
        event_date: `${month}-${String(day).padStart(2, "0")}`,
        host_id: host.id,
        points_each: pts,
        proof_url: "",
        summary: "",
        attendees: Array.from(att),
        created_at: new Date().toISOString(),
      });
    }
    const leadership = [
      { section: "Group Command", position: "Group Commander", m: 0 },
      { section: "Group Command", position: "Deputy Commander", m: 1 },
      { section: "Group Command", position: "Group Sergeant Major", m: 2 },
      { section: "White Horse Airborne Detachment", position: "Detachment Commander", m: 3 },
      { section: "White Horse Airborne Detachment", position: "Detachment Sergeant", m: 5 },
      { section: "Fierce Tiger Airborne Detachment", position: "Detachment Commander", m: 4 },
      { section: "Fierce Tiger Airborne Detachment", position: "Detachment Sergeant", m: 6 },
    ].map((l, i) => ({
      id: uid(),
      name: members[l.m].username,
      position: l.position,
      rank: members[l.m].rank,
      section: l.section,
      detachment: members[l.m].detachment,
      photo_url: "",
      bio: "",
      sort_order: i + 1,
      member_id: members[l.m].id,
    }));
    return { members, events, leadership, settings: mergeSettings({}) };
  }

  /* -------------------------------------------------------- demo backend */
  const KEY = "1asfg_db_v1";
  let memStore = null;
  function readStore() {
    if (memStore) return memStore;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) memStore = JSON.parse(raw);
    } catch (e) { /* storage unavailable */ }
    if (!memStore) { memStore = seed(); writeStore(); }
    return memStore;
  }
  function writeStore() {
    try { localStorage.setItem(KEY, JSON.stringify(memStore)); }
    catch (e) { console.warn("Could not persist demo data:", e); }
  }
  /* demo-mode media store: audio files are too big for localStorage, so they live in IndexedDB */
  const IDB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error("This browser can't store files offline."));
        const r = indexedDB.open("1asfg_media", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("files");
        r.onsuccess = () => res((this.db = r.result));
        r.onerror = () => rej(r.error || new Error("Could not open browser storage."));
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => { const t = db.transaction("files", mode); const st = t.objectStore("files"); const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("Storage quota exceeded.")); });
    },
    put(id, blob) { return this.tx("readwrite", (st) => st.put(blob, id)); },
    get(id) { return this.tx("readonly", (st) => st.get(id)); },
    del(id) { return this.tx("readwrite", (st) => st.delete(id)); },
  };
  const extOf = (file) => ((file.name || "").match(/\.([a-z0-9]{2,4})$/i) || [, (file.type.split("/")[1] || "mp3")])[1].toLowerCase();

  let demoAuthed = false;
  try { demoAuthed = sessionStorage.getItem("1asfg_admin") === "1"; } catch (e) {}

  const Demo = {
    async loadAll() {
      const s = readStore();
      return { members: clone(s.members), events: clone(s.events), leadership: clone(s.leadership), settings: mergeSettings(s.settings) };
    },
    async saveMember(m) {
      const s = readStore();
      if (s.members.some((x) => x.username.toLowerCase() === m.username.toLowerCase() && x.id !== m.id))
        throw new Error(`"${m.username}" is already on the roster.`);
      if (!m.id) { m.id = uid(); m.created_at = new Date().toISOString(); s.members.push(m); }
      else { const i = s.members.findIndex((x) => x.id === m.id); if (i < 0) s.members.push(m); else s.members[i] = Object.assign(s.members[i], m); }
      writeStore(); return m;
    },
    async bulkAddMembers(rows) {
      const s = readStore();
      const have = new Set(s.members.map((m) => m.username.toLowerCase()));
      let added = 0;
      rows.forEach((r) => {
        if (have.has(r.username.toLowerCase())) return;
        have.add(r.username.toLowerCase());
        s.members.push(Object.assign({ id: uid(), created_at: new Date().toISOString(), status: "active", notes: "" }, r));
        added++;
      });
      writeStore(); return added;
    },
    async deleteMember(id) {
      const s = readStore();
      s.members = s.members.filter((m) => m.id !== id);
      s.events.forEach((e) => { e.attendees = e.attendees.filter((a) => a !== id); if (e.host_id === id) e.host_id = null; });
      s.leadership.forEach((l) => { if (l.member_id === id) l.member_id = null; });
      writeStore();
    },
    async saveEvent(ev) {
      const s = readStore();
      if (!ev.id) { ev.id = uid(); ev.created_at = new Date().toISOString(); s.events.push(ev); }
      else { const i = s.events.findIndex((x) => x.id === ev.id); if (i < 0) s.events.push(ev); else s.events[i] = ev; }
      writeStore(); return ev;
    },
    async deleteEvent(id) { const s = readStore(); s.events = s.events.filter((e) => e.id !== id); writeStore(); },
    async saveLeader(l) {
      const s = readStore();
      if (!l.id) { l.id = uid(); s.leadership.push(l); }
      else { const i = s.leadership.findIndex((x) => x.id === l.id); if (i < 0) s.leadership.push(l); else s.leadership[i] = l; }
      writeStore(); return l;
    },
    async deleteLeader(id) { const s = readStore(); s.leadership = s.leadership.filter((l) => l.id !== id); writeStore(); },
    async saveSettings(obj) { const s = readStore(); s.settings = obj; writeStore(); },
    async uploadPhoto(blob) {
      return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    },
    async uploadMedia(file) {
      const id = "track-" + uid();
      await IDB.put(id, file);
      return { src: "idb:" + id, path: id };
    },
    async deleteMedia(path) { if (path) await IDB.del(path).catch(() => {}); },
    async importAll(data) {
      memStore = { members: data.members || [], events: data.events || [], leadership: data.leadership || [], settings: mergeSettings(data.settings) };
      writeStore();
    },
    async resetDemo() { memStore = seed(); writeStore(); },
    async signIn(_email, pass) {
      if (pass !== (CFG.DEMO_ADMIN_PASSCODE || "airborne")) throw new Error("Passcode rejected.");
      demoAuthed = true; try { sessionStorage.setItem("1asfg_admin", "1"); } catch (e) {}
    },
    async signOut() { demoAuthed = false; try { sessionStorage.removeItem("1asfg_admin"); } catch (e) {} },
    async adminStatus() { return { signedIn: demoAuthed, isAdmin: demoAuthed, email: demoAuthed ? "demo" : null }; },
  };

  /* ---------------------------------------------------- supabase backend */
  let sb = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = src; s.onload = res;
      s.onerror = () => rej(new Error("Could not load the Supabase library."));
      document.head.appendChild(s);
    });
  }
  async function client() {
    if (sb) return sb;
    if (!window.supabase) await loadScript(SUPABASE_CDN);
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    return sb;
  }
  const chk = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  async function fetchAll(table) {
    const c = await client(); const out = []; const step = 1000;
    for (let from = 0; ; from += step) {
      const rows = chk(await c.from(table).select("*").range(from, from + step - 1));
      out.push(...rows); if (rows.length < step) break;
    }
    return out;
  }
  const nullify = (v) => (v === "" || v === undefined ? null : v);

  const Live = {
    async loadAll() {
      const [members, events, att, leadership, settingsRows] = await Promise.all([
        fetchAll("members"), fetchAll("events"), fetchAll("event_attendees"), fetchAll("leadership"), fetchAll("settings"),
      ]);
      const byEv = {};
      att.forEach((a) => (byEv[a.event_id] = byEv[a.event_id] || []).push(a.member_id));
      events.forEach((e) => (e.attendees = byEv[e.id] || []));
      const site = settingsRows.find((r) => r.key === "site");
      return { members, events, leadership, settings: mergeSettings(site && site.value) };
    },
    async saveMember(m) {
      const c = await client();
      const row = { id: m.id || uid(), username: m.username, rank: m.rank, detachment: m.detachment, status: m.status || "active", joined_on: nullify(m.joined_on), notes: m.notes || "" };
      const res = await c.from("members").upsert(row).select().single();
      if (res.error && /duplicate|unique/i.test(res.error.message)) throw new Error(`"${m.username}" is already on the roster.`);
      return chk(res);
    },
    async bulkAddMembers(rows) {
      const c = await client();
      const data = chk(await c.from("members").upsert(
        rows.map((r) => ({ id: uid(), status: "active", notes: "", ...r, joined_on: nullify(r.joined_on) })),
        { onConflict: "username", ignoreDuplicates: true }).select());
      return (data || []).length;
    },
    async deleteMember(id) { const c = await client(); chk(await c.from("members").delete().eq("id", id)); },
    async saveEvent(ev) {
      const c = await client();
      const id = ev.id || uid();
      const row = { id, title: ev.title, type: ev.type, outcome: nullify(ev.outcome), event_date: ev.event_date, host_id: nullify(ev.host_id), points_each: ev.points_each, proof_url: ev.proof_url || "", summary: ev.summary || "" };
      chk(await c.from("events").upsert(row).select().single());
      chk(await c.from("event_attendees").delete().eq("event_id", id));
      if (ev.attendees.length) chk(await c.from("event_attendees").insert(ev.attendees.map((m) => ({ event_id: id, member_id: m }))));
      return { ...row, attendees: ev.attendees };
    },
    async deleteEvent(id) { const c = await client(); chk(await c.from("events").delete().eq("id", id)); },
    async saveLeader(l) {
      const c = await client();
      const row = { id: l.id || uid(), name: l.name, position: l.position, rank: l.rank || "", section: l.section || "", detachment: l.detachment || "", photo_url: l.photo_url || "", bio: l.bio || "", sort_order: l.sort_order || 0, member_id: nullify(l.member_id) };
      return chk(await c.from("leadership").upsert(row).select().single());
    },
    async deleteLeader(id) { const c = await client(); chk(await c.from("leadership").delete().eq("id", id)); },
    async saveSettings(obj) { const c = await client(); chk(await c.from("settings").upsert({ key: "site", value: obj })); },
    async uploadPhoto(blob) {
      const c = await client();
      const path = `leadership/${uid()}.jpg`;
      chk(await c.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false }));
      return c.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
    },
    async uploadMedia(file) {
      const c = await client();
      const path = `music/${uid()}.${extOf(file)}`;
      chk(await c.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false, cacheControl: "31536000" }));
      return { src: c.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl, path };
    },
    async deleteMedia(path) { if (!path) return; const c = await client(); await c.storage.from(PHOTO_BUCKET).remove([path]); },
    async importAll(data) {
      const c = await client();
      const strip = (o, keys) => { const x = { ...o }; keys.forEach((k) => delete x[k]); return x; };
      if (data.members && data.members.length) chk(await c.from("members").upsert(data.members.map((m) => strip({ ...m, joined_on: nullify(m.joined_on) }, ["created_at"]))));
      if (data.events && data.events.length) {
        chk(await c.from("events").upsert(data.events.map((e) => strip({ ...e, host_id: nullify(e.host_id), outcome: nullify(e.outcome) }, ["attendees", "created_at"]))));
        const rows = [];
        data.events.forEach((e) => (e.attendees || []).forEach((m) => rows.push({ event_id: e.id, member_id: m })));
        for (let i = 0; i < rows.length; i += 500) chk(await c.from("event_attendees").upsert(rows.slice(i, i + 500), { ignoreDuplicates: true }));
      }
      if (data.leadership && data.leadership.length) chk(await c.from("leadership").upsert(data.leadership.map((l) => ({ ...l, member_id: nullify(l.member_id) }))));
      if (data.settings) await this.saveSettings(mergeSettings(data.settings));
    },
    async resetDemo() { throw new Error("Reset is only available in demo mode."); },
    async signIn(email, pass) {
      const c = await client();
      const { error } = await c.auth.signInWithPassword({ email, password: pass });
      if (error) throw new Error(error.message);
    },
    async signOut() { const c = await client(); await c.auth.signOut(); },
    async adminStatus() {
      const c = await client();
      const { data } = await c.auth.getSession();
      const user = data && data.session && data.session.user;
      if (!user) return { signedIn: false, isAdmin: false, email: null };
      const row = await c.from("admins").select("user_id").eq("user_id", user.id).maybeSingle();
      return { signedIn: true, isAdmin: !!(row.data), email: user.email };
    },
  };

  // resolve a stored track reference ("idb:<id>" in demo mode, otherwise a URL) to a Blob
  async function mediaBlob(src) {
    src = String(src || "");
    if (src.startsWith("idb:")) { const b = await IDB.get(src.slice(4)); if (!b) throw new Error("Track not found in this browser."); return b; }
    const r = await fetch(src); if (!r.ok) throw new Error("HTTP " + r.status); return await r.blob();
  }

  window.DB = Object.assign({ LIVE, uid, DEFAULT_SETTINGS, mergeSettings, mediaBlob }, LIVE ? Live : Demo);
})();
