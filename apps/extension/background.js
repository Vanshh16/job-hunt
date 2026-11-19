// Job Hunt Copilot — background service worker.
// Owns all network calls to the dashboard (no CORS issues) and orchestrates autofill across frames.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.create({ id: "jh-import", title: "Send selection to Job Hunt", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "jh-autofill", title: "Autofill this application", contexts: ["page", "editable"] });
});

// ---------- API ----------
async function config() {
  const { baseUrl = "", token = "" } = await chrome.storage.sync.get(["baseUrl", "token"]);
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

async function api(path, { method = "GET", body, raw = false } = {}) {
  const { baseUrl, token } = await config();
  if (!baseUrl || !token) throw new Error("Not connected. Open Settings in the side panel and enter your dashboard URL and API token.");
  const res = await fetch(baseUrl + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return raw ? res : res.json();
}

// ---------- frames ----------
async function ensureInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "jh:ping" }, { frameId: 0 });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content.js"] }).catch(() => {});
  }
}

async function frameIds(tabId) {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
  return frames.filter((f) => !f.errorOccurred && /^https?:/.test(f.url)).map((f) => f.frameId);
}

async function sendFrame(tabId, frameId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg, { frameId });
  } catch {
    return null;
  }
}

async function scanAll(tabId) {
  await ensureInjected(tabId);
  const ids = await frameIds(tabId);
  const results = await Promise.all(ids.map((fid) => sendFrame(tabId, fid, { type: "jh:scan" }).then((r) => ({ fid, r }))));
  const fields = [];
  for (const { fid, r } of results) for (const f of r?.fields || []) fields.push({ ...f, id: `${fid}:${f.id}` });
  return fields;
}

async function pageInfo(tabId) {
  await ensureInjected(tabId);
  return (await sendFrame(tabId, 0, { type: "jh:pageInfo" })) || { url: "", title: "", text: "" };
}

