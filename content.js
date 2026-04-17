if (!document.getElementById("bloom-floating-ui-wrapper")) {

  // ── Wrapper & Iframe ───────────────────────────────────────────────────────
  const wrapper = document.createElement("div");
  wrapper.id = "bloom-floating-ui-wrapper";

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("floating.html");
  iframe.id = "bloom-floating-ui";
  iframe.allow = "camera; microphone; display-capture";
  iframe.setAttribute("allowtransparency", "true");
  wrapper.appendChild(iframe);

  document.body.appendChild(wrapper);

  // ── Size logic ─────────────────────────────────────────────────────────────
  let currentSize = 240;

  function applySize(size) {
    currentSize = Math.max(100, Math.min(600, size));
    wrapper.style.width  = `${currentSize + 24}px`;
    iframe.style.height  = `${currentSize + 160}px`;
    wrapper.style.height = `${currentSize + 160}px`;
    iframe.contentWindow?.postMessage({ type: "BLOOM_RESIZE_UPDATE", size: currentSize }, "*");
  }

  // Restore previously saved position/size from background
  chrome.runtime.sendMessage({ type: "BLOOM_GET_STATE" }, (state) => {
    if (chrome.runtime.lastError) { /* ignore */ }
    if (state) {
      applySize(state.size || 240);
      if (typeof state.left === "number") {
        wrapper.style.left   = `${state.left}px`;
        wrapper.style.bottom = "auto";
        wrapper.style.right  = "auto";
      }
      if (typeof state.top === "number") {
        wrapper.style.top    = `${state.top}px`;
        wrapper.style.bottom = "auto";
      }
    } else {
      applySize(240);
    }
  });

  function saveState() {
    const rect = wrapper.getBoundingClientRect();
    chrome.runtime.sendMessage({
      type: "BLOOM_SAVE_STATE",
      state: { left: rect.left, top: rect.top, size: currentSize }
    });
  }

  // ── Interaction state ──────────────────────────────────────────────────────
  let dragging  = false;
  let resizing  = false;
  let resizeSx  = 1;  // sign: which direction this corner grows (+1 right/down, -1 left/up)
  let resizeSy  = 1;
  let startMouseX = 0;
  let startMouseY = 0;
  let startLeft   = 0;
  let startTop    = 0;
  let startSize   = 0;

  // ── Messages from iframe ───────────────────────────────────────────────────
  window.addEventListener("message", (event) => {
    const msg = event.data ?? {};

    if (msg.type === "BLOOM_DRAG_START") {
      dragging = true;
      const rect   = wrapper.getBoundingClientRect();
      startMouseX  = rect.left + msg.clientX;
      startMouseY  = rect.top  + msg.clientY;
      startLeft    = rect.left;
      startTop     = rect.top;
      lockPointer();

    } else if (msg.type === "BLOOM_RESIZE_START") {
      resizing   = true;
      resizeSx   = msg.sx ?? 1;
      resizeSy   = msg.sy ?? 1;
      const rect = wrapper.getBoundingClientRect();
      startMouseX = rect.left + msg.clientX;
      startMouseY = rect.top  + msg.clientY;
      startSize   = currentSize;
      lockPointer();

    } else if (msg.type === "BLOOM_CLOSE") {
      chrome.runtime.sendMessage({ type: "BLOOM_HUD_CLOSED" });
      wrapper.remove();
    }
  });

  function lockPointer() {
    wrapper.style.pointerEvents    = "none";
    document.body.style.userSelect = "none";
  }

  function unlockPointer() {
    wrapper.style.pointerEvents    = "auto";
    document.body.style.userSelect = "";
  }

  // ── Global mousemove / mouseup ─────────────────────────────────────────────
  document.addEventListener("mousemove", (e) => {
    if (resizing) {
      // Apply per-corner signs: right/down corners grow when mouse moves right/down (sx=1),
      // left/top corners grow when mouse moves left/up (sx=-1).
      const dx = (e.clientX - startMouseX) * resizeSx;
      const dy = (e.clientY - startMouseY) * resizeSy;
      applySize(startSize + Math.max(dx, dy));

    } else if (dragging) {
      let newLeft = startLeft + (e.clientX - startMouseX);
      let newTop  = startTop  + (e.clientY - startMouseY);

      // Clamp to viewport
      const rect = wrapper.getBoundingClientRect();
      newLeft = Math.max(0, Math.min(window.innerWidth  - rect.width,  newLeft));
      newTop  = Math.max(0, Math.min(window.innerHeight - rect.height, newTop));

      wrapper.style.left   = `${newLeft}px`;
      wrapper.style.top    = `${newTop}px`;
      wrapper.style.bottom = "auto";
      wrapper.style.right  = "auto";
    }
  });

  document.addEventListener("mouseup", () => {
    if (resizing || dragging) {
      resizing = false;
      dragging = false;
      unlockPointer();
      saveState();
    }
  });
}
