const params      = new URLSearchParams(window.location.search);
const targetTabId = Number(params.get("tabId")) || null;

let state = {
  recording: false,
  recorder: null,
  recordedChunks: [],
  displayStream: null,
  micStream: null,
  mixedAudioStream: null,
  composedStream: null,
  audioContext: null
};

// ── MIME detection ─────────────────────────────────────────────────────────────
// Chrome does NOT support video/mp4 in MediaRecorder — pick the best webm codec.
function getSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=h264,opus",
    "video/webm;codecs=h264",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
}

// ── Mic permission warmup ──────────────────────────────────────────────────────
// recorder.html is opened briefly as the active tab so Chrome can show the
// mic permission dialog. Once the user grants it (or it's already cached),
// we release the test stream and tell the background to switch back to the
// user's original tab.
navigator.mediaDevices.getUserMedia({ audio: true, video: false })
  .then(stream => {
    stream.getTracks().forEach(t => t.stop());
    chrome.runtime.sendMessage({ type: "BLOOM_PERMISSION_READY" }).catch(() => {});
  })
  .catch(err => {
    console.warn("[Bloom] Mic permission warmup failed:", err.name);
    // Still notify background so it can switch back regardless
    chrome.runtime.sendMessage({ type: "BLOOM_PERMISSION_READY" }).catch(() => {});
  });

// ── Message handling ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "START_RECORDING") {
    beginRecording({ audioDeviceId: message.audioDeviceId })
      .catch(err => {
        console.error("[Bloom] beginRecording failed:", err);
        chrome.runtime.sendMessage({
          type: "BLOOM_RECORDING_ERROR",
          error: err.message ?? String(err)
        }).catch(() => {});
      });

  } else if (message.type === "STOP_RECORDING") {
    stopRecording();

  } else if (message.type === "RESTART_RECORDING") {
    restartRecording({ audioDeviceId: message.audioDeviceId })
      .then(() => {
        chrome.runtime.sendMessage({ type: "BLOOM_RECORDING_RESTARTED" }).catch(() => {});
      })
      .catch(err => {
        console.error("[Bloom] restartRecording failed:", err);
        chrome.runtime.sendMessage({
          type: "BLOOM_RECORDING_ERROR",
          error: err.message ?? String(err)
        }).catch(() => {});
      });
  }
});

// ── Begin recording ────────────────────────────────────────────────────────────
async function beginRecording({ audioDeviceId } = {}) {
  if (state.recording) return;

  state.displayStream = await getDisplayStream();

  try {
    const audioConstraints = audioDeviceId
      ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true };
    state.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  } catch (err) {
    console.warn("[Bloom] Could not get microphone:", err);
  }

  state.mixedAudioStream = mixAudio(state.displayStream, state.micStream);

  const videoTracks = state.displayStream.getVideoTracks();
  const audioTracks = state.mixedAudioStream.getAudioTracks();
  state.composedStream = new MediaStream([...videoTracks, ...audioTracks]);

  const mimeType = getSupportedMimeType();
  console.log("[Bloom] Using mimeType:", mimeType);

  // MediaRecorder() throws DOMException for unsupported types — let it propagate
  state.recordedChunks = [];
  state.recorder = new MediaRecorder(state.composedStream, {
    mimeType,
    videoBitsPerSecond: 6_000_000
  });
  state.recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) state.recordedChunks.push(e.data);
  });

  state.recorder.start(1000);
  state.recording = true;

  videoTracks[0].addEventListener("ended", () => stopRecording(), { once: true });
}

// ── Restart recording ──────────────────────────────────────────────────────────
async function restartRecording({ audioDeviceId } = {}) {
  if (state.recorder && state.recorder.state !== "inactive") {
    await new Promise(resolve => {
      state.recorder.addEventListener("stop", () => {
        state.recording = false;
        state.recordedChunks = [];
        resolve();
      }, { once: true });
      state.recorder.stop();
    });
  }

  if (state.displayStream) {
    state.recordedChunks = [];
    const mimeType    = getSupportedMimeType();
    const videoTracks = state.displayStream.getVideoTracks();
    const audioTracks = state.mixedAudioStream?.getAudioTracks() ?? [];
    state.composedStream = new MediaStream([...videoTracks, ...audioTracks]);
    state.recorder = new MediaRecorder(state.composedStream, {
      mimeType,
      videoBitsPerSecond: 6_000_000
    });
    state.recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) state.recordedChunks.push(e.data);
    });
    state.recorder.start(1000);
    state.recording = true;
  } else {
    await beginRecording({ audioDeviceId });
  }
}

