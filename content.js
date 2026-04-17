if (!document.getElementById("bloom-floating-ui-wrapper")) {

  // ── Inject UI directly into page ────────────────────────────────────────────
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
      <span id="bloom-error-msg" class="bloom-error-msg bloom-hidden"></span>
    </div>
  `;
  document.body.appendChild(wrapper);

  // ── Element refs ─────────────────────────────────────────────────────────────
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
  const errorMsg        = wrapper.querySelector("#bloom-error-msg");
  const resizeCorners   = wrapper.querySelectorAll(".bloom-resize-corner");

  // ── Size ─────────────────────────────────────────────────────────────────────
  let currentSize = 240;

  function applySize(size) {
    currentSize = Math.max(100, Math.min(600, size));
    wrapper.style.setProperty("--bloom-bubble-size", `${currentSize}px`);
    wrapper.style.width = `${currentSize + 24}px`;
  }

  chrome.runtime.sendMessage({ type: "BLOOM_GET_STATE" }, (state) => {
    if (chrome.runtime.lastError) {}
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

  // ── Camera preview ───────────────────────────────────────────────────────────
  let cameraStream = null;

  async function enumerateDevices() {
    let temp;
    try { temp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch (e) {}
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

  async function startCameraPreview() {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: videoSelect.value
          ? { deviceId: { exact: videoSelect.value }, height: { ideal: 720 } }
          : { height: { ideal: 720 } },
        audio: false
      });
      cameraFeed.srcObject = cameraStream;
    } catch (err) {
      console.error("[Bloom] Camera denied", err);
    }
  }

  function stopCameraPreview() {
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    cameraFeed.srcObject = null;
  }

  videoSelect.addEventListener("change", startCameraPreview);
  enumerateDevices().then(() => startCameraPreview());

  // ── Close ────────────────────────────────────────────────────────────────────
  function closeHUD() {
    stopCameraPreview();
    cleanupRecording();
    chrome.runtime.sendMessage({ type: "BLOOM_HUD_CLOSED" });
    wrapper.remove();
  }
  closeBtn.addEventListener("click", closeHUD);

  // ── Recording helpers ────────────────────────────────────────────────────────
  function getSupportedMimeType() {
    const candidates = [
      "video/webm;codecs=h264,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
  }

  let mediaRecorder  = null;
  let recordedChunks = [];
  let screenStream   = null;
  let micStream      = null;
  let recordAudioCtx = null;
  let composedStream = null;

  function cleanupRecording() {
    screenStream?.getTracks().forEach(t => t.stop());
    micStream?.getTracks().forEach(t => t.stop());
    composedStream?.getTracks().forEach(t => t.stop());
    recordAudioCtx?.close();
    screenStream   = null;
    micStream      = null;
    composedStream = null;
    recordAudioCtx = null;
    mediaRecorder  = null;
    recordedChunks = [];
  }

  function showError(text = "⚠ Could not start recording") {
    showIdleState();
    errorMsg.textContent = text;
    errorMsg.classList.remove("bloom-hidden");
    setTimeout(() => errorMsg.classList.add("bloom-hidden"), 4000);
  }

  function showRecordingState() {
    startBtn.classList.add("bloom-hidden");
    closeBtn.classList.add("bloom-hidden");
    stopBtn.classList.remove("bloom-hidden");
    restartBtn.classList.remove("bloom-hidden");
    deviceSelectors.classList.add("bloom-hidden");
    stopBtn.disabled    = false;
    restartBtn.disabled = false;
    stopBtn.textContent = "■ Stop";
  }

  function showIdleState() {
    startBtn.classList.remove("bloom-hidden");
    closeBtn.classList.remove("bloom-hidden");
    stopBtn.classList.add("bloom-hidden");
    restartBtn.classList.add("bloom-hidden");
    deviceSelectors.classList.remove("bloom-hidden");
    startBtn.disabled    = false;
    startBtn.textContent = "▶ Start";
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

  function buildRecorder(stream) {
    const mimeType = getSupportedMimeType();
    try {
      return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    } catch (e) {
      return new MediaRecorder(stream);
    }
  }

  function downloadBlob(blob) {
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement("a");
    a.href         = url;
    a.download     = `bloom-recording-${Date.now()}.webm`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }

  // ── Start recording ──────────────────────────────────────────────────────────
  // getDisplayMedia + getUserMedia MUST be called within the click handler so
  // Chrome's user-gesture requirement is satisfied. Both are awaited BEFORE the
  // countdown, ensuring streams are ready before recording begins.
  startBtn.addEventListener("click", async () => {
    startBtn.disabled    = true;
    startBtn.textContent = "Setting up…";
    errorMsg.classList.add("bloom-hidden");

    try {
      // 1. Screen/tab capture — Chrome shows its native share picker
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true   // captures tab audio when user picks a browser tab
      });

      // 2. Microphone — Chrome shows the mic permission dialog for this website
      //    (or uses cached permission if already granted)
      try {
        const audioConstraint = audioSelect.value
          ? { deviceId: { exact: audioSelect.value }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true };
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      } catch (e) {
        console.warn("[Bloom] Mic access denied — recording without mic:", e.name);
        // Non-fatal: recording continues with screen audio only
      }

      // 3. Mix screen audio + mic into a single audio track
      recordAudioCtx  = new AudioContext();
      const dest      = recordAudioCtx.createMediaStreamDestination();

      const screenAudioTracks = screenStream.getAudioTracks();
      if (screenAudioTracks.length > 0) {
        recordAudioCtx
          .createMediaStreamSource(new MediaStream(screenAudioTracks))
          .connect(dest);
      }
      if (micStream) {
        const gain = recordAudioCtx.createGain();
        gain.gain.value = 1;
        recordAudioCtx.createMediaStreamSource(micStream).connect(gain).connect(dest);
      }

      // 4. Composed stream: screen video + mixed audio
      composedStream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      // If user stops sharing via the browser's own "Stop sharing" button
      screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecording();
      }, { once: true });

    } catch (err) {
      cleanupRecording();
      if (err.name !== "AbortError" && err.name !== "NotAllowedError") {
        console.error("[Bloom] Setup error:", err);
      }
      showError(
        err.name === "NotAllowedError" ? "⚠ Permission denied" : "⚠ Screen share cancelled"
      );
      return;
    }

    // 5. Count down, then start MediaRecorder
    runCountdown(() => {
      showRecordingState();
      recordedChunks = [];
      mediaRecorder  = buildRecorder(composedStream);
      mediaRecorder.addEventListener("dataavailable", e => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      });
      mediaRecorder.start(1000);
    });
  });

  // ── Stop recording ───────────────────────────────────────────────────────────
  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    stopBtn.disabled    = true;
    restartBtn.disabled = true;
    stopBtn.textContent = "Stopping…";

    mediaRecorder.addEventListener("stop", () => {
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "video/webm" });
      cleanupRecording();
      downloadBlob(blob);
      closeHUD();
    }, { once: true });

    mediaRecorder.stop();
  }
  stopBtn.addEventListener("click", stopRecording);

  // ── Restart recording ────────────────────────────────────────────────────────
  function restartRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    restartBtn.disabled = true;
    stopBtn.disabled    = true;

    mediaRecorder.addEventListener("stop", () => {
      recordedChunks = [];
      mediaRecorder  = buildRecorder(composedStream);
      mediaRecorder.addEventListener("dataavailable", e => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      });
      mediaRecorder.start(1000);
      stopBtn.disabled    = false;
      stopBtn.textContent = "■ Stop";
      restartBtn.disabled = false;
    }, { once: true });

    mediaRecorder.stop();
  }
  restartBtn.addEventListener("click", restartRecording);

  // ── Drag & Resize ────────────────────────────────────────────────────────────
  let dragging  = false;
  let resizing  = false;
  let resizeSx  = 1;
  let resizeSy  = 1;
  let startMouseX = 0, startMouseY = 0;
  let startLeft = 0, startTop = 0;
  let startSize = 0;

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
