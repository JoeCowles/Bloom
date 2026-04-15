const cameraFeed      = document.getElementById("camera-feed");
const cameraContainer = document.getElementById("camera-container");
const countdownEl     = document.getElementById("countdown");
const startBtn        = document.getElementById("start-btn");
const stopBtn         = document.getElementById("stop-btn");
const restartBtn      = document.getElementById("restart-btn");
const videoSelect     = document.getElementById("video-select");
const audioSelect     = document.getElementById("audio-select");
const deviceSelectors = document.getElementById("device-selectors");

let currentStream = null;

// ── Device Enumeration ────────────────────────────────────────────────────────

async function enumerateDevices() {
  let tempStream;
  try { tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
  catch (e) { /* labels may be empty without a prior grant */ }

  const devices = await navigator.mediaDevices.enumerateDevices();
  if (tempStream) tempStream.getTracks().forEach(t => t.stop());

  const fill = (selectEl, kind, fallback) => {
    selectEl.innerHTML = "";
    devices.filter(d => d.kind === kind).forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `${fallback} ${i + 1}`;
      selectEl.appendChild(opt);
    });
  };

  fill(videoSelect, "videoinput", "Camera");
  fill(audioSelect, "audioinput", "Microphone");
}

async function startCamera() {
  if (currentStream) currentStream.getTracks().forEach(t => t.stop());
  try {
    const constraints = {
      video: videoSelect.value
        ? { deviceId: { exact: videoSelect.value }, height: { ideal: 720 } }
        : { height: { ideal: 720 } },
      audio: false
    };
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraFeed.srcObject = currentStream;
  } catch (err) {
    console.error("Camera access denied", err);
  }
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  cameraFeed.srcObject = null;
}

videoSelect.addEventListener("change", startCamera);
enumerateDevices().then(() => startCamera());

// ── Drag signal to parent ─────────────────────────────────────────────────────

cameraContainer.addEventListener("mousedown", (e) => {
  window.parent.postMessage({
    type: "BLOOM_DRAG_START",
    clientX: e.clientX,
    clientY: e.clientY
  }, "*");
  e.preventDefault();
});

// ── Resize signal from parent ─────────────────────────────────────────────────

window.addEventListener("message", (e) => {
  if (e.data?.type === "BLOOM_RESIZE_UPDATE") {
    document.documentElement.style.setProperty("--bubble-size", `${e.data.size}px`);
  }
});

// ── Runtime messages from recorder.js ────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "BLOOM_DONE") {
    // Recording saved — stop camera and remove ourselves from the page
    stopCamera();
    window.parent.postMessage({ type: "BLOOM_CLOSE" }, "*");
  } else if (message.type === "BLOOM_RECORDING_RESTARTED") {
    // New recording is live — re-enable Stop and Restart
    stopBtn.disabled = false;
    stopBtn.textContent = "■ Stop";
    restartBtn.disabled = false;
  }
});

// ── Recording Controls ────────────────────────────────────────────────────────

function showRecordingState() {
  startBtn.classList.add("hidden");
  stopBtn.classList.remove("hidden");
  restartBtn.classList.remove("hidden");
  deviceSelectors.classList.add("hidden");
}

function showIdleState() {
  startBtn.classList.remove("hidden");
  stopBtn.classList.add("hidden");
  restartBtn.classList.add("hidden");
  deviceSelectors.classList.remove("hidden");
  startBtn.disabled = false;
}

function runCountdown(callback) {
  let count = 3;
  countdownEl.textContent = count;
  countdownEl.classList.remove("hidden");

  const iv = setInterval(() => {
    count--;
    if (count > 0) {
      countdownEl.textContent = count;
    } else {
      clearInterval(iv);
      countdownEl.classList.add("hidden");
      callback();
    }
  }, 1000);
}

startBtn.addEventListener("click", () => {
  startBtn.disabled = true;
  runCountdown(() => {
    showRecordingState();
    chrome.runtime.sendMessage({
      type: "START_RECORDING",
      audioDeviceId: audioSelect.value || null
    });
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
  // Tell recorder to restart — it will broadcast BLOOM_RECORDING_RESTARTED when ready
  chrome.runtime.sendMessage({ type: "RESTART_RECORDING", audioDeviceId: audioSelect.value || null });
  // Reset the UI into countdown immediately
  showIdleState();
  requestAnimationFrame(() => startBtn.click());
});