// ── Stop & download ────────────────────────────────────────────────────────────
async function stopRecording() {
  console.log("[Bloom] stopRecording called. recorder state:", state.recorder?.state);
  if (!state.recorder || state.recorder.state === "inactive") {
    console.warn("[Bloom] recorder not active, bailing.");
    return;
  }

  const stoppedPromise = new Promise(resolve => {
    state.recorder.addEventListener("stop", async () => {
      console.log("[Bloom] recorder 'stop' event fired.");
      state.recording = false;

      const mimeType = state.recorder.mimeType || "video/webm";
      const blob     = new Blob(state.recordedChunks, { type: mimeType });
      const url      = URL.createObjectURL(blob);
      console.log("[Bloom] blob URL ready, size:", blob.size);

      cleanupAll();

      // Tell the floating UI recording is done
      chrome.runtime.sendMessage({ type: "BLOOM_DONE" })
        .catch(e => console.warn("[Bloom] BLOOM_DONE send failed:", e));

      // Open Save dialog
      console.log("[Bloom] calling chrome.downloads.download...");
      let downloadId;
      try {
        downloadId = await new Promise((res, rej) => {
          chrome.downloads.download(
            { url, filename: `bloom-recording-${Date.now()}.webm`, saveAs: true },
            (id) => {
              if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
              else res(id);
            }
          );
        });
      } catch (err) {
        console.error("[Bloom] download failed:", err);
        chrome.tabs.getCurrent(tab => { if (tab?.id) chrome.tabs.remove(tab.id); });
        resolve();
        return;
      }

      // Wait until user confirms save location then close tab
      const onDownloadChanged = (delta) => {
        if (delta.id !== downloadId) return;
        const next = delta.state?.current;
        if (next === "in_progress" || next === "complete" || delta.error) {
          chrome.downloads.onChanged.removeListener(onDownloadChanged);
          chrome.tabs.getCurrent(tab => { if (tab?.id) chrome.tabs.remove(tab.id); });
        }
      };
      chrome.downloads.onChanged.addListener(onDownloadChanged);

      resolve();
    }, { once: true });
  });

  console.log("[Bloom] calling recorder.stop()...");
  state.recorder.stop();
  await stoppedPromise;
  console.log("[Bloom] stopRecording fully complete.");
}

// ── Helpers ────────────────────────────────────────────────────────────────────
async function getDisplayStream() {
  if (!targetTabId) throw new Error("No target tab");

  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });

  return navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
    video: { mandatory: {
      chromeMediaSource: "tab",
      chromeMediaSourceId: streamId,
      maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30
    }}
  });
}

function mixAudio(displayStream, micStream) {
  state.audioContext = new AudioContext();
  const ctx  = state.audioContext;
  const dest = ctx.createMediaStreamDestination();

  const displayTracks = displayStream?.getAudioTracks() ?? [];
  if (displayTracks.length > 0) {
    ctx.createMediaStreamSource(new MediaStream(displayTracks)).connect(dest);
  }

  const micTracks = micStream?.getAudioTracks() ?? [];
  if (micTracks.length > 0) {
    const gain = ctx.createGain();
    gain.gain.value = 1;
    ctx.createMediaStreamSource(new MediaStream(micTracks)).connect(gain).connect(dest);
  }

  return dest.stream;
}

function cleanupAll() {
  state.recording = false;
  for (const s of [state.displayStream, state.micStream, state.mixedAudioStream, state.composedStream]) {
    s?.getTracks().forEach(t => t.stop());
  }
  state.displayStream    = null;
  state.micStream        = null;
  state.mixedAudioStream = null;
  state.composedStream   = null;
  state.recorder         = null;
  state.recordedChunks   = [];
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
}
