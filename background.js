let isFloatActive = false;
let floatState = null;

async function injectFloatingUI(tabId) {
  if (!isFloatActive || !tabId) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["content.css"]
    });
  } catch (err) {
    // Ignore if already injected or fails (e.g., restricted page)
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch (err) {
    console.warn("Failed to inject script into tab", tabId, err);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  isFloatActive = true;
  await injectFloatingUI(tab.id);

  const params = new URLSearchParams({
    mode: "tab",
    tabId: String(tab.id),
    title: tab.title ?? "Current Tab"
  });

  chrome.tabs.create(
    {
      url: chrome.runtime.getURL(`recorder.html?${params.toString()}`),
      active: false
    }
  );
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (isFloatActive) {
    injectFloatingUI(activeInfo.tabId);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (isFloatActive && changeInfo.status === 'complete') {
    injectFloatingUI(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "BLOOM_SAVE_STATE") {
    floatState = message.state;
  } else if (message.type === "BLOOM_GET_STATE") {
    sendResponse(floatState);
  } else if (message.type === "BLOOM_HUD_CLOSED" || message.type === "BLOOM_DONE") {
    isFloatActive = false;
    floatState = null;
  }
  // Optional but recommended for get_state if we do async
  return false; 
});
