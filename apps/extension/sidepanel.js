const $ = (id) => document.getElementById(id);
const state = { tabId: null, url: "", job: null, resumes: [], baseUrl: "" };

function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      res?.ok ? resolve(res.data) : reject(new Error(res?.error || "Unknown error"));
    });
  });
}

function showError(msg) {
  $("error").textContent = msg || "";
  $("error").classList.toggle("hidden", !msg);
}

async function busy(btn, label, fn) {
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
  showError("");
  try {
    return await fn();
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const scoreColor = (s) => (s >= 75 ? "#16a34a" : s >= 55 ? "#f59e0b" : "#9ca3af");

// ---------- tab tracking ----------
async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const changed = tab.url !== state.url;
  state.tabId = tab.id;
  state.url = tab.url || "";
  $("page").textContent = tab.title || tab.url;
  if (changed) {
    state.job = null;
    renderJob();
    $("fill-result").textContent = "";
    $("gen-out").classList.add("hidden");
    $("copy").classList.add("hidden");
  }
}
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((id, info) => id === state.tabId && info.status === "complete" && refreshTab());

// ---------- connection ----------
async function connect() {
  const cfg = await send("config");
  state.baseUrl = cfg.baseUrl;
  $("baseUrl").value = cfg.baseUrl || "";
  $("token").value = cfg.token || "";
  $("open-dash").href = cfg.baseUrl || "#";
  if (!cfg.baseUrl || !cfg.token) return showSetup(true);
  try {
    const me = await send("me");
    state.resumes = me.resumes || [];
    $("who").textContent = me.name ? `Signed in as ${me.name}` : "Connected";
    renderResumes();
    showSetup(false);
  } catch (e) {
    $("who").textContent = "Not connected";
    showError(e.message);
    showSetup(true);
  }
}

function showSetup(on) {
  $("setup").classList.toggle("hidden", !on);
  $("main").classList.toggle("hidden", on && !state.resumes.length && !state.baseUrl);
}

function renderResumes(selected) {
  const sel = $("resume");
  const best = selected || state.job?.bestResumeId || state.resumes.find((r) => r.isDefault)?.id;
  sel.innerHTML = state.resumes.length
    ? state.resumes.map((r) => `<option value="${r.id}" ${r.id === best ? "selected" : ""}>${esc(r.label)}${r.id === state.job?.bestResumeId ? " ★ recommended" : ""}</option>`).join("")
    : `<option value="">No resumes uploaded</option>`;
}

function renderJob() {
  const j = state.job;
  if (!j) {
    $("job").innerHTML = "Open a job posting and click Analyze to get a fit score and the best resume.";
    $("job").className = "muted small";
    return;
  }
  const a = j.analysis || {};
  const best = state.resumes.find((r) => r.id === j.bestResumeId);
  $("job").className = "small";
  $("job").innerHTML = `
    <div style="display:flex;gap:8px;align-items:flex-start">
      <span class="score" style="background:${scoreColor(j.matchScore ?? 0)}">${j.matchScore ?? "?"}</span>
      <div><b>${esc(j.title)}</b><br><span class="muted">${esc(j.company)}${j.location ? " · " + esc(j.location) : ""}</span></div>
    </div>
    <p style="margin:8px 0 0">${esc(j.matchSummary || "")}</p>
    ${best ? `<div class="advice">📄 <b>Use: ${esc(best.label)}</b>${a.resumeAdvice ? "<br>" + esc(a.resumeAdvice) : ""}</div>` : ""}
    ${(a.matchedSkills || []).length ? `<div style="margin-top:6px">${a.matchedSkills.slice(0, 10).map((s) => `<span class="tag ok">${esc(s)}</span>`).join("")}</div>` : ""}
    ${(a.missingSkills || []).length ? `<div>${a.missingSkills.slice(0, 8).map((s) => `<span class="tag miss">${esc(s)}</span>`).join("")}</div>` : ""}
    <div style="margin-top:6px"><a class="link" target="_blank" href="${state.baseUrl}/jobs/${j.id}">Open in dashboard ↗</a></div>`;
  renderResumes(j.bestResumeId);
}

function renderFill(r) {
  const parts = [
    `<span class="res-ok">✔ Filled ${r.filled}/${r.total} fields</span>`,
    `<span class="muted">(${r.fromProfile} profile · ${r.fromBank} saved · ${r.fromAi} AI)</span>`,
    r.resumeAttached ? `<br><span class="res-ok">📎 Resume attached</span>` : "",
    r.unfilled?.length ? `<br><span class="res-warn">Needs you: ${r.unfilled.map(esc).join(", ")}</span>` : "",
  ];
  $("fill-result").innerHTML = parts.join(" ");
}

// ---------- actions ----------
$("analyze").onclick = (e) =>
  busy(e.currentTarget, "Analyzing…", async () => {
    const { job } = await send("analyze", { tabId: state.tabId, force: !!state.job });
    state.job = job;
    renderJob();
  });

$("autofill").onclick = (e) =>
  busy(e.currentTarget, "Filling…", async () => {
    const r = await send("autofill", { tabId: state.tabId, resumeId: $("resume").value || undefined, useAi: $("use-ai").checked, jobId: state.job?.id });
    renderFill(r);
  });

$("save-answers").onclick = (e) =>
  busy(e.currentTarget, "Saving…", async () => {
    const r = await send("saveAnswers", { tabId: state.tabId });
    $("fill-result").innerHTML = `<span class="res-ok">Saved ${r.saved} answer(s) to your bank.</span>`;
  });

$("mark-applied").onclick = (e) =>
  busy(e.currentTarget, "Saving…", async () => {
    const { job } = await send("setStatus", { tabId: state.tabId, jobId: state.job?.id, status: "APPLIED" });
    state.job = { ...(state.job || {}), ...job };
    $("fill-result").innerHTML = `<span class="res-ok">✔ Logged as applied — follow-up reminder set.</span>`;
  });

document.querySelectorAll("[data-kind]").forEach((btn) => {
  btn.onclick = () =>
    busy(btn, "Writing…", async () => {
      if (!state.job) {
        const { job } = await send("analyze", { tabId: state.tabId });
        state.job = job;
        renderJob();
      }
      const { text } = await send("generate", { jobId: state.job.id, kind: btn.dataset.kind });
      $("gen-out").value = text;
      $("gen-out").classList.remove("hidden");
      $("copy").classList.remove("hidden");
    });
});

$("copy").onclick = async () => {
  await navigator.clipboard.writeText($("gen-out").value);
  $("copy").textContent = "Copied ✓";
  setTimeout(() => ($("copy").textContent = "Copy"), 1200);
};

$("settings").onclick = () => showSetup(true);
$("cancel-config").onclick = () => showSetup(false);
$("save-config").onclick = (e) =>
  busy(e.currentTarget, "Testing…", async () => {
    await send("saveConfig", { baseUrl: $("baseUrl").value, token: $("token").value });
    await connect();
  });

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "jh:autofilled" && msg.tabId === state.tabId) renderFill(msg.result);
});

refreshTab().then(connect);