function splitByFrame(obj) {
  const out = new Map();
  for (const [k, v] of Object.entries(obj || {})) {
    const [fid, local] = k.split(":");
    if (!out.has(+fid)) out.set(+fid, {});
    out.get(+fid)[local] = v;
  }
  return out;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const RESUME_RX = /resume|cv|curriculum|bio ?data|upload/i;
const NOT_RESUME_RX = /cover|transcript|photo|picture|portfolio|certificate|id proof|marksheet/i;

async function autofill(tabId, { resumeId, useAi = true, jobId } = {}) {
  const [fields, info] = await Promise.all([scanAll(tabId), pageInfo(tabId)]);
  const fileFields = fields.filter((f) => f.type === "file");
  const fillable = fields.filter((f) => f.type !== "file");
  if (!fillable.length && !fileFields.length) throw new Error("No form fields found on this page. Open the application form first (click Apply / Easy Apply).");

  const res = fillable.length
    ? await api("/api/ext/fill", { method: "POST", body: { fields: fillable, url: info.url, pageText: info.text.slice(0, 6000), useAi, resumeId, jobId } })
    : { values: {}, sources: {}, resumeId };

  let filled = 0;
  const failed = [];
  for (const [fid, values] of splitByFrame(res.values)) {
    const sources = splitByFrame(res.sources).get(fid) || {};
    const r = await sendFrame(tabId, fid, { type: "jh:fill", values, sources });
    filled += r?.filled || 0;
    for (const id of r?.failed || []) failed.push(`${fid}:${id}`);
  }

  // Attach resume
  let resumeAttached = false;
  const rid = resumeId || res.resumeId;
  const targets = fileFields.filter((f) => !NOT_RESUME_RX.test(f.label) && (RESUME_RX.test(f.label) || fileFields.length === 1));
  if (rid && targets.length) {
    const fileRes = await api(`/api/resumes/${rid}/file`, { raw: true });
    const name = decodeURIComponent(fileRes.headers.get("x-file-name") || "resume.pdf");
    const mime = fileRes.headers.get("content-type") || "application/pdf";
    const b64 = toBase64(await fileRes.arrayBuffer());
    for (const [fid, ids] of splitByFrame(Object.fromEntries(targets.map((t) => [t.id, true])))) {
      const r = await sendFrame(tabId, fid, { type: "jh:attach", ids: Object.keys(ids), name, mime, b64 });
      if (r?.attached) resumeAttached = true;
    }
  }

  const src = Object.values(res.sources || {});
  const unfilled = fillable.filter((f) => !(f.id in (res.values || {})) || failed.includes(f.id));
  return {
    total: fillable.length,
    filled,
    fromProfile: src.filter((s) => s === "profile").length,
    fromBank: src.filter((s) => s === "bank").length,
    fromAi: src.filter((s) => s === "ai").length,
    resumeAttached,
    resumeId: rid,
    jobId: res.jobId,
    unfilled: unfilled.filter((f) => f.required).map((f) => f.label).slice(0, 12),
  };
}

async function collectAnswers(tabId) {
  const ids = await frameIds(tabId);
  const items = [];
  for (const fid of ids) {
    const r = await sendFrame(tabId, fid, { type: "jh:collect" });
    items.push(...(r?.items || []));
  }
  return items;
}

// ---------- messages from side panel ----------
const handlers = {
  config: async () => config(),
  saveConfig: async ({ baseUrl, token }) => { await chrome.storage.sync.set({ baseUrl: baseUrl.trim(), token: token.trim() }); return { ok: true }; },
  me: async () => api("/api/ext/me"),
  pageInfo: async ({ tabId }) => pageInfo(tabId),
  analyze: async ({ tabId, force }) => {
    const info = await pageInfo(tabId);
    return api("/api/ext/analyze", { method: "POST", body: { url: info.url, pageTitle: info.title, pageText: info.text, force } });
  },
  autofill: async ({ tabId, ...opts }) => autofill(tabId, opts),
  saveAnswers: async ({ tabId }) => {
    const items = await collectAnswers(tabId);
    if (!items.length) return { saved: 0 };
    return api("/api/ext/answers", { method: "POST", body: { items } });
  },
  setStatus: async ({ tabId, jobId, status }) => {
    const info = jobId ? {} : await pageInfo(tabId);
    return api("/api/ext/status", { method: "POST", body: { jobId, status, url: info.url, title: info.title } });
  },
  generate: async ({ jobId, kind, extra }) => api("/api/ext/generate", { method: "POST", body: { jobId, kind, extra } }),
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.tab) return false; // content-script messages are handled in-page
  const h = handlers[msg?.type];
  if (!h) return false;
  h(msg).then((data) => reply({ ok: true, data }), (e) => reply({ ok: false, error: String(e?.message || e) }));
  return true;
});

// ---------- shortcut + context menu ----------
async function runAutofillFromShortcut(tab) {
  if (!tab?.id) return;
  chrome.action.setBadgeText({ tabId: tab.id, text: "…" });
  try {
    const r = await autofill(tab.id, {});
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#16a34a" });
    chrome.action.setBadgeText({ tabId: tab.id, text: String(r.filled) });
    chrome.runtime.sendMessage({ type: "jh:autofilled", tabId: tab.id, result: r }).catch(() => {});
  } catch (e) {
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#dc2626" });
    chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    notify("Autofill failed", String(e?.message || e));
  }
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/128.png", title, message: message.slice(0, 250) });
}

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "autofill") return;
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  runAutofillFromShortcut(tab);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "jh-autofill") return runAutofillFromShortcut(tab);
  if (info.menuItemId === "jh-import") {
    try {
      const r = await api("/api/ext/import", { method: "POST", body: { text: info.selectionText, url: tab?.url } });
      const jobs = r.jobs || [];
      notify(jobs.length ? `Imported ${jobs.length} job(s)` : "No jobs found", jobs.map((j) => `${j.title} @ ${j.company} — ${j.score ?? "?"}/100`).join("\n") || "Couldn't find a job opening in that text.");
    } catch (e) {
      notify("Import failed", String(e?.message || e));
    }
  }
});
