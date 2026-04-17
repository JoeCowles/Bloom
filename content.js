if (!document.getElementById("bloom-floating-ui-wrapper")) {

  // ── Inject UI directly into page (no iframe = truly transparent) ───────────
  const wrapper = document.createElement("div");
  wrapper.id = "bloom-floating-ui-wrapper";
  wrapper.innerHTML = `
    <div class="bloom-camera-container" id="bloom-camera-container">
      <div class="bloom-camera-feed-wrapper">
        <video id="bloom-camera-feed" autoplay playsinline muted></video>
        <div id="bloom-countdown" class="bloom-countdown bloom-hidden">3</div>
      </div>
      <div class="bloom-resize-corner" data-sx="-1" data-sy="-1" style="top:0;left:0;cursor:nwse-resize;"></div>
      <div class="bloom-resize-corner" data-sx="1"  data-sy="-1" style="top:0;right:0;cursor:nesw-resize;"></div>
      <div class="bloom-resize-corner" data-sx="-1" data-sy="1"  style="bottom:0;left:0;cursor:nesw-resize;"></div>
      <div class="bloom-resize-corner" data-sx="1"  data-sy="1"  style="bottom:0;right:0;cursor:nwse-resize;"></div>
    </div>
    <div class="bloom-device-selectors" id="bloom-device-selectors">
      <div class="bloom-select-row">
        <span class="bloom-select-icon">🎥</span>
        <select id="bloom-video-select"></select>
      </div>
      <div class="bloom-select-row">
        <span class="bloom-select-icon">🎙</span>
        <select id="bloom-audio-select"></select>
      </div>
    </div>
    <div class="bloom-controls-container">
      <button id="bloom-close-btn" class="bloom-ghost bloom-close-btn" title="Close">✕</button>
      <button id="bloom-start-btn" class="bloom-primary">▶ Start</button>
      <button id="bloom-restart-btn" class="bloom-ghost bloom-hidden">↺ Restart</button>
      <button id="bloom-stop-btn" class="bloom-danger bloom-hidden">■ Stop</button>
    </div>
  `;
  document.body.appendChild(wrapper);

  // ── Element refs ──────────────────────────────────────────────────────────
  const cameraContainer = wrapper.querySelector("#bloom-camera-container");
  const cameraFeed      = wrapper.querySelector("#bloom-camera-feed");
  const countdownEl     = wrapper.querySelector("#bloom-countdown");
  const deviceSelectors = wrapper.querySelector("#bloom-device-selectors");
  const videoSelect     = wrapper.querySelector("#bloom-video-select");
  const audioSelect     = wrapper.querySelector("#bloom-audio-select");
  const closeBtn        = wrapper.querySelector("#bloom-close-btn");
  const startBtn        = wrapper.querySelector("#bloom-start-btn");
  const stopBtn         = wrapper.querySelector("#bloom-stop-btn");
  const restartBtn      = wrapper.querySelector("#bloom-restart-btn");
  const resizeCorners   = wrapper.querySelectorAll(".bloom-resize-corner");

  // ── Size ──────────────────────────────────────────────────────────────────
  let currentSize = 240;

  function applySize(size) {
    currentSize = Math.max(100, Math.min(600, size));
    wrapper.style.setProperty("--bloom-bubble-size", `${currentSize}px`);
    // wrapper width = bubble + small horizontal padding
    wrapper.style.width = `${currentSize + 24}px`;
  }

  // Restore previously saved position & size
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

  // ── Camera ────────────────────────────────────────────────────────────────
  let currentStream = null;

  async function enumerateDevices() {
    let temp;
    try { temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch (e) { /* ok */ }
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (temp) temp.getTracks().forEach(t => t.stop());

    const fill = (sel, kind, fb) => {
      sel.innerHTML = "";
      devices.filter(d => d.kind === kind).forEach((d, i) => {
        const o = document.createElement("option");
        o.value = d.deviceId;
        o.textContent = d.label || `${fb} ${i + 1}`;
        sel.appendChild(o);
      });
    };
    fill(videoSelect, "videoinput", "Camera");
    fill(audioSelect, "audioinput", "Microphone");
  }

  async function startCamera() {
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({
        video: videoSelect.value
          ? { deviceId: { exact: videoSelect.value }, height: { ideal: 720 } }
          : { height: { ideal: 720 } },
        audio: false
      });
      cameraFeed.srcObject = currentStream;
    } catch (err) {
      console.error("[Bloom] Camera denied", err);
    }
  }

  function stopCamera() {
    if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
    cameraFeed.srcObject = null;
  }

  videoSelect.addEventListener("change", startCamera);
  enumerateDevices().then(() => startCamera());

  // ── Close ─────────────────────────────────────────────────────────────────
  function closeHUD() {
    stopCamera();
    chrome.runtime.sendMessage({ type: "BLOOM_HUD_CLOSED" });
    wrapper.remove();
  }
  closeBtn.addEventListener("click", closeHUD);

  // ── Recording state UI ────────────────────────────────────────────────────
  function showRecordingState() {
    startBtn.classList.add("bloom-hidden");
    closeBtn.classList.add("bloom-hidden");
    stopBtn.classList.remove("bloom-hidden");
    restartBtn.classList.remove("bloom-hidden");
    deviceSelectors.classList.add("bloom-hidden");
  }

  function showIdleState() {
    startBtn.classList.remove("bloom-hidden");
    closeBtn.classList.remove("bloom-hidden");
    stopBtn.classList.add("bloom-hidden");
    restartBtn.classList.add("bloom-hidden");
    deviceSelectors.classList.remove("bloom-hidden");
    startBtn.disabled = false;
  }

  function runCountdown(callback) {
    let count = 3;
    countdownEl.textContent = count;
    countdownEl.classList.remove("bloom-hidden");
    const iv = setInterval(() => {
      count--;
      if (count > 0) {
        countdownEl.textContent = count;
      } else {
        clearInterval(iv);
        countdownEl.classList.add("bloom-hidden");
        callback();
      }
    }, 1000);
  }

  startBtn.addEventListener("click", () => {
    startBtn.disabled = true;
    runCountdown(() => {
      showRecordingState();
      chrome.runtime.sendMessage({ type: "START_RECORDING", audioDeviceId: audioSelect.value || null });
    });
  });

  stopBtn.addEventListener("click", () => {
    stopBtn.disabled = true;
    restartBtn.disabled = true;
    stopBtn.textContent = "Stopping…";
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  });

  restartBtn.addEventListener("click", () => {
    restartBtn.disabled = true;
    stopBtn.disabled = true;
    chrome.runtime.sendMessage({ type: "RESTART_RECORDING", audioDeviceId: audioSelect.value || null });
    showIdleState();
    requestAnimationFrame(() => startBtn.click());
  });

  // ── Messages relayed from background (originally from recorder.js) ─────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "BLOOM_DONE") {
      stopCamera();
      wrapper.remove();
    } else if (message.type === "BLOOM_RECORDING_RESTARTED") {
      stopBtn.disabled = false;
      stopBtn.textContent = "■ Stop";
      restartBtn.disabled = false;
    }
  });

  // ── Drag & Resize ─────────────────────────────────────────────────────────
  let dragging  = false;
  let resizing  = false;
  let resizeSx  = 1;
  let resizeSy  = 1;
  let startMouseX = 0, startMouseY = 0;
  let startLeft = 0, startTop = 0;
  let startSize = 0;

  // Drag: mousedown anywhere on the camera bubble (not a resize corner)
  cameraContainer.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("bloom-resize-corner")) return;
    dragging = true;
    const rect  = wrapper.getBoundingClientRect();
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startLeft   = rect.left;
    startTop    = rect.top;
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  // Resize: mousedown on any corner
  resizeCorners.forEach((corner) => {
    corner.addEventListener("mousedown", (e) => {
      resizing    = true;
      resizeSx    = Number(corner.dataset.sx);
      resizeSy    = Number(corner.dataset.sy);
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      startSize   = currentSize;
      document.body.style.userSelect = "none";
      e.preventDefault();
      e.stopPropagation();
    });
  });

  document.addEventListener("mousemove", (e) => {
    if (resizing) {
      const dx = (e.clientX - startMouseX) * resizeSx;
      const dy = (e.clientY - startMouseY) * resizeSy;
      applySize(startSize + Math.max(dx, dy));
    } else if (dragging) {
      let newLeft = startLeft + (e.clientX - startMouseX);
      let newTop  = startTop  + (e.clientY - startMouseY);
      const rect  = wrapper.getBoundingClientRect();
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
      resizing = dragging = false;
      document.body.style.userSelect = "";
      saveState();
    }
  });
}
