const HISTORY_KEY = "sflc_comment_history";
const metaEl = document.getElementById("meta");
const listEl = document.getElementById("commentList");
const downloadBtn = document.getElementById("downloadCsv");
const clearBtn = document.getElementById("clearHistory");

function storageGet(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(Array.isArray(result[key]) ? result[key] : fallback);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function csvValue(value) {
  return `"${cleanText(value).replace(/"/g, '""')}"`;
}

function downloadCsv(comments) {
  const rows = [
    ["time", "platform", "handle", "name", "comment", "pageUrl"],
    ...comments.map((item) => [
      item.timestamp || "",
      item.platform || "TikTok",
      item.handle || "",
      item.name || "",
      item.comment || "",
      item.pageUrl || "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvValue).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `sellerflow-live-comments-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function render() {
  const comments = await storageGet(HISTORY_KEY, []);
  const newest = [...comments].reverse();
  metaEl.textContent = `${comments.length} captured comments`;
  listEl.innerHTML = newest
    .slice(0, 80)
    .map((item) => {
      const name = cleanText(item.name || item.handle || "TikTok viewer");
      const handle = cleanText(item.handle || "");
      const comment = cleanText(item.comment || "");
      const time = cleanText(item.timestamp || "");
      return `
        <li>
          <div class="name">${name}${handle && handle !== name ? ` - @${handle}` : ""}</div>
          <div class="comment">${comment}</div>
          <div class="time">${time}</div>
        </li>
      `;
    })
    .join("");
  return comments;
}

downloadBtn.addEventListener("click", async () => {
  downloadCsv(await storageGet(HISTORY_KEY, []));
});

clearBtn.addEventListener("click", async () => {
  await storageSet({ [HISTORY_KEY]: [] });
  await render();
});

render();
