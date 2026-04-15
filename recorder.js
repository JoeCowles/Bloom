const params = new URLSearchParams(window.location.search);
const targetTabId = Number(params.get("tabId")) || null;

let state = {
  recording: false,
  recorder: null,
  recordedChunks: [],
  displayStream: null,
  micStream: null,
  mixedAudioStream: null,
  composedStream: null,
  outputUrl: "",
  audioContext: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RECORDING") {
    beginRecording({ audioDeviceId: message.audioDeviceId }).catch(console.error);
  } else if (message.type === "STOP_RECORDING") {
    stopRecording();
  } else if (message.type === "RESTART_RECORDING") {
    restartRecording({ audioDeviceId: message.audioDeviceId })
      .then(() => {
        // Let floating UI know the new recording is live so it can re-enable buttons
        chrome.runtime.sendMessage({ type: "BLOOM_RECORDING_RESTARTED" }).catch(() => {});
      })
      .catch(console.error);
  }
});

async function beginRecording({ audioDeviceId } = {}) {
  if (state.recording) return;

  try {
    state.displayStream = await getDisplayStream();

    try {
      const audioConstraints = audioDeviceId
        ? { deviceId: { exact: audioDeviceId }, echoCancellation: true, noiseSuppression: true }
        : { echoCancellation: true, noiseSuppression: true };
      state.micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (err) {
      console.warn("Could not get microphone:", err);
    }

    state.mixedAudioStream = mixAudio(state.displayStream, state.micStream);

    const videoTracks = state.displayStream.getVideoTracks();
    const audioTracks = state.mixedAudioStream.getAudioTracks();
    state.composedStream = new MediaStream([...videoTracks, ...audioTracks]);

    state.recordedChunks = [];
    state.recorder = new MediaRecorder(state.composedStream, { videoBitsPerSecond: 6_000_000 });
    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.recordedChunks.push(event.data);
    });

    state.recorder.start(1000);
    state.recording = true;

    // If the user explicitly stops sharing via the browser bar, treat it as a stop
    videoTracks[0].addEventListener("ended", () => stopRecording(), { once: true });
  } catch (err) {
    console.error("Failed to start recording", err);
  }
}

async function restartRecording({ audioDeviceId } = {}) {
  // Discard current recording without saving
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

  // Reuse the existing display + audio streams — no new OS picker
  if (state.displayStream) {
    state.recordedChunks = [];
    const videoTracks = state.displayStream.getVideoTracks();
    const audioTracks = state.mixedAudioStream?.getAudioTracks() ?? [];
    state.composedStream = new MediaStream([...videoTracks, ...audioTracks]);
    state.recorder = new MediaRecorder(state.composedStream, { videoBitsPerSecond: 6_000_000 });
    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.recordedChunks.push(event.data);
    });
    state.recorder.start(1000);
    state.recording = true;
  } else {
    await beginRecording({ audioDeviceId });
  }
}

async function stopRecording() {
  console.log("[Bloom] stopRecording called. recorder state:", state.recorder?.state);
  if (!state.recorder || state.recorder.state === "inactive") {
    console.warn("[Bloom] recorder not active, bailing.");
    return;
  }

  // Register the 'stop' listener BEFORE calling .stop(), otherwise the event
  // may fire before the listener is attached (and we deadlock on the await).
  const stoppedPromise = new Promise(resolve => {
    state.recorder.addEventListener("stop", async () => {
      console.log("[Bloom] recorder 'stop' event fired.");
      state.recording = false;

      const mimeType = state.recorder.mimeType || "video/webm";
      console.log("[Bloom] building blob — chunks:", state.recordedChunks.length, "mimeType:", mimeType);
      const blob = new Blob(state.recordedChunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      state.outputUrl = url;
      console.log("[Bloom] blob URL ready, size:", blob.size);

      // Kill all streams so the OS camera/mic indicator disappears immediately
      cleanupAll();
      console.log("[Bloom] cleanupAll done.");

      // Tell the floating UI to close
      chrome.runtime.sendMessage({ type: "BLOOM_DONE" })
        .catch(e => console.warn("[Bloom] BLOOM_DONE send failed:", e));

      // Open Save dialog — tab must stay alive until user picks a location
      console.log("[Bloom] calling chrome.downloads.download with saveAs: true...");
      let downloadId;
      try {
        downloadId = await new Promise((res, rej) => {
          chrome.downloads.download(
            { url, filename: `bloom-recording-${Date.now()}.webm`, saveAs: true },
            (id) => {
              if (chrome.runtime.lastError) {
                console.error("[Bloom] download callback error:", chrome.runtime.lastError.message);
                rej(new Error(chrome.runtime.lastError.message));
              } else {
                console.log("[Bloom] download id created:", id);
                res(id);
              }
            }
          );
        });
      } catch (err) {
        console.error("[Bloom] download failed:", err);
        chrome.tabs.getCurrent(tab => { if (tab?.id) chrome.tabs.remove(tab.id); });
        resolve();
        return;
      }

      // Wait until user confirms save location (download goes in_progress), then close tab
      const onDownloadChanged = (delta) => {
        if (delta.id !== downloadId) return;
        console.log("[Bloom] download delta — id:", delta.id, "state:", delta.state, "error:", delta.error);
        const next = delta.state?.current;
        if (next === "in_progress" || next === "complete" || delta.error) {
          chrome.downloads.onChanged.removeListener(onDownloadChanged);
          console.log("[Bloom] closing recorder tab.");
          chrome.tabs.getCurrent(tab => { if (tab?.id) chrome.tabs.remove(tab.id); });
        }
      };
      chrome.downloads.onChanged.addListener(onDownloadChanged);

      resolve();
    }, { once: true });
  });

  // Call .stop() AFTER the listener is in place, but BEFORE the await
  console.log("[Bloom] calling recorder.stop()...");
  state.recorder.stop();

  await stoppedPromise;
  console.log("[Bloom] stopRecording fully complete.");
}



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
  const ctx = state.audioContext;
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
  for (const stream of [state.displayStream, state.micStream, state.mixedAudioStream, state.composedStream]) {
    stream?.getTracks().forEach(t => t.stop());
  }
  state.displayStream = null;
  state.micStream = null;
  state.mixedAudioStream = null;
  state.composedStream = null;
  state.recorder = null;
  state.recordedChunks = [];
  if (state.audioContext) {
    state.audioContext.close();
    state.audioContext = null;
  }
}
