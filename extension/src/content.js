(() => {
  if (window.__phrasebookContentStarted) return;
  window.__phrasebookContentStarted = true;

  const PROTOCOL = 1;
  const isYouTube = location.hostname === "www.youtube.com";
  const videoContext = { video: null, pausedByUs: false, pausedAt: 0 };
  const state = { config: {}, popup: null, activeWord: null, closeTimer: 0, sequence: 0, selection: null, selectionDirty: false, selectionAtPointerDown: "", lastSelectionSignature: "", ignoreClickUntil: 0, hoverWord: null, hoverFrame: 0 };
  const host = document.createElement("div");
  host.id = "phrasebook-extension-root";
  // Keep the overlay out of the player's stacking context in normal/theater view.
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;display:block!important;z-index:2147483647!important;pointer-events:none!important;isolation:isolate!important;";
  (document.documentElement || document.body).append(host);
  const shadow = host.attachShadow({ mode: "open" });

  const rootStyle = document.createElement("style");
  rootStyle.textContent = `
    :host { all: initial; color-scheme: light; }
    * { box-sizing: border-box; }
    .pbx-action { position:absolute; pointer-events:auto; padding:7px 12px; border:1px solid #bfdbfe; border-radius:8px; background:#eff6ff; color:#1d4ed8; box-shadow:0 5px 18px #0f172a22; font:600 13px/1.2 system-ui,sans-serif; cursor:pointer; }
    .pbx-card { position:absolute; z-index:1; isolation:isolate; width:min(360px,calc(100vw - 24px)); max-height:min(520px,calc(100vh - 24px)); overflow:auto; pointer-events:auto; border:1px solid #dbe3ef; border-radius:16px; background:#fff; color:#172554; text-shadow:none; box-shadow:0 18px 55px #0f172a40; font:14px/1.5 system-ui,sans-serif; }
    .pbx-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:15px 16px 10px; border-bottom:1px solid #eef2f7; }
    .pbx-term { margin:0; font-size:17px; font-weight:750; overflow-wrap:anywhere; }
    .pbx-meta { margin-top:2px; color:#64748b; font-size:12px; }
    .pbx-close { flex:none; width:30px; height:30px; border:0; border-radius:50%; background:#f1f5f9; color:#475569; font:20px/1 system-ui,sans-serif; cursor:pointer; }
    .pbx-content { padding:13px 16px; }
    .pbx-definition { margin:0; color:#0f172a; font-size:16px; font-weight:650; overflow-wrap:anywhere; }
    .pbx-example { margin:11px 0 0; padding:9px 10px; border-left:3px solid #93c5fd; background:#f8fafc; color:#475569; font-size:12px; }
    .pbx-missing { margin:10px 0 0; color:#64748b; font-size:12px; }
    .pbx-sense { width:100%; margin:0 0 10px; padding:7px 9px; border:1px solid #cbd5e1; border-radius:7px; background:white; color:#172554; font:13px system-ui,sans-serif; }
    .pbx-detail { border-top:1px solid #eef2f7; padding:12px 16px; }
    .pbx-detail h3 { margin:12px 0 4px; color:#2563eb; font-size:11px; letter-spacing:.07em; text-transform:uppercase; }
    .pbx-detail p,.pbx-detail ul { margin:4px 0; }
    .pbx-detail ul { padding-left:19px; }
    .pbx-foot { position:sticky; bottom:0; display:flex; gap:8px; justify-content:flex-end; padding:10px 14px; border-top:1px solid #eef2f7; background:#fff; }
    .pbx-btn { min-height:36px; padding:0 12px; border:1px solid #cbd5e1; border-radius:8px; background:#fff; color:#1e3a8a; font:650 13px system-ui,sans-serif; cursor:pointer; }
    .pbx-primary { border-color:#2563eb; background:#2563eb; color:#fff; }
    .pbx-btn:disabled { opacity:.55; cursor:wait; }
    .pbx-status { min-height:17px; padding:0 16px 7px; color:#475569; font-size:12px; }
    .pbx-status[data-kind=error] { color:#b91c1c; }
    @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
  `;
  shadow.append(rootStyle);

  function send(type, values = {}) {
    return chrome.runtime.sendMessage({ protocol: PROTOCOL, type, ...values });
  }

  function safeText(value) { return typeof value === "string" ? value : ""; }
  function modeLabel(mode) { return ({ "en-en": "Anh → Anh", "en-vi": "Anh → Việt", "vi-en": "Việt → Anh" })[mode] ?? "Anh → Việt"; }

  function mountPoint() {
    return document.fullscreenElement || document.documentElement;
  }

  function repositionOverlay() {
    if (state.activeWord && state.popup) {
      if (state.activeWord.anchor?.isConnected) state.activeWord.rect = state.activeWord.anchor.getBoundingClientRect();
      place(state.activeWord.rect, state.popup);
    }
    const action = shadow.querySelector(".pbx-action");
    if (action && state.selection) place(state.selection.rect, action);
  }

  document.addEventListener("fullscreenchange", () => {
    if (!host.isConnected) return;
    const target = mountPoint();
    if (host.parentElement !== target) target.append(host);
    setHoverWord(null);
    requestAnimationFrame(repositionOverlay);
  });
  window.addEventListener("resize", repositionOverlay);

  function place(rect, box) {
    const bounds = host.getBoundingClientRect();
    const width = box.offsetWidth || 340;
    const height = box.offsetHeight || 190;
    let left = rect.left - bounds.left + rect.width / 2 - width / 2;
    let top = rect.bottom - bounds.top + 12;
    left = Math.max(8, Math.min(left, bounds.width - width - 8));
    if (top + height > bounds.height - 8) top = rect.top - bounds.top - height - 12;
    top = Math.max(8, Math.min(top, bounds.height - height - 8));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  function showLookupButton(rect, selectedText, context, caption = null) {
    const existing = shadow.querySelector(".pbx-action");
    if (existing) existing.remove();
    const button = document.createElement("button");
    button.className = "pbx-action";
    button.type = "button";
    button.textContent = "Tra";
    button.setAttribute("aria-label", `Tra từ ${selectedText}`);
    // Retain the native selection until click has consumed the captured text.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      const capture = { term: selectedText, context };
      if (caption) openFromWord(caption, capture, rect);
      else void openPopup(selectedText, rect, capture);
      button.remove();
    });
    shadow.append(button);
    place(rect, button);
  }

  function contextAround(selection, maxLength = 1000) {
    const node = selection?.anchorNode?.parentElement?.closest("p,li,blockquote,article,section,div") ?? document.body;
    return safeText(node?.textContent).replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function isEditable(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.closest("input,textarea,select,[contenteditable=true],[role=textbox]"));
  }

  function selectionSignature(selection) {
    if (!selection || selection.isCollapsed || !selection.rangeCount) return "";
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return `${selection.toString()}|${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
  }

  document.addEventListener("selectionchange", () => {
    const signature = selectionSignature(window.getSelection());
    if (signature !== state.lastSelectionSignature) {
      state.lastSelectionSignature = signature;
      state.selectionDirty = true;
    }
  }, true);

  document.addEventListener("mousedown", (event) => {
    if (event.composedPath().includes(host)) return;
    state.selectionDirty = false;
    state.selectionAtPointerDown = selectionSignature(window.getSelection());
    shadow.querySelector(".pbx-action")?.remove();
  }, true);

  document.addEventListener("mouseup", (event) => {
    if (event.composedPath().includes(host)) return;
    const selection = window.getSelection();
    const text = safeText(selection?.toString()).trim();
    if (!text || text.length > 120 || isEditable(selection.anchorNode)) {
      shadow.querySelector(".pbx-action")?.remove();
      state.selectionDirty = false;
      return;
    }
    if (!state.selectionDirty && selectionSignature(selection) === state.selectionAtPointerDown && event.detail < 2) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { state.selectionDirty = false; return; }
    const caption = isYouTube ? selection.anchorNode?.parentElement?.closest(".ytp-caption-segment") : null;
    const context = caption ? captionContext() : contextAround(selection);
    state.selection = { term: text, context, rect };
    if (caption) state.ignoreClickUntil = Date.now() + 350;
    showLookupButton(rect, text, context, caption);
    state.selectionDirty = false;
  }, true);

  function originalCaption(segment) {
    const saved = segment.getAttribute("data-pbx-original");
    return saved ?? segment.textContent ?? "";
  }

  function captionContext() {
    return [...document.querySelectorAll(".ytp-caption-segment")].map(originalCaption).join(" ").replace(/\s+/g, " ").trim().slice(0, 1000);
  }

  function makeInteractive(segment, text) {
    if (segment.getAttribute("data-pbx-wrapped") === "true" && originalCaption(segment) === text &&
        (segment.querySelector(".pbx-word") || !/[\p{L}\p{M}\p{N}]/u.test(text))) return;
    segment.setAttribute("data-pbx-original", text);
    segment.setAttribute("data-pbx-wrapped", "true");
    segment.replaceChildren();
    const pieces = text.match(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}]+/gu) ?? [text];
    for (const piece of pieces) {
      if (/^[\p{L}\p{M}\p{N}]/u.test(piece)) {
        const word = document.createElement("span");
        word.className = "pbx-word";
        word.tabIndex = 0;
        word.textContent = piece;
        word.dataset.pbxWord = piece;
        word.addEventListener("pointerenter", () => setHoverWord(word));
        segment.append(word);
      } else segment.append(document.createTextNode(piece));
    }
  }

  function activateCaptions() {
    const segments = document.querySelectorAll(".ytp-caption-segment");
    for (const segment of segments) {
      if (segment.closest("#phrasebook-extension-root")) continue;
      // YouTube can reuse a segment and replace only its text between cues.
      const text = segment.textContent;
      if (text?.trim()) makeInteractive(segment, text);
    }
    if (state.hoverWord && !state.hoverWord.isConnected) setHoverWord(null);
  }

  if (isYouTube) {
    const observer = new MutationObserver(activateCaptions);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    activateCaptions();
    document.addEventListener("click", onCaptionClick, true);
    document.addEventListener("pointermove", onCaptionPointerMove, true);
    document.addEventListener("pointerout", (event) => { if (!event.relatedTarget) setHoverWord(null); }, true);
    document.addEventListener("mousedown", (event) => {
      if (event.target instanceof Element && event.target.closest(".pbx-word")) event.stopPropagation();
    }, true);
    document.addEventListener("dblclick", (event) => {
      if (!event.composedPath().includes(host) && captionWordAt(event)) {
        event.stopPropagation(); event.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target instanceof Element && event.target.matches(".pbx-word")) {
        event.preventDefault(); openFromWord(event.target);
      }
    }, true);
  }

  function captionWordAt(event) {
    if (!(event.target instanceof Element) || !event.target.closest("#movie_player") || event.target.closest(".ytp-popup")) return null;
    const direct = event.target.closest(".ytp-caption-segment .pbx-word");
    if (direct) return direct;
    return [...document.querySelectorAll(".ytp-caption-segment .pbx-word")].find((candidate) =>
      [...candidate.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0 && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)
    ) ?? null;
  }

  function setHoverWord(word) {
    if (state.hoverWord === word) return;
    state.hoverWord?.classList.remove("pbx-hover");
    state.hoverWord = word;
    word?.classList.add("pbx-hover");
    document.querySelector("#movie_player")?.classList.toggle("pbx-word-target", Boolean(word));
    if (word) clearTimeout(state.closeTimer);
    else if (state.popup) scheduleClose();
  }

  function onCaptionPointerMove(event) {
    // composedPath is only available during dispatch, before the animation frame.
    const inOverlay = event.composedPath().includes(host);
    const point = { target: event.target, clientX: event.clientX, clientY: event.clientY };
    cancelAnimationFrame(state.hoverFrame);
    state.hoverFrame = requestAnimationFrame(() => {
      setHoverWord(inOverlay ? null : captionWordAt(point));
      if (inOverlay) clearTimeout(state.closeTimer);
    });
  }

  function onCaptionClick(event) {
    if (event.composedPath().includes(host)) return;
    const word = captionWordAt(event);
    if (!word) return;
    event.preventDefault(); event.stopPropagation();
    event.stopImmediatePropagation();
    if (Date.now() < state.ignoreClickUntil) return;
    shadow.querySelector(".pbx-action")?.remove();
    openFromWord(word);
  }

  function openFromWord(element, selected = null, rectOverride = null) {
    const video = document.querySelector("#movie_player video.html5-main-video") || document.querySelector("video");
    if (!video) return;
    const word = selected?.term ?? element.dataset.pbxWord;
    const sentence = selected?.context ?? captionContext();
    if (state.popup && videoContext.video === video) {
      videoContext.video = video;
    } else {
      videoContext.video = video;
      videoContext.pausedByUs = !video.paused;
      videoContext.pausedAt = video.currentTime;
      video.addEventListener("play", () => {
        if (videoContext.video === video) videoContext.pausedByUs = false;
      }, { once: true });
      if (!video.paused) video.pause();
    }
    void openPopup(word, rectOverride ?? element.getBoundingClientRect(), { term: word, context: sentence, pageUrl: location.href, pageTitle: document.title, videoTime: video.currentTime }, element);
  }

  async function openPopup(term, rect, capture, anchor = null) {
    clearTimeout(state.closeTimer);
    const mode = state.config.mode ?? "en-vi";
    state.activeWord = { term, rect, capture, mode, anchor };
    const sequence = ++state.sequence;
    if (!state.popup) createPopup();
    renderLoading(term);
    place(rect, state.popup);
    let response;
    try {
      response = await send("lookup", { term, mode });
    } catch (error) {
      if (sequence !== state.sequence || state.popup === null) return;
      return showError(error instanceof Error ? error.message : "Không thể tra từ điển");
    }
    if (sequence !== state.sequence || state.popup === null) return;
    if (!response.ok) return showError(response.error);
    const lookup = response.data;
    const statusTerm = mode === "vi-en" && lookup.result?.senses?.[0]?.sourceTerm ? lookup.result.senses[0].sourceTerm : term;
    renderResult(lookup, { state: "unknown", items: [] });
    const box = shadow.querySelector(".pbx-card");
    place(state.activeWord.rect, box);
    void send("read-status", { term: statusTerm, mode }).then((savedStatus) => {
      if (sequence !== state.sequence || state.popup === null || !savedStatus.ok) return;
      renderResult(state.activeWord.lookup ?? lookup, savedStatus.data);
      place(state.activeWord.rect, shadow.querySelector(".pbx-card"));
    }).catch(() => {});
  }

  function createPopup() {
    const card = document.createElement("section");
    card.className = "pbx-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Tra từ Phrasebook");
    card.addEventListener("pointerenter", () => clearTimeout(state.closeTimer));
    card.addEventListener("pointerleave", scheduleClose);
    card.addEventListener("click", (event) => event.stopPropagation());
    shadow.append(card);
    state.popup = card;
    document.addEventListener("keydown", onEscape, true);
    document.addEventListener("pointerdown", onOutside, true);
  }

  function renderLoading(term) {
    state.popup.innerHTML = `<div class="pbx-head"><div><h2 class="pbx-term"></h2><div class="pbx-meta"></div></div><button class="pbx-close" aria-label="Đóng">×</button></div><div class="pbx-content"><p>Đang tra từ điển trên máy…</p></div><div class="pbx-status" role="status"></div>`;
    state.popup.querySelector(".pbx-term").textContent = term;
    state.popup.querySelector(".pbx-meta").textContent = modeLabel(state.activeWord.mode);
    state.popup.querySelector(".pbx-close").addEventListener("click", closePopup);
  }

  function renderResult(lookup, saved) {
    const active = state.activeWord;
    active.lookup = lookup;
    active.saved = saved;
    const mode = lookup.mode ?? state.config.mode ?? "en-vi";
    active.dataVersion = lookup.dataVersion ?? "";
    const result = lookup.result;
    const senses = result?.senses ?? [];
    const sense = active?.selectedSense ?? senses[0] ?? null;
    const savedItem = findSavedSense(saved, mode, sense, active.term);
    const head = `<div class="pbx-head"><div><h2 class="pbx-term"></h2><div class="pbx-meta">${modeLabel(mode)}${sense?.ipa ? ` · ${escapeHtml(sense.ipa)}` : ""}</div></div><button class="pbx-close" aria-label="Đóng">×</button></div>`;
    state.popup.innerHTML = head;
    state.popup.querySelector(".pbx-term").textContent = mode === "vi-en" && sense?.sourceTerm ? `${active.term} → ${sense.sourceTerm}` : active.term;
    state.popup.querySelector(".pbx-close").addEventListener("click", closePopup);

    const content = document.createElement("div");
    content.className = "pbx-content";
    if (!senses.length) {
      const missing = document.createElement("p");
      missing.className = "pbx-missing";
      missing.textContent = lookup.missingPack ? "Chưa tải từ điển cho chế độ này." : "Từ điển chưa có nghĩa cho từ này.";
      content.append(missing);
      if (lookup.missingPack) {
        const settings = makeButton("Cài từ điển", "pbx-btn", () => { void send("open-settings").catch((error) => showError(error.message)); });
        content.append(settings);
      }
      const ai = makeButton("Bổ sung bằng AI", "pbx-btn", () => requestEnrichment(active, mode, sense));
      ai.disabled = Boolean(active.enriching);
      if (active.enriching) ai.textContent = "AI đang xử lý…";
      content.append(ai);
    } else {
      if (senses.length > 1) {
        const select = document.createElement("select"); select.className = "pbx-sense"; select.setAttribute("aria-label", "Chọn nghĩa");
        select.disabled = Boolean(active.enriching);
        senses.forEach((item, index) => {
          const option = document.createElement("option"); option.value = String(index);
          option.textContent = `${item.partOfSpeech ? `${item.partOfSpeech}: ` : ""}${item.definitions?.[0] ?? `Nghĩa ${index + 1}`}`;
          select.append(option);
        });
        select.value = String(Math.max(0, senses.indexOf(sense)));
        select.addEventListener("change", () => {
          active.selectedSense = senses[Number(select.value)];
          active.enrichmentStatus = "";
          active.enrichmentError = false;
          renderResult(lookup, { state: "checking", items: [] });
          const savedTerm = mode === "vi-en" && active.selectedSense?.sourceTerm ? active.selectedSense.sourceTerm : active.term;
          const sequence = state.sequence;
          void send("read-status", { term: savedTerm, mode }).then((response) => {
            if (sequence === state.sequence && active === state.activeWord && state.popup && response.ok) renderResult(active.lookup ?? lookup, response.data);
          });
        });
        content.append(select);
      }
      const definition = document.createElement("p"); definition.className = "pbx-definition";
      definition.textContent = sense?.definitions?.[0] ?? "Chưa có nghĩa cơ bản";
      content.append(definition);
      if (sense?.examples?.[0]) { const example = document.createElement("p"); example.className = "pbx-example"; example.textContent = sense.examples[0]; content.append(example); }
      const missing = getMissing(sense);
      if (mode === "vi-en" && !sense?.sourceTerm) missing.push("từ tiếng Anh để tạo flashcard (bấm Bổ sung bằng AI)");
      if (missing.length) { const note = document.createElement("p"); note.className = "pbx-missing"; note.textContent = `Chưa có: ${missing.join(", ")}.`; content.append(note); }
      content.append(makeButton(active.enriching ? "AI đang xử lý…" : "Bổ sung bằng AI", "pbx-btn", () => requestEnrichment(active, mode, sense), Boolean(active.enriching)));
    }
    state.popup.append(content);

    const details = document.createElement("div"); details.className = "pbx-detail"; details.hidden = !active.expanded;
    if (sense) renderDetails(details, sense);
    state.popup.append(details);
    const status = document.createElement("div"); status.className = "pbx-status"; status.setAttribute("role", "status");
    status.textContent = savedItem ? "Đã có nghĩa này trong kho" : saved.items?.length ? "Từ này đã có nghĩa khác trong kho" : saved.state === "needs_auth" ? "Đăng nhập để lưu và đồng bộ" : "";
    if (active.enrichmentStatus) status.textContent = active.enrichmentStatus;
    if (active.enrichmentError) status.dataset.kind = "error";
    state.popup.append(status);

    const footer = document.createElement("div"); footer.className = "pbx-foot";
    footer.append(makeButton(active.expanded ? "Thu nhỏ" : "Mở rộng", "pbx-btn", () => {
      active.expanded = !active.expanded;
      renderResult(lookup, saved);
      place(active.rect, state.popup);
    }));
    footer.append(makeButton(savedItem ? "Đã lưu" : "Lưu", "pbx-btn pbx-primary", () => saveWord(active, mode, sense, status, footer), Boolean(savedItem) || Boolean(active.enriching)));
    state.popup.append(footer);
    state.popup.dataset.expanded = active.expanded ? "true" : "false";
    place(active.rect, state.popup);
  }

  function getMissing(sense) {
    const fields = [];
    if (!sense?.definitions?.length) fields.push("nghĩa");
    if (!sense?.ipa) fields.push("IPA");
    if (!sense?.examples?.length) fields.push("ví dụ");
    if (!sense?.synonyms?.length) fields.push("đồng nghĩa");
    if (!sense?.antonyms?.length) fields.push("trái nghĩa");
    if (!sense?.collocations?.length) fields.push("cụm từ đi kèm");
    return fields;
  }

  function findSavedSense(saved, mode, sense, queryTerm) {
    const items = Array.isArray(saved?.items) ? saved.items : [];
    const provider = mode === "en-en" ? "kaikki-en" : "kaikki-vi";
    if (sense?.id) {
      const byReference = items.find((item) => item.identity_refs?.some((ref) =>
        ref.provider === provider && ref.source_reference === sense.id && ref.dataset_version === (state.activeWord?.dataVersion ?? "")));
      if (byReference) return byReference;
    }
    const definition = safeText(sense?.definitions?.[0]).trim().toLocaleLowerCase("vi").replace(/\s+/g, " ");
    return items.find((item) => {
      const savedMeaning = (mode === "en-en" ? item.meaning_en : mode === "en-vi" ? item.meaning_vi : item.meaning_vi)
        .trim().toLocaleLowerCase("vi").replace(/\s+/g, " ");
      if (mode === "vi-en") return savedMeaning === queryTerm.trim().toLocaleLowerCase("vi").replace(/\s+/g, " ");
      return savedMeaning === definition;
    }) ?? null;
  }

  function renderDetails(parent, sense) {
    if (sense.partOfSpeech) addDetail(parent, "Từ loại", sense.partOfSpeech);
    if (sense.ipa) addDetail(parent, "IPA", sense.ipa);
    for (const [label, key] of [["Định nghĩa", "definitions"], ["Ví dụ", "examples"], ["Kết hợp từ", "collocations"], ["Đồng nghĩa", "synonyms"], ["Trái nghĩa", "antonyms"]]) {
      const values = sense[key];
      if (Array.isArray(values) && values.length) addList(parent, label, values);
    }
    if (!parent.childElementCount) { const p = document.createElement("p"); p.textContent = "Chưa có thông tin chi tiết."; parent.append(p); }
  }

  function addDetail(parent, label, value) { const group = document.createElement("div"); const title = document.createElement("h3"); title.textContent = label; const text = document.createElement("p"); text.textContent = safeText(value); group.append(title, text); parent.append(group); }
  function addList(parent, label, values) { const group = document.createElement("div"); const title = document.createElement("h3"); title.textContent = label; const list = document.createElement("ul"); for (const value of values) { const item = document.createElement("li"); item.textContent = safeText(value); list.append(item); } group.append(title, list); parent.append(group); }
  function makeButton(text, className, action, disabled = false) { const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = text; button.disabled = disabled; button.addEventListener("click", (event) => { event.stopPropagation(); action(); }); return button; }

  async function requestEnrichment(active, mode, sense) {
    if (active.enriching || active !== state.activeWord) return;
    const fields = getMissing(sense).map((field) => ({ nghĩa: "definitions", IPA: "ipa", "ví dụ": "examples", "đồng nghĩa": "synonyms", "trái nghĩa": "antonyms", "cụm từ đi kèm": "collocations" })[field]).filter(Boolean);
    if (!fields.length && mode === "vi-en" && !sense?.sourceTerm) fields.push("definitions");
    if (!fields.length) {
      active.enrichmentStatus = "Mục từ này đã có đủ thông tin; không cần gọi AI.";
      renderResult(active.lookup, active.saved ?? { state: "unknown", items: [] });
      return;
    }
    clearTimeout(state.closeTimer);
    active.enriching = true;
    active.enrichmentError = false;
    active.enrichmentStatus = "AI đang xử lý… Bạn chỉ cần bấm một lần.";
    renderResult(active.lookup, active.saved ?? { state: "unknown", items: [] });
    try {
      const result = await send("enrich", { term: active.term, mode, context: active.capture.context, fields, current: sense ?? {} });
      if (active !== state.activeWord || !state.popup) return;
      if (!result.ok) throw new Error(result.error || "Không thể bổ sung bằng AI");
      if (result.data?.mode !== mode || result.data?.definitionLanguage !== (mode === "en-vi" ? "vi" : "en")) throw new Error("Kết quả AI không khớp chế độ tra. Hãy tải lại extension và thử lại.");
      const additions = result.data?.fields ?? {};
      const enrichedSense = { definitions: [], examples: [], synonyms: [], antonyms: [], collocations: [], ...sense };
      enrichedSense.glossLanguage = result.data.definitionLanguage;
      if (!enrichedSense.sourceTerm && typeof additions.sourceTerm === "string" && additions.sourceTerm.trim()) enrichedSense.sourceTerm = additions.sourceTerm.trim();
      for (const [field, value] of Object.entries(additions)) {
        if (field === "sourceTerm") continue;
        const populated = field === "ipa" ? Boolean(enrichedSense.ipa?.trim()) : Boolean(enrichedSense[field]?.length);
        if (!populated && (typeof value === "string" || Array.isArray(value))) enrichedSense[field] = value;
      }
      const added = Object.keys(additions).filter((field) => typeof additions[field] === "string" ? additions[field].trim() : additions[field]?.length);
      enrichedSense.aiFields = [...new Set([...(enrichedSense.aiFields ?? []), ...added.filter((field) => field !== "sourceTerm")])];
      active.selectedSense = enrichedSense;
      const senses = [...(active.lookup?.result?.senses ?? [])];
      const selectedIndex = sense ? senses.indexOf(sense) : -1;
      if (selectedIndex >= 0) senses[selectedIndex] = enrichedSense;
      else senses.push(enrichedSense);
      active.lookup = { ...active.lookup, result: { ...(active.lookup?.result ?? {}), senses } };
      active.enrichmentStatus = added.length ? "Đã bổ sung vào bản xem trước. Nhấn Lưu để thêm vào kho." : "AI không tìm thấy thông tin chắc chắn cho các mục còn thiếu.";
    } catch (error) {
      active.enrichmentError = true;
      active.enrichmentStatus = error instanceof Error ? error.message : "Không thể bổ sung bằng AI. Hãy thử lại.";
    } finally {
      active.enriching = false;
      if (active === state.activeWord && state.popup) renderResult(active.lookup, active.saved ?? { state: "unknown", items: [] });
    }
  }

  async function saveWord(active, mode, sense, status, footer) {
    const canonicalTerm = mode === "vi-en" ? sense?.sourceTerm : active.term;
    if (!canonicalTerm) { status.textContent = "Chưa có từ tiếng Anh để tạo flashcard."; status.dataset.kind = "error"; return; }
    const saveButton = footer.querySelector(".pbx-primary");
    saveButton.disabled = true;
    status.textContent = "Đang lưu trên máy…";
    const result = await send("save-capture", { capture: {
      operationId: crypto.randomUUID(), term: canonicalTerm, queryTerm: active.term, phrase: canonicalTerm.trim().split(/\s+/).length > 1,
      mode, selectedSense: sense ? { ...sense, dataVersion: active.dataVersion } : null, context: active.capture.context, pageUrl: active.capture.pageUrl ?? location.href,
      pageTitle: active.capture.pageTitle ?? document.title, videoTime: active.capture.videoTime ?? null
    } });
    if (!result.ok) { status.textContent = result.error; status.dataset.kind = "error"; saveButton.disabled = false; return; }
    status.textContent = "Đã lưu trên máy · chờ đồng bộ";
    saveButton.textContent = "Đã lưu";
  }

  function showError(message) {
    const status = state.popup?.querySelector(".pbx-status");
    if (status) { status.textContent = message; status.dataset.kind = "error"; }
  }
  function scheduleClose() {
    clearTimeout(state.closeTimer);
    if (state.activeWord?.enriching) return;
    if (state.popup?.dataset.expanded === "true") return;
    state.closeTimer = setTimeout(closePopup, 300);
  }
  function closePopup() {
    clearTimeout(state.closeTimer);
    state.sequence += 1;
    state.popup?.remove(); state.popup = null; state.activeWord = null;
    document.removeEventListener("keydown", onEscape, true);
    document.removeEventListener("pointerdown", onOutside, true);
    const video = videoContext.video;
    if (video && videoContext.pausedByUs && video.paused && Math.abs(video.currentTime - videoContext.pausedAt) < 0.75 && video.isConnected) void video.play().catch(() => {});
    videoContext.video = null; videoContext.pausedByUs = false;
  }
  function onEscape(event) { if (event.key === "Escape") { event.preventDefault(); closePopup(); } }
  function onOutside(event) { if (!event.composedPath().includes(host)) closePopup(); }
  function escapeHtml(value) { return safeText(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]); }

  void send("get-config").then((response) => {
    state.config = response.data ?? {};
    const appOrigin = state.config.appOrigin ?? "http://localhost:3000";
    if (appOrigin && new URL(appOrigin).origin === location.origin) {
      host.remove();
      return;
    }
    const target = mountPoint();
    if (target !== host.parentElement) target.append(host);
  }).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.mode) {
      state.config.mode = changes.mode.newValue ?? "en-vi";
      closePopup();
      shadow.querySelector(".pbx-action")?.remove();
    }
  });
})();
