# Bloom

Bloom is an open-source Chrome extension inspired by Loom. It lets you record your current tab or an entire screen, layer in a draggable circular camera feed, and save the finished video locally as a `.webm`.

## What it does

- Launches from the Chrome extensions toolbar.
- Lets you choose between recording the current tab or your full screen.
- Mixes your webcam and microphone into the finished recording.
- Composites a draggable circular camera bubble directly into the exported video.
- Gives you an in-extension preview, a floating HUD for the live camera and controls, and downloads the recording locally when you stop.

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.
5. Click the Bloom extension icon in Chrome to start recording.

## Project structure

- `manifest.json`: Chrome MV3 manifest.
- `background.js`: Opens a dedicated recorder page when the popup starts a session.
- `popup.html`, `popup.css`, `popup.js`: Extension launcher UI.
- `recorder.html`, `recorder.css`, `recorder.js`: Recording studio, compositing logic, playback, and download.
- The floating HUD uses Chrome's Document Picture-in-Picture support when available.

## Notes

- Bloom currently exports recordings as `.webm`.
- Full-screen recording depends on Chrome's native sharing picker and available system audio options.
- Restart begins a new recording file without asking Chrome to reshare, as long as the original share is still active.
- Chrome requires a direct click to open the floating HUD window in some cases, so Bloom exposes an `Open Floating HUD` button in the recorder.
