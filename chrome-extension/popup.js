const defaults = {
  sellerId: "",
  active: true,
  serverUrl: "https://sellerflow-live-server.onrender.com"
};

const fields = {
  sellerId: document.getElementById("sellerId"),
  serverUrl: document.getElementById("serverUrl"),
  status: document.getElementById("status")
};

chrome.storage.local.get(defaults, (settings) => {
  fields.sellerId.value = settings.sellerId || "";
  fields.serverUrl.value = settings.serverUrl || defaults.serverUrl;
  fields.status.textContent = settings.sellerId ? "Saved. Open any TikTok LIVE now." : "Enter seller email first.";
});

document.getElementById("save").addEventListener("click", () => {
  const settings = {
    sellerId: fields.sellerId.value.trim().toLowerCase(),
    active: true,
    serverUrl: fields.serverUrl.value.trim().replace(/\/$/, "") || defaults.serverUrl
  };

  chrome.storage.local.set(settings, () => {
    fields.status.textContent = "Saved. Any TikTok LIVE comments will send automatically.";
  });
});
