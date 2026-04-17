let isFloatActive = false;
let floatState    = null;
let sourceTabId   = null;
let activeTabId   = null;

async function injectFloatingUI(tabId) {
  if (!isFloatActive || !tabId) return;

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
  } catch (_) { /* restricted page, silently skip */ }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (err) {
    console.warn("[Bloom] Failed to inject into tab", tabId, err);
  }
}

// ── Launch ─────────────────────────────────────────────────────────────────────
// All recording now happens inside the content script (getDisplayMedia + getUserMedia).
// No recorder.html tab needed — Chrome shows permission dialogs in the website context.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  isFloatActive = true;
  sourceTabId   = tab.id;
  activeTabId   = tab.id;

  await injectFloatingUI(tab.id);
});

// ── Re-inject when user switches to the tracked tab ───────────────────────────
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!isFloatActive) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;

  activeTabId = tabId;

  if (tab.status === "complete") {
    await injectFloatingUI(tabId);
  }
});

// ── Re-inject when a tracked tab finishes loading ────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!isFloatActive || changeInfo.status !== "complete") return;
  if (tabId !== activeTabId) return;
  await injectFloatingUI(tabId);
});

// ── State messages ─────────────────────────────────────────────────────────────
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
  }
});
