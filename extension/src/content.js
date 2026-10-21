(() => {
  if (window.__phrasebookContentStarted) return;
  window.__phrasebookContentStarted = true;

  const PROTOCOL = 1;
  const isYouTube = location.hostname === "www.youtube.com";
  const videoContext = { video: null, pausedByUs: false, pausedAt: 0 };
  const observedVideos = new WeakSet();
  const state = { config: {}, popup: null, activeWord: null, closeTimer: 0, sequence: 0, selection: null, selectionDirty: false, selectionAtPointerDown: "", lastSelectionSignature: "", ignoreClickUntil: 0, hoverWord: null, hoverFrame: 0, hoverPoint: null, pointer: null, pointerVersion: 0 };
  const host = document.createElement("div");
  host.id = "phrasebook-extension-root";
  host.lang = "en";
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
    .pbx-form { margin:0 0 9px; padding-left:9px; border-left:2px solid #2563eb; color:#475569; font-size:12px; }
    .pbx-example-label { display:block; margin-bottom:3px; font-weight:650; }
    .pbx-example { margin:11px 0 0; padding:9px 10px; border-left:3px solid #93c5fd; background:#f8fafc; color:#475569; font-size:12px; }
    .pbx-missing { margin:10px 0 0; color:#64748b; font-size:12px; }
    .pbx-sense { width:100%; margin:0 0 10px; padding:7px 9px; border:1px solid #cbd5e1; border-radius:7px; background:white; color:#172554; font:13px system-ui,sans-serif; }
    .pbx-choices { max-height:190px; overflow-y:auto; overflow-x:hidden; margin:0 0 12px; padding:3px; border:1px solid #dbe3ef; border-radius:8px; }
    .pbx-choice { display:block; width:100%; margin:0; padding:9px; border:0; border-bottom:1px solid #eef2f7; background:#fff; color:#172554; text-align:left; white-space:normal; overflow-wrap:anywhere; font:13px/1.45 system-ui,sans-serif; cursor:pointer; }
    .pbx-choice[aria-pressed=true] { background:#eff6ff; box-shadow:inset 3px 0 #2563eb; }
    .pbx-choice:hover,.pbx-choice:focus-visible { background:#f1f5f9; }
    .pbx-choice small { display:block; margin-bottom:3px; color:#64748b; font-size:11px; }
    .pbx-choice-text { display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .pbx-source { margin:0 0 5px; color:#64748b; font-size:11px; }
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

  async function send(type, values = {}) {
    try {
      const result = await chrome.runtime.sendMessage({ protocol: PROTOCOL, type, ...values });
      if (!result || typeof result.ok !== "boolean") throw new Error("Phrasebook was updated. Reload this page and try again.");
      return result;
    } catch (error) {
      if (/context invalidated|receiving end|message port closed/i.test(error.message ?? "")) throw new Error("Phrasebook was updated. Reload this page and try again.");
      throw error;
    }
  }

  function safeText(value) { return typeof value === "string" ? value : ""; }
  function modeLabel(mode) { return ({ "en-en": "English → English", "en-vi": "English → Vietnamese", "vi-en": "Vietnamese → English" })[mode] ?? "English → Vietnamese"; }

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
    if (box === state.popup && state.activeWord) {
      const below = bounds.bottom - rect.bottom - 12;
      const above = rect.top - bounds.top - 12;
      // Keep the same edge through loading, result and saved-status updates.
      state.activeWord.placement ??= below < Math.min(360, bounds.height - 24) && above > below ? "above" : "below";
      if (state.activeWord.placement === "above") top = rect.top - bounds.top - height - 12;
    } else if (top + height > bounds.height - 8) top = rect.top - bounds.top - height - 12;
    top = Math.max(8, Math.min(top, bounds.height - height - 8));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }

  function showLookupButton(rect, selectedText, context, caption = null) {
    if (state.isApp) return;
    const existing = shadow.querySelector(".pbx-action");
    if (existing) existing.remove();
    const button = document.createElement("button");
    button.className = "pbx-action";
    button.type = "button";
    button.textContent = "Look up";
    button.setAttribute("aria-label", `Look up ${selectedText}`);
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

  function elementForNode(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function isEditable(node) {
    return Boolean(elementForNode(node)?.closest("input,textarea,select,[contenteditable=true],[role=textbox]"));
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
    state.ignoreClickUntil = 0;
    state.selectionAtPointerDown = selectionSignature(window.getSelection());
    shadow.querySelector(".pbx-action")?.remove();
  }, true);

  document.addEventListener("mouseup", (event) => {
    if (event.composedPath().includes(host)) return;
    const selection = window.getSelection();
    // Native double-click selection stops at a hyphen. Treat a caption token
    // as one word, while leaving deliberate drag selections unchanged.
    if (isYouTube && event.detail === 2 && selection && !selection.isCollapsed) {
      const start = elementForNode(selection.anchorNode)?.closest(".pbx-word");
      const end = elementForNode(selection.focusNode)?.closest(".pbx-word");
      const token = start ?? end;
      const selected = selection.toString().trim();
      // Chrome may include the following whitespace text node in a word selection.
      if (token && token === captionWordAt(event) && (!start || start === token) && (!end || end === token) && selected && token.textContent.includes(selected)) {
        const range = document.createRange();
        range.selectNodeContents(token);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    const text = safeText(selection?.toString()).trim();
    if (!text || text.length > 120 || isEditable(selection.anchorNode)) {
      shadow.querySelector(".pbx-action")?.remove();
      state.selectionDirty = false;
      return;
    }
    if (!state.selectionDirty && selectionSignature(selection) === state.selectionAtPointerDown && event.detail < 2) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) { state.selectionDirty = false; return; }
    const caption = isYouTube ? elementForNode(selection.anchorNode)?.closest(".ytp-caption-segment") : null;
    const context = caption ? captionContext() : contextAround(selection);
    state.selection = { term: text, context, rect };
    if (caption) state.ignoreClickUntil = Date.now() + 350;
    const selectedWord = elementForNode(selection.anchorNode)?.closest(".pbx-word");
    showLookupButton(rect, text, context, caption && selectedWord?.textContent === text ? selectedWord : caption);
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
    const pieces = text.match(/[\p{L}\p{M}\p{N}]+(?:['’\-\u2010\u2011][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}]+/gu) ?? [text];
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
    if (state.config.youtubeEnabled === false) return;
    const segments = document.querySelectorAll(".ytp-caption-segment");
    for (const segment of segments) {
      if (segment.closest("#phrasebook-extension-root")) continue;
      // YouTube can reuse a segment and replace only its text between cues.
      const text = segment.textContent;
      if (text?.trim()) makeInteractive(segment, text);
    }
    if (state.hoverWord && !state.hoverWord.isConnected) setHoverWord(null);
  }

  document.addEventListener("pointermove", onLookupPointerMove, true);

  if (isYouTube) {
    const observer = new MutationObserver(activateCaptions);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    activateCaptions();
    document.addEventListener("yt-navigate-start", () => {
      videoContext.pausedByUs = false;
      closePopup(); setHoverWord(null);
      shadow.querySelector(".pbx-action")?.remove();
    });
    document.addEventListener("click", onCaptionClick, true);
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
  }

  function onLookupPointerMove(event) {
    const inOverlay = event.composedPath().includes(host);
    const point = { target: event.target, clientX: event.clientX, clientY: event.clientY };
    state.pointer = point;
    state.pointerVersion += 1;
    if (inOverlay || pointerOverLookup(point)) cancelClose();
    else scheduleClose();
    if (!isYouTube) return;
    state.hoverPoint = point;
    const direct = !inOverlay && event.target instanceof Element ? event.target.closest(".ytp-caption-segment .pbx-word") : null;
    if (inOverlay || direct) {
      cancelAnimationFrame(state.hoverFrame);
      state.hoverFrame = 0;
      setHoverWord(direct);
    } else if (!state.hoverFrame) {
      // Coalesce the fallback hit-test instead of cancelling every frame during fast motion.
      state.hoverFrame = requestAnimationFrame(() => {
        state.hoverFrame = 0;
        setHoverWord(captionWordAt(state.hoverPoint));
      });
    }
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
    if (state.config.youtubeEnabled === false) return;
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
      if (!observedVideos.has(video)) {
        observedVideos.add(video);
        const release = () => { if (videoContext.video === video) videoContext.pausedByUs = false; };
        video.addEventListener("play", release);
        video.addEventListener("seeking", release);
      }
      if (!video.paused) video.pause();
    }
    void openPopup(word, rectOverride ?? element.getBoundingClientRect(), { term: word, context: sentence, pageUrl: location.href, pageTitle: document.title, videoTime: video.currentTime }, element);
  }

  async function openPopup(term, rect, capture, anchor = null) {
    cancelClose();
    const queryTerm = term;
    term = term.replace(/[\u2010\u2011]/g, "-");
    const mode = state.config.mode ?? "en-vi";
    state.activeWord?.anchor?.classList.remove("pbx-active");
    if (anchor?.matches(".pbx-word")) anchor.classList.add("pbx-active");
    state.activeWord = { term, queryTerm, rect, capture, mode, anchor, loading: true, openedPointerVersion: state.pointerVersion };
    const sequence = ++state.sequence;
    if (!state.popup) createPopup();
    renderLoading(term);
    place(rect, state.popup);
    let response;
    try {
      response = await send("lookup", { term, mode });
    } catch (error) {
      if (sequence !== state.sequence || state.popup === null) return;
      state.activeWord.loading = false;
      return showError(error instanceof Error ? error.message : "Dictionary lookup failed");
    }
    if (sequence !== state.sequence || state.popup === null) return;
    state.activeWord.loading = false;
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
    card.setAttribute("aria-label", "Phrasebook lookup");
    card.addEventListener("pointerenter", cancelClose);
    // Layout changes can fire pointerleave without any actual mouse movement.
    // Dismissal is driven only by document pointermove and rechecked on timeout.
    card.addEventListener("click", (event) => event.stopPropagation());
    shadow.append(card);
    state.popup = card;
    document.addEventListener("keydown", onEscape, true);
    document.addEventListener("pointerdown", onOutside, true);
  }

  function renderLoading(term) {
    state.popup.innerHTML = `<div class="pbx-head"><div><h2 class="pbx-term"></h2><div class="pbx-meta"></div></div><button class="pbx-close" aria-label="Close">×</button></div><div class="pbx-content"><p>Looking up the local dictionary…</p></div><div class="pbx-status" role="status"></div>`;
    state.popup.querySelector(".pbx-term").textContent = term;
    state.popup.querySelector(".pbx-meta").textContent = modeLabel(state.activeWord.mode);
    state.popup.querySelector(".pbx-close").addEventListener("click", closePopup);
  }

  function renderResult(lookup, saved) {
    const active = state.activeWord;
    active.lookup = lookup;
    active.saved = saved;
    if (active.saving) return; // Keep controls stable until the current click has finished saving.
    const mode = lookup.mode ?? state.config.mode ?? "en-vi";
    active.dataVersion = lookup.dataVersion ?? "";
    const result = lookup.result;
    const senses = result?.senses ?? [];
    const sense = active?.selectedSense ?? senses[0] ?? null;
    const savedItem = findSavedSense(saved, mode, sense, active.term);
    const head = `<div class="pbx-head"><div><h2 class="pbx-term"></h2><div class="pbx-meta">${modeLabel(mode)}${sense?.ipa ? ` · ${escapeHtml(sense.ipa)}` : ""}</div></div><button class="pbx-close" aria-label="Close">×</button></div>`;
    state.popup.innerHTML = head;
    state.popup.querySelector(".pbx-term").textContent = mode === "vi-en" && sense?.sourceTerm ? `${active.term} → ${sense.sourceTerm}` : active.term;
    state.popup.querySelector(".pbx-close").addEventListener("click", closePopup);

    const content = document.createElement("div");
    content.className = "pbx-content";
    if (!senses.length) {
      const missing = document.createElement("p");
      missing.className = "pbx-missing";
      missing.textContent = lookup.missingPack ? "No dictionary installed for this mode." : "This word is not in the dictionary yet.";
      content.append(missing);
      if (lookup.missingPack) {
        const settings = makeButton("Install dictionary", "pbx-btn", () => { void send("open-settings").catch((error) => showError(error.message)); });
        content.append(settings);
      }
      const ai = makeButton("Fill with AI", "pbx-btn", () => requestEnrichment(active, mode, sense));
      ai.disabled = Boolean(active.enriching);
      if (active.enriching) ai.textContent = "AI is working…";
      content.append(ai);
    } else {
      if (senses.length > 1) {
        const choose = (item) => {
          active.selectedSense = item;
          active.meaningPickerOpen = false;
          active.confirmedItemId = null;
          active.enrichmentStatus = "";
          active.enrichmentError = false;
          renderResult(lookup, { state: "checking", items: [] });
          state.popup.querySelector('[aria-label="Choose a meaning"]')?.focus({ preventScroll: true });
          const savedTerm = mode === "vi-en" && active.selectedSense?.sourceTerm ? active.selectedSense.sourceTerm : active.term;
          const sequence = state.sequence;
          void send("read-status", { term: savedTerm, mode }).then((response) => {
            if (sequence === state.sequence && active === state.activeWord && state.popup && response.ok) renderResult(active.lookup ?? lookup, response.data);
          });
        };
        const toggle = makeButton(active.meaningPickerOpen ? "Close meanings" : "Other meanings", "pbx-btn pbx-sense", () => {
          cancelClose(); active.meaningPickerOpen = !active.meaningPickerOpen; renderResult(lookup, saved);
          state.popup.querySelector(active.meaningPickerOpen ? ".pbx-choice" : '[aria-label="Choose a meaning"]')?.focus({ preventScroll: true });
        }, Boolean(active.enriching));
        toggle.setAttribute("aria-label", "Choose a meaning"); toggle.setAttribute("aria-expanded", String(Boolean(active.meaningPickerOpen)));
        content.append(toggle);
        if (active.meaningPickerOpen) {
          const choices = document.createElement("div"); choices.className = "pbx-choices"; choices.setAttribute("role", "group"); choices.setAttribute("aria-label", "Dictionary meanings");
          const initialCount = Math.max(1, Math.min(3, result.basicSenseCount ?? 3));
          const visible = active.showAllMeanings ? senses : senses.slice(0, initialCount);
          for (const item of visible) {
            const button = makeButton("", "pbx-choice", () => choose(item), Boolean(active.enriching));
            button.dataset.senseIndex = String(senses.indexOf(item)); button.setAttribute("aria-pressed", String(item === sense));
            const label = document.createElement("small"); label.textContent = [item.partOfSpeech, item.learner ? "Simple English" : "Dictionary", ...(item.usageLabels ?? []).slice(0, 2)].filter(Boolean).join(" · ");
            const text = document.createElement("span"); text.className = "pbx-choice-text"; text.textContent = item.definitions?.[0] ?? "Base meaning unavailable";
            button.append(label, text); choices.append(button);
          }
          if (senses.length > initialCount) choices.append(makeButton(active.showAllMeanings ? "Show fewer meanings" : `More dictionary meanings (${senses.length - initialCount})`, "pbx-choice", () => {
            active.showAllMeanings = !active.showAllMeanings; renderResult(lookup, saved);
          }));
          content.append(choices);
        }
      }
      if (sense?.formNote) { const form = document.createElement("p"); form.className = "pbx-form"; form.textContent = sense.formNote; content.append(form); }
      const definition = document.createElement("p"); definition.className = "pbx-definition";
      if (sense?.learner) { const source = document.createElement("p"); source.className = "pbx-source"; source.textContent = "Simple English definition"; content.append(source); }
      definition.textContent = sense?.definitions?.[0] ?? (sense?.formStatus === "unresolved" ? `The meaning of ${sense.baseForm} is not available in this dictionary. You can fill it with AI.` : "No definition available");
      content.append(definition);
      if (sense?.examples?.[0]) { const example = document.createElement("p"); example.className = "pbx-example";
        if (sense.examplesFromBase) { const label = document.createElement("span"); label.className = "pbx-example-label"; label.textContent = `Example with ${sense.baseForm}`; example.append(label); }
        example.append(document.createTextNode(sense.examples[0])); content.append(example); }
      const missing = getMissing(sense);
      if (mode === "vi-en" && !sense?.sourceTerm) missing.push("English headword for flashcards (click Fill with AI)");
      if (missing.length) { const note = document.createElement("p"); note.className = "pbx-missing"; note.textContent = `Missing: ${missing.join(", ")}.`; content.append(note); }
      content.append(makeButton(active.enriching ? "AI is working…" : "Fill with AI", "pbx-btn", () => requestEnrichment(active, mode, sense), Boolean(active.enriching)));
    }
    if (!savedItem && saved.items?.length) {
      const label = document.createElement("label"); label.textContent = "Save this meaning as";
      const existing = document.createElement("select"); existing.className = "pbx-sense"; existing.setAttribute("aria-label", "Link to an existing meaning");
      const fresh = document.createElement("option"); fresh.value = ""; fresh.textContent = "A separate meaning"; existing.append(fresh);
      for (const item of saved.items) { const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.meaning_en || item.meaning_vi} · existing`; existing.append(option); }
      existing.value = active.confirmedItemId ?? ""; existing.disabled = Boolean(active.enriching);
      existing.onchange = () => { active.confirmedItemId = existing.value || null; };
      label.append(existing); content.append(label);
    }
    state.popup.append(content);

    const details = document.createElement("div"); details.className = "pbx-detail"; details.hidden = !active.expanded;
    if (sense) renderDetails(details, sense);
    state.popup.append(details);
    const status = document.createElement("div"); status.className = "pbx-status"; status.setAttribute("role", "status");
    status.textContent = savedItem ? "This meaning is already in your library" : saved.items?.length ? "Another meaning of this word is in your library" : saved.state === "needs_auth" ? "Sign in to save and sync" : "";
    if (active.enrichmentStatus) status.textContent = active.enrichmentStatus;
    if (active.enrichmentError) status.dataset.kind = "error";
    state.popup.append(status);

    const footer = document.createElement("div"); footer.className = "pbx-foot";
    footer.append(makeButton(active.expanded ? "Collapse" : "Expand", "pbx-btn", () => {
      active.expanded = !active.expanded;
      renderResult(lookup, saved);
      place(active.rect, state.popup);
    }));
    footer.append(makeButton(savedItem ? savedItem.has_flashcard === false ? "Add flashcard" : "Add context" : "Save", "pbx-btn pbx-primary", () => saveWord(active, mode, sense, status, footer), Boolean(active.enriching)));
    state.popup.append(footer);
    state.popup.dataset.expanded = active.expanded ? "true" : "false";
    place(active.rect, state.popup);
  }

  function getMissing(sense) {
    const fields = [];
    if (!sense?.definitions?.length) fields.push("definition");
    if (!sense?.ipa) fields.push("IPA");
    if (!sense?.examples?.length) fields.push("examples");
    if (!sense?.synonyms?.length) fields.push("synonyms");
    if (!sense?.antonyms?.length) fields.push("antonyms");
    if (!sense?.collocations?.length) fields.push("collocations");
    return fields;
  }

  function findSavedSense(saved, mode, sense, queryTerm) {
    const items = Array.isArray(saved?.items) ? saved.items : [];
    const provider = mode === "en-en" ? "kaikki-en" : "kaikki-vi";
    if (sense?.id) {
      const byReference = items.find((item) => item.identity_refs?.some((ref) =>
        ref.provider === provider && ref.source_reference === sense.id && ref.dataset_version === (sense.dataVersion ?? state.activeWord?.dataVersion ?? "")));
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
    if (sense.baseForm) addDetail(parent, "Base word", sense.baseForm);
    if (sense.formNote) addDetail(parent, "Word form", sense.formNote);
    if (sense.partOfSpeech) addDetail(parent, "Part of speech", sense.partOfSpeech);
    if (sense.ipa) addDetail(parent, "IPA", sense.ipa);
    for (const [label, key] of [["Definitions", "definitions"], ["Examples", "examples"], ["Collocations", "collocations"], ["Synonyms", "synonyms"], ["Antonyms", "antonyms"]]) {
      const values = sense[key];
      if (Array.isArray(values) && values.length) addList(parent, label, values);
    }
    if (!parent.childElementCount) { const p = document.createElement("p"); p.textContent = "No details available yet."; parent.append(p); }
  }

  function addDetail(parent, label, value) { const group = document.createElement("div"); const title = document.createElement("h3"); title.textContent = label; const text = document.createElement("p"); text.textContent = safeText(value); group.append(title, text); parent.append(group); }
  function addList(parent, label, values) { const group = document.createElement("div"); const title = document.createElement("h3"); title.textContent = label; const list = document.createElement("ul"); for (const value of values) { const item = document.createElement("li"); item.textContent = safeText(value); list.append(item); } group.append(title, list); parent.append(group); }
  function makeButton(text, className, action, disabled = false) { const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = text; button.disabled = disabled; button.addEventListener("click", (event) => { event.stopPropagation(); action(); }); return button; }

  async function requestEnrichment(active, mode, sense) {
    if (active.enriching || active !== state.activeWord) return;
    const fields = getMissing(sense).map((field) => ({ definition: "definitions", IPA: "ipa", examples: "examples", synonyms: "synonyms", antonyms: "antonyms", collocations: "collocations" })[field]);
    if (!fields.length && mode === "vi-en" && !sense?.sourceTerm) fields.push("definitions");
    if (!fields.length) {
      active.enrichmentStatus = "All fields are complete. No AI request is needed.";
      renderResult(active.lookup, active.saved ?? { state: "unknown", items: [] });
      return;
    }
    cancelClose();
    active.enriching = true;
    active.enrichmentError = false;
    active.enrichmentStatus = "AI is working… You only need to click once.";
    renderResult(active.lookup, active.saved ?? { state: "unknown", items: [] });
    try {
      const result = await send("enrich", { term: active.term, mode, context: active.capture.context, fields, current: sense ?? {} });
      if (active !== state.activeWord || !state.popup) return;
      if (!result.ok) throw new Error(result.error || "AI enrichment failed");
      if (result.data?.mode !== mode || result.data?.definitionLanguage !== (mode === "en-vi" ? "vi" : "en")) throw new Error("The AI response does not match this dictionary mode. Reload the extension and try again.");
      const additions = result.data?.fields ?? {};
      const enrichedSense = { definitions: [], examples: [], synonyms: [], antonyms: [], collocations: [], ...sense };
      enrichedSense.glossLanguage = result.data.definitionLanguage;
      if (additions.definitions?.length && enrichedSense.formStatus === "unresolved") enrichedSense.formStatus = "resolved";
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
      active.enrichmentStatus = added.length ? result.data.cacheHit ? "Previous AI result reused. Click Save to add it to your library." : "Preview updated. Click Save to add it to your library." : "AI could not find reliable information for the missing fields.";
    } catch (error) {
      active.enrichmentError = true;
      active.enrichmentStatus = error instanceof Error ? error.message : "AI enrichment failed. Please try again.";
    } finally {
      active.enriching = false;
      if (active === state.activeWord && state.popup) renderResult(active.lookup, active.saved ?? { state: "unknown", items: [] });
    }
  }

  async function saveWord(active, mode, sense, status, footer) {
    const canonicalTerm = mode === "vi-en" ? sense?.sourceTerm : active.term;
    if (!canonicalTerm) { status.textContent = "An English headword is required to create a flashcard."; status.dataset.kind = "error"; return; }
    const saveButton = footer.querySelector(".pbx-primary");
    saveButton.disabled = true;
    active.saving = true;
    cancelClose();
    const controls = [...state.popup.querySelectorAll(".pbx-btn,.pbx-sense")].filter((control) => control !== saveButton).map((control) => [control, control.disabled]);
    for (const [control] of controls) control.disabled = true;
    status.textContent = "Saving locally…";
    try {
      const result = await send("save-capture", { capture: {
        operationId: crypto.randomUUID(), existingItemId: active.confirmedItemId ?? undefined, term: canonicalTerm, queryTerm: active.queryTerm, phrase: canonicalTerm.trim().split(/\s+/).length > 1,
        mode, selectedSense: sense ? { ...sense, dataVersion: sense.dataVersion ?? active.dataVersion } : null, context: active.capture.context, pageUrl: active.capture.pageUrl ?? location.href,
        pageTitle: active.capture.pageTitle ?? document.title, videoTime: active.capture.videoTime ?? null
      } });
      if (!result.ok) throw new Error(result.error || "Could not save this word.");
      status.textContent = "Saved locally · waiting to sync";
      saveButton.textContent = "Saved";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not save this word. Please try again.";
      status.dataset.kind = "error";
      saveButton.disabled = false;
    } finally {
      active.saving = false;
      for (const [control, disabled] of controls) control.disabled = disabled;
    }
  }

  function showError(message) {
    const status = state.popup?.querySelector(".pbx-status");
    if (status) { status.textContent = message; status.dataset.kind = "error"; }
  }
  function cancelClose() {
    clearTimeout(state.closeTimer);
    state.closeTimer = 0;
  }
  function scheduleClose() {
    const active = state.activeWord;
    if (!active || active.loading || active.enriching || active.saving || active.expanded || active.meaningPickerOpen) return;
    if (state.pointerVersion <= active.openedPointerVersion || pointerOverLookup(state.pointer)) return;
    // Do not restart this timer on every move: a continuous move away should close promptly.
    if (state.closeTimer) return;
    state.closeTimer = setTimeout(() => {
      state.closeTimer = 0;
      if (active === state.activeWord && !active.loading && !active.enriching && !active.saving && !active.expanded && !active.meaningPickerOpen && !pointerOverLookup(state.pointer)) closePopup();
    }, 300);
  }

  function pointerOverLookup(point) {
    if (!point || !state.popup || !state.activeWord) return false;
    const inside = (rect, margin) => point.clientX >= rect.left - margin && point.clientX <= rect.right + margin && point.clientY >= rect.top - margin && point.clientY <= rect.bottom + margin;
    if (inside(state.popup.getBoundingClientRect(), 12)) return true;
    const anchor = state.activeWord.anchor;
    return anchor?.isConnected ? [...anchor.getClientRects()].some((rect) => inside(rect, 4)) : inside(state.activeWord.rect, 4);
  }
  function closePopup() {
    cancelClose();
    state.sequence += 1;
    state.activeWord?.anchor?.classList.remove("pbx-active");
    state.popup?.remove(); state.popup = null; state.activeWord = null;
    document.removeEventListener("keydown", onEscape, true);
    document.removeEventListener("pointerdown", onOutside, true);
    const video = videoContext.video;
    if (video && videoContext.pausedByUs && video.paused && Math.abs(video.currentTime - videoContext.pausedAt) < 0.75 && video.isConnected) void video.play().catch(() => {
      if (!video.isConnected || !host.isConnected) return;
      const resume = makeButton("Resume video", "pbx-action", () => { void video.play().then(() => resume.remove()).catch(() => { resume.textContent = "Use the player to resume"; }); });
      resume.style.cssText = "left:16px;bottom:16px"; shadow.append(resume);
    });
    videoContext.video = null; videoContext.pausedByUs = false;
  }
  function onEscape(event) { if (event.key === "Escape") { event.preventDefault(); closePopup(); } }
  function onOutside(event) {
    if (event.composedPath().includes(host) || (isYouTube && captionWordAt(event))) return;
    closePopup();
  }
  function escapeHtml(value) { return safeText(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]); }

  void send("get-config").then((response) => {
    state.config = response.data ?? {};
    if (state.config.youtubeEnabled === false) restoreCaptions();
    const appOrigin = state.config.appOrigin ?? "http://localhost:3000";
    if (appOrigin && new URL(appOrigin).origin === location.origin) {
      state.isApp = true;
      host.remove();
      // This bridge exposes only public dictionary data to the configured Phrasebook origin.
      // Auth tokens, personal meanings and queue operations are never exposed to page messages.
      let bridgeBusy = false;
      window.addEventListener("message", async (event) => {
        const input = event.data;
        if (event.source !== window || event.origin !== location.origin || input?.channel !== "phrasebook-dictionary-v1" || input.type !== "lookup") return;
        if (typeof input.id !== "string" || input.id.length > 80 || typeof input.term !== "string" || input.term.length > 120 || !["en-en", "en-vi", "vi-en"].includes(input.mode) || bridgeBusy) return;
        bridgeBusy = true;
        try {
          const response = await send("lookup-dictionary", { term: input.term, mode: input.mode });
          window.postMessage({ channel: "phrasebook-dictionary-v1", type: "result", id: input.id, response }, location.origin);
        } finally { bridgeBusy = false; }
      });
      return;
    }
    const target = mountPoint();
    if (target !== host.parentElement) target.append(host);
  }).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.youtubeEnabled) {
      state.config.youtubeEnabled = changes.youtubeEnabled.newValue !== false;
      if (!state.config.youtubeEnabled) { closePopup(); restoreCaptions(); }
      else if (isYouTube) activateCaptions();
    }
    if (area === "local" && changes.lastSyncAt && state.isApp) window.postMessage({ channel: "phrasebook-dictionary-v1", type: "synced" }, location.origin);
    if (area === "local" && changes.mode) {
      state.config.mode = changes.mode.newValue ?? "en-vi";
      closePopup();
      shadow.querySelector(".pbx-action")?.remove();
    }
  });
  function restoreCaptions() {
    setHoverWord(null);
    for (const segment of document.querySelectorAll(".ytp-caption-segment:has(.pbx-word)")) segment.replaceChildren(document.createTextNode(segment.textContent));
  }
})();
