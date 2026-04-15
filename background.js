chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content.css"]
    });
  } catch (err) {
    // Ignore if already injected or fails
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
  } catch (err) {
    console.error("Failed to inject script", err);
    // User clicked on a restricted page (like chrome://extensions or new tab)
    chrome.tabs.create({ url: 'data:text/html,<h1>Bloom Recorder</h1><p>Cannot record on this specific page (e.g. new tab or chrome settings). Please navigate to a standard webpage (like google.com) and click the extension icon again.</p>' });
    return;
  }

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
