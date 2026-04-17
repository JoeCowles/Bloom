let isFloatActive = false;
let floatState    = null;
let sourceTabId   = null; // the tab the user launched Bloom from

async function injectFloatingUI(tabId) {
  if (!isFloatActive || !tabId) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });
  } catch (_) { /* restricted page, silently skip */ }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (err) {
    console.warn("[Bloom] Failed to inject script into tab", tabId, err);
  }
}

// ── Launch ─────────────────────────────────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  isFloatActive = true;
  sourceTabId   = tab.id;
  activeTabId   = tab.id;   // ← track the launch tab immediately
  await injectFloatingUI(tab.id);

  const params = new URLSearchParams({
    mode:  "tab",
    tabId: String(tab.id),
    title: tab.title ?? "Current Tab"
  });

  chrome.tabs.create({
    url:    chrome.runtime.getURL(`recorder.html?${params.toString()}`),
    active: false
  });
});

// ── Re-inject when the user switches to a DIFFERENT tab ───────────────────────
// When the user tabs away, we inject the HUD into the newly active tab,
// and save the "active" HUD tab so next activation we inject there too.
let activeTabId = null;

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!isFloatActive) return;

  // Don't inject into the hidden recorder.html tab
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const recorderUrl = chrome.runtime.getURL("recorder.html");
  if (tab.url && tab.url.startsWith(recorderUrl)) return;

  activeTabId = tabId;

  // If the tab page is already fully loaded, inject now.
  // If it's still loading, onUpdated will catch it.
  if (tab.status === "complete") {
    await injectFloatingUI(tabId);
  }
});

// ── Re-inject when a page finishes loading in the active tab ──────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!isFloatActive || changeInfo.status !== "complete") return;
  if (tabId !== activeTabId) return;

  // Don't inject into the recorder tab
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const recorderUrl = chrome.runtime.getURL("recorder.html");
  if (tab.url && tab.url.startsWith(recorderUrl)) return;

  await injectFloatingUI(tabId);
});

// ── State messages & recorder relay ───────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "BLOOM_SAVE_STATE") {
    floatState = message.state;

  } else if (message.type === "BLOOM_GET_STATE") {
    sendResponse(floatState);
    return true;

  } else if (message.type === "BLOOM_HUD_CLOSED") {
    isFloatActive = false;
    floatState    = null;
    sourceTabId   = null;
    activeTabId   = null;

  // ── Relay recorder events to the content script in the active tab ──────────
  // recorder.js lives in its own extension page (recorder.html tab) and can't
  // directly message a content script.  The background acts as the relay.
  } else if (
    message.type === "BLOOM_DONE" ||
    message.type === "BLOOM_RECORDING_RESTARTED"
  ) {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: message.type }).catch(() => {});
    }
  }
});

