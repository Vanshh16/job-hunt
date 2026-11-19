// Job Hunt Copilot — content script (runs in every frame).
// Scans form fields, fills them with values from the dashboard, attaches resumes, extracts job text.
(() => {
  if (window.__jobHuntLoaded) return;
  window.__jobHuntLoaded = true;

  const GREEN = "#16a34a";
  const AMBER = "#f59e0b";
  const registry = new Map(); // localId -> descriptor
  const filledMeta = new Map(); // localId -> source
  let seq = 0;

  // ---------- utils ----------
  const clean = (s) => (s || "").replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").replace(/^\s*\*\s*/, "").trim().slice(0, 300);
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0";
  }
  // For inputs hidden behind custom UI (radio, checkbox, file), check a nearby container instead.
  const containerVisible = (el) => isVisible(el) || isVisible(el.closest("label")) || isVisible(el.parentElement) || isVisible(el.parentElement?.parentElement);

  function textOf(el, exclude) {
    if (!el) return "";
    const c = el.cloneNode(true);
    c.querySelectorAll("input,select,textarea,script,style,button,svg,[aria-hidden=true]").forEach((n) => n.remove());
    if (exclude) c.querySelectorAll(exclude).forEach((n) => n.remove());
    return clean(c.innerText || c.textContent || "");
  }

  function byIds(ids) {
    return clean(
      (ids || "")
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => n.innerText || n.textContent)
        .join(" "),
    );
  }

  // Find the question text for an element or group container.
  function labelFor(el) {
    const lb = el.getAttribute?.("aria-labelledby");
    if (lb) {
      const t = byIds(lb);
      if (t) return t;
    }
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map((l) => textOf(l)).filter(Boolean).join(" ");
      if (t) return t;
    }
    const aria = el.getAttribute?.("aria-label");
    if (aria && aria.length > 1) return clean(aria);
    // Google Forms
    const gItem = el.closest?.('[role="listitem"]');
    if (gItem) {
      const h = gItem.querySelector('[role="heading"]');
      if (h) return textOf(h);
    }
    const fs = el.closest?.("fieldset");
    if (fs) {
      const lg = fs.querySelector("legend");
      if (lg && textOf(lg)) return textOf(lg);
    }
    // Walk up a few levels looking for label-ish text preceding the element.
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      let sib = node.previousElementSibling;
      while (sib) {
        const t = textOf(sib);
        if (t && t.length < 300) return t;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
      if (node) {
        const lab = node.querySelector(':scope > label, :scope > .label, :scope > [class*="label" i], :scope > [class*="question" i]');
        if (lab && !lab.contains(el) && textOf(lab)) return textOf(lab);
      }
    }
    return clean(el.getAttribute?.("placeholder") || el.getAttribute?.("name")?.replace(/[_\-\[\]]+/g, " ") || el.id?.replace(/[_\-]+/g, " ") || "");
  }

  function optionLabel(input) {
    if (input.labels && input.labels.length) return textOf(input.labels[0]) || input.value;
    const wrap = input.closest("label");
    if (wrap) return textOf(wrap) || input.value;
    const aria = input.getAttribute("aria-label");
    if (aria) return clean(aria);
    const next = input.nextElementSibling;
    if (next && textOf(next)) return textOf(next);
    return input.value;
  }

  function commonAncestor(nodes) {
    let a = nodes[0]?.parentElement;
    while (a && !nodes.every((n) => a.contains(n))) a = a.parentElement;
    return a;
  }

  function groupLabel(container, optionTexts) {
    if (!container) return "";
    const lb = container.getAttribute("aria-labelledby");
    if (lb && byIds(lb)) return byIds(lb);
    if (container.getAttribute("aria-label")) return clean(container.getAttribute("aria-label"));
    const gItem = container.closest('[role="listitem"]');
    if (gItem?.querySelector('[role="heading"]')) return textOf(gItem.querySelector('[role="heading"]'));
    const fs = container.closest("fieldset");
    if (fs?.querySelector("legend")) return textOf(fs.querySelector("legend"));
    const opts = new Set(optionTexts.map(norm));
    let node = container;
    for (let i = 0; i < 4 && node; i++) {
      const cand = node.querySelector('legend, [role="heading"], label:not(:has(input)), [class*="label" i]:not(:has(input)), [class*="question" i], h1, h2, h3, h4, h5, h6, p');
      if (cand) {
        const t = textOf(cand);
        if (t && !opts.has(norm(t))) return t;
      }
      let sib = node.previousElementSibling;
      if (sib && textOf(sib) && !opts.has(norm(textOf(sib)))) return textOf(sib);
      node = node.parentElement;
    }
    return "";
  }

  const CONSENT = /\b(agree|consent|terms|privacy|acknowledge|certify|declare|confirm that|gdpr|policy)\b/i;

  // ---------- scan ----------
  function scan() {
    registry.clear();
    const fields = [];
    const add = (desc, field) => {
      const id = String(++seq);
      registry.set(id, desc);
      fields.push({ id, ...field });
    };

    // Native text-like inputs, textareas, selects
    const nativeSel =
      'input:not([type]), input[type=text], input[type=email], input[type=tel], input[type=url], input[type=number], input[type=date], input[type=month], textarea, select';
    for (const el of document.querySelectorAll(nativeSel)) {
      if (el.disabled || el.readOnly || !isVisible(el)) continue;
      if (el.getAttribute("role") === "combobox" || el.closest('[class*="select__control"]')) {
        add({ kind: "combobox", el }, { label: labelFor(el), type: "combobox", required: el.required || el.getAttribute("aria-required") === "true" });
        continue;
      }
      if (el.tagName === "SELECT") {
        const options = [...el.options].map((o) => clean(o.text)).filter((t) => t && !/^(select|choose|--|please)/i.test(t));
        add({ kind: "select", el }, { label: labelFor(el), type: "select", options, required: el.required });
        continue;
      }
      const type = el.tagName === "TEXTAREA" ? "textarea" : (el.getAttribute("type") || "text").toLowerCase();
      add({ kind: "text", el }, { label: labelFor(el), type, required: el.required || el.getAttribute("aria-required") === "true", maxLength: el.maxLength > 0 ? el.maxLength : undefined });
    }

    // Native radio groups
    const radioGroups = new Map();
    for (const el of document.querySelectorAll("input[type=radio]")) {
      if (el.disabled || !containerVisible(el)) continue;
      const key = el.name || `__noname_${commonAncestor([el])?.className}`;
      if (!radioGroups.has(key)) radioGroups.set(key, []);
      radioGroups.get(key).push(el);
    }
    for (const els of radioGroups.values()) {
      const options = els.map(optionLabel);
      const container = els.length > 1 ? commonAncestor(els) : els[0].closest("fieldset, [role=radiogroup], div");
      add({ kind: "radio", els, options }, { label: groupLabel(container, options) || labelFor(els[0]), type: "radio", options });
    }

    // Native checkboxes (group by name; single consent boxes are left to the user)
    const cbGroups = new Map();
    for (const el of document.querySelectorAll("input[type=checkbox]")) {
      if (el.disabled || !containerVisible(el)) continue;
      const key = el.name || `__cb_${++seq}`;
      if (!cbGroups.has(key)) cbGroups.set(key, []);
      cbGroups.get(key).push(el);
    }
    for (const els of cbGroups.values()) {
      const options = els.map(optionLabel);
      if (els.length === 1) {
        const label = options[0] || labelFor(els[0]);
        if (CONSENT.test(label)) continue;
        add({ kind: "checkbox-single", els }, { label, type: "radio", options: ["Yes", "No"] });
      } else {
        add({ kind: "checkbox", els, options }, { label: groupLabel(commonAncestor(els), options), type: "checkbox", options });
      }
    }

    // ARIA radio groups (Google Forms and many React UIs)
    for (const g of document.querySelectorAll('[role="radiogroup"]')) {
      if (!isVisible(g) || g.querySelector("input[type=radio]")) continue;
      const els = [...g.querySelectorAll('[role="radio"]')];
      if (!els.length) continue;
      const options = els.map((r) => clean(r.getAttribute("data-value") || r.getAttribute("aria-label") || textOf(r)));
      add({ kind: "aria-radio", els, options }, { label: groupLabel(g, options), type: "radio", options });
    }

    // ARIA checkbox groups (Google Forms: grouped per question listitem)
    const ariaCb = new Map();
    for (const c of document.querySelectorAll('[role="checkbox"]')) {
      if (c.tagName === "INPUT" || !isVisible(c)) continue;
      const parent = c.closest('[role="listitem"], [role="group"], fieldset') || c.parentElement;
      if (!ariaCb.has(parent)) ariaCb.set(parent, []);
      ariaCb.get(parent).push(c);
    }
    for (const [parent, els] of ariaCb) {
      const options = els.map((c) => clean(c.getAttribute("data-answer-value") || c.getAttribute("aria-label") || textOf(c)));
      if (els.length === 1 && CONSENT.test(options[0])) continue;
      add({ kind: "aria-checkbox", els, options }, { label: groupLabel(parent, options), type: "checkbox", options });
    }

    // ARIA listbox dropdowns (Google Forms)
    for (const lb of document.querySelectorAll('[role="listbox"]')) {
      if (!isVisible(lb) || lb.closest("select")) continue;
      const opts = [...lb.querySelectorAll('[role="option"]')].map((o) => clean(o.getAttribute("data-value") || textOf(o))).filter((t) => t && !/^(choose|select)$/i.test(t));
      if (!opts.length) continue;
      add({ kind: "aria-listbox", el: lb, options: opts }, { label: groupLabel(lb, opts) || labelFor(lb), type: "select", options: opts });
    }

    // File inputs (resume)
    for (const el of document.querySelectorAll("input[type=file]")) {
      if (el.disabled) continue;
      add({ kind: "file", el }, { label: labelFor(el) || "file", type: "file", accept: el.accept || "" });
    }

    return fields.filter((f) => f.type === "file" || f.label);
  }

  // ---------- fill ----------
  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus?.();
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function bestMatch(value, options) {
    const v = norm(Array.isArray(value) ? value[0] : value);
    if (!v) return -1;
    const n = options.map(norm);
    let i = n.findIndex((o) => o === v);
    if (i >= 0) return i;
    if (/^(yes|y|true)\b/.test(v)) { i = n.findIndex((o) => /^yes\b/.test(o)); if (i >= 0) return i; }
    if (/^(no|n|false)\b/.test(v)) { i = n.findIndex((o) => /^no\b/.test(o)); if (i >= 0) return i; }
    i = n.findIndex((o) => o && (o.includes(v) || v.includes(o)));
    return i;
  }

  function mark(el, source) {
    if (!el?.style) return;
    el.style.outline = `2px solid ${source === "ai" ? AMBER : GREEN}`;
    el.style.outlineOffset = "2px";
    el.title = source === "ai" ? "Drafted by AI — please review" : "Filled by Job Hunt";
  }

  function toDateValue(v, type) {
    const d = new Date(v);
    if (isNaN(d)) return v;
    const iso = d.toISOString().slice(0, 10);
    return type === "month" ? iso.slice(0, 7) : iso;
  }

  async function fillCombobox(el, value) {
    const v = Array.isArray(value) ? value[0] : value;
    el.focus();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    setNative(el, v);
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    await sleep(500);
    const opts = [...document.querySelectorAll('[role="option"], [class*="select__option"]')].filter(isVisible);
    const idx = bestMatch(v, opts.map((o) => textOf(o)));
    const target = opts[idx >= 0 ? idx : 0];
    if (target && (idx >= 0 || opts.length === 1)) {
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target.click();
      return true;
    }
    return false;
  }

  async function fillAriaListbox(lb, value, options) {
    const idx = bestMatch(value, options);
    if (idx < 0) return false;
    lb.click();
    await sleep(350);
    const want = norm(options[idx]);
    const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => isVisible(o) && norm(o.getAttribute("data-value") || textOf(o)) === want);
    const target = opts[opts.length - 1];
    if (!target) return false;
    target.click();
    await sleep(250);
    return true;
  }

  async function fill(values, sources) {
    let filled = 0;
    const failed = [];
    for (const [id, value] of Object.entries(values)) {
      const d = registry.get(id);
      if (!d || value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
      const source = sources[id] || "profile";
      try {
        let ok = true;
        if (d.kind === "text") {
          const t = (d.el.getAttribute("type") || "").toLowerCase();
          const v = Array.isArray(value) ? value.join(", ") : String(value);
          setNative(d.el, t === "date" || t === "month" ? toDateValue(v, t) : v);
          mark(d.el, source);
        } else if (d.kind === "select") {
          const opts = [...d.el.options];
          const idx = bestMatch(value, opts.map((o) => clean(o.text)));
          if (idx >= 0) { setNative(d.el, opts[idx].value); mark(d.el, source); } else ok = false;
        } else if (d.kind === "radio" || d.kind === "aria-radio") {
          const idx = bestMatch(value, d.options);
          if (idx >= 0) { d.els[idx].click(); mark(d.els[idx].closest("label") || d.els[idx], source); } else ok = false;
        } else if (d.kind === "checkbox" || d.kind === "aria-checkbox") {
          const want = (Array.isArray(value) ? value : String(value).split(/[,;]/)).map((x) => bestMatch(x, d.options)).filter((i) => i >= 0);
          for (const i of want) {
            const c = d.els[i];
            const checked = c.tagName === "INPUT" ? c.checked : c.getAttribute("aria-checked") === "true";
            if (!checked) c.click();
            mark(c.closest("label") || c, source);
          }
          ok = want.length > 0;
        } else if (d.kind === "checkbox-single") {
          const yes = /^(yes|true|y)/i.test(String(value));
          if (d.els[0].checked !== yes) d.els[0].click();
          mark(d.els[0].closest("label") || d.els[0], source);
        } else if (d.kind === "aria-listbox") {
          ok = await fillAriaListbox(d.el, value, d.options);
          if (ok) mark(d.el, source);
        } else if (d.kind === "combobox") {
          ok = await fillCombobox(d.el, value);
          mark(d.el, ok ? source : "ai");
        }
        if (ok) { filled++; filledMeta.set(id, source); } else failed.push(id);
      } catch (e) {
        console.warn("[JobHunt] fill failed", id, e);
        failed.push(id);
      }
    }
    return { filled, failed };
  }

  function attach(ids, name, mime, b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    let n = 0;
    for (const id of ids) {
      const d = registry.get(id);
      if (!d || d.kind !== "file") continue;
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], name, { type: mime }));
      d.el.files = dt.files;
      d.el.dispatchEvent(new Event("input", { bubbles: true }));
      d.el.dispatchEvent(new Event("change", { bubbles: true }));
      mark(d.el.closest("label, div") || d.el, "profile");
      n++;
    }
    return n;
  }

  // Current values of question-like fields (for saving to the answer bank).
  function collectAnswers() {
    const out = [];
    for (const [id, d] of registry) {
      const src = filledMeta.get(id);
      if (src === "profile") continue;
      let label;
      let value = "";
      if (d.kind === "text") {
        label = labelFor(d.el);
        value = d.el.value;
        if (d.el.tagName !== "TEXTAREA" && !src) continue; // only keep long-form answers the user wrote, or AI/bank ones
      } else if (d.kind === "select") {
        label = labelFor(d.el);
        value = d.el.selectedOptions[0]?.text || "";
        if (!src) continue;
      } else if (d.kind === "radio") {
        if (!src) continue;
        const i = d.els.findIndex((e) => e.checked);
        label = groupLabel(commonAncestor(d.els), d.options);
        value = i >= 0 ? d.options[i] : "";
      } else continue;
      if (label && label.length >= 12 && value && value.trim()) out.push({ question: label, answer: value.trim() });
    }
    return out;
  }

  // ---------- job page extraction ----------
  function pageInfo() {
    const sels = [
      ".jobs-search__job-details--container", ".job-view-layout", ".jobs-details", "#job-details", // LinkedIn
      "#content .job__description", ".job__description", "#app_body", "#content", // Greenhouse
      ".posting-page", ".section-wrapper.page-full-width", // Lever
      '[data-automation-id="jobPostingDescription"]', // Workday
      ".ashby-job-posting-right-pane", '[class*="jobPosting" i]', '[class*="job-description" i]', '[class*="jobDescription" i]',
      "main", "article",
    ];
    let text = "";
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && (el.innerText || "").trim().length > 300) { text = el.innerText; break; }
    }
    if (!text) text = document.body?.innerText || "";
    // LinkedIn: include the top card title/company
    const top = document.querySelector(".job-details-jobs-unified-top-card__container--two-pane, .jobs-unified-top-card, .job-details-jobs-unified-top-card__job-title");
    if (top && !text.includes(top.innerText.slice(0, 40))) text = top.innerText + "\n\n" + text;
    return { url: location.href, title: document.title, text: text.replace(/\n{3,}/g, "\n\n").slice(0, 15000), isTop: window === window.top };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    (async () => {
      switch (msg.type) {
        case "jh:scan": return { fields: scan(), url: location.href, isTop: window === window.top };
        case "jh:fill": return fill(msg.values, msg.sources || {});
        case "jh:attach": return { attached: attach(msg.ids, msg.name, msg.mime, msg.b64) };
        case "jh:collect": return { items: collectAnswers() };
        case "jh:pageInfo": return pageInfo();
        case "jh:ping": return { ok: true };
        default: return null;
      }
    })().then(reply, (e) => reply({ error: String(e?.message || e) }));
    return true;
  });
})();
