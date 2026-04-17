if (!document.getElementById("bloom-floating-ui-wrapper")) {

  // ── Wrapper & Iframe ───────────────────────────────────────────────────────
  const wrapper = document.createElement("div");
  wrapper.id = "bloom-floating-ui-wrapper";

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("floating.html");
  iframe.id = "bloom-floating-ui";
  iframe.allow = "camera; microphone; display-capture";
  wrapper.appendChild(iframe);

  // ── Resize Handle ──────────────────────────────────────────────────────────
  const resizeHandle = document.createElement("div");
  resizeHandle.id = "bloom-resize-handle";
  wrapper.appendChild(resizeHandle);

  document.body.appendChild(wrapper);

  // ── State & Resizing logic ─────────────────────────────────────────────────
  let currentSize = 240;

  function applySize(size) {
    currentSize = Math.max(100, Math.min(600, size));
    wrapper.style.width  = `${currentSize + 24}px`;
    iframe.style.height  = `${currentSize + 160}px`;
    wrapper.style.height = `${currentSize + 160}px`;
    iframe.contentWindow?.postMessage({ type: "BLOOM_RESIZE_UPDATE", size: currentSize }, "*");
    
    // Position handle at bottom right of the circular bubble
    resizeHandle.style.bottom = `160px`;
  }

  // Restore State
  chrome.runtime.sendMessage({ type: "BLOOM_GET_STATE" }, (state) => {
    if (state) {
      applySize(state.size || 240);
      if (typeof state.left === 'number') wrapper.style.left = `${state.left}px`;
      if (typeof state.top === 'number') {
        wrapper.style.top = `${state.top}px`;
        wrapper.style.bottom = "auto";
      }
    } else {
      applySize(240);
    }
  });

  // Helper to save state
  function saveState() {
    const rect = wrapper.getBoundingClientRect();
    chrome.runtime.sendMessage({
      type: "BLOOM_SAVE_STATE",
      state: { left: rect.left, top: rect.top, size: currentSize }
    });
  }

  // ── Drag & Resize Interaction ──────────────────────────────────────────────
  let dragging = false;
  let resizing = false;
  let dragStartMouseX = 0;
  let dragStartMouseY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;
  let dragStartSize = 0;

  resizeHandle.addEventListener("mousedown", (e) => {
    resizing = true;
    dragStartMouseX = e.clientX;
    dragStartMouseY = e.clientY;
    dragStartSize = currentSize;
    wrapper.style.pointerEvents = "none";
    document.body.style.userSelect = "none";
    e.preventDefault();
    e.stopPropagation();
  });

  // iframe signals drag start; parent takes over from here
  window.addEventListener("message", (event) => {
    const { type } = event.data ?? {};

    if (type === "BLOOM_DRAG_START") {
      dragging = true;
      const rect = wrapper.getBoundingClientRect();

      // Absolute mouse pos = iframe rect origin + iframe-local coords
      dragStartMouseX = rect.left  + event.data.clientX;
      dragStartMouseY = rect.top   + event.data.clientY;
      dragStartLeft   = rect.left;
      dragStartTop    = rect.top;

      wrapper.style.pointerEvents = "none";
      document.body.style.userSelect = "none";

    } else if (type === "BLOOM_CLOSE") {
      chrome.runtime.sendMessage({ type: "BLOOM_HUD_CLOSED" });
      wrapper.remove();
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (resizing) {
      // Calculate delta diagonally, but prefer X distance for smooth width scaling
      const deltaX = e.clientX - dragStartMouseX;
      applySize(dragStartSize + deltaX);
    } else if (dragging) {
      let newLeft = dragStartLeft + (e.clientX - dragStartMouseX);
      let newTop  = dragStartTop  + (e.clientY - dragStartMouseY);

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
      wrapper.style.pointerEvents = "auto";
      document.body.style.userSelect = "";
      saveState();
    }
  });
}
