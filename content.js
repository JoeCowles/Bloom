if (!document.getElementById("bloom-floating-ui-wrapper")) {

  // ── Wrapper & Iframe ───────────────────────────────────────────────────────
  const wrapper = document.createElement("div");
  wrapper.id = "bloom-floating-ui-wrapper";

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("floating.html");
  iframe.id = "bloom-floating-ui";
  iframe.allow = "camera; microphone; display-capture";
  wrapper.appendChild(iframe);

  // ── Resize Slider (lives in parent page, not iframe) ──────────────────────
  const resizeBar = document.createElement("div");
  resizeBar.id = "bloom-resize-bar";
  resizeBar.innerHTML = `
    <span id="bloom-resize-label">⬤</span>
    <input id="bloom-resize-slider" type="range" min="100" max="500" value="240" step="4" />
  `;
  wrapper.appendChild(resizeBar);

  document.body.appendChild(wrapper);

  // ── Resize logic ───────────────────────────────────────────────────────────
  const slider = wrapper.querySelector("#bloom-resize-slider");

  function applySize(size) {
    wrapper.style.width  = `${size + 24}px`;
    // iframe height = bubble + device selectors (96px) + controls (60px) + padding
    iframe.style.height  = `${size + 160}px`;
    wrapper.style.height = `${size + 160 + 36}px`; // +36 for resize bar
    iframe.contentWindow?.postMessage({ type: "BLOOM_RESIZE_UPDATE", size }, "*");
  }

  slider.addEventListener("input", () => applySize(Number(slider.value)));

  // Set initial size
  applySize(240);

  // ── Drag logic (fully parent-side) ────────────────────────────────────────
  let dragging = false;
  let dragStartMouseX = 0;
  let dragStartMouseY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;

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
      wrapper.remove();
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;

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
  });

  document.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      wrapper.style.pointerEvents = "auto";
      document.body.style.userSelect = "";
    }
  });
}
