let current = null;
let currentMode = "folder"; // "folder" | "merged"
let currentMergedKey = null;
let ROOT = null;
let TREE = [];
let MERGED = [];

const COLLAPSE_KEY = "vodmarks.collapsedFolderIds.v2";
const collapsed = loadCollapsedSet();

function loadCollapsedSet() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(String));
  } catch {
    return new Set();
  }
}

function saveCollapsedSet() {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(collapsed)));
  } catch {}
}

function isCollapsed(id) {
  return collapsed.has(String(id));
}

function setCollapsed(id, value) {
  const k = String(id);
  if (value) collapsed.add(k);
  else collapsed.delete(k);
  saveCollapsedSet();
}

async function loadAll() {
  const r = await fetch("/api/tree");
  const data = await r.json();
  ROOT = data.root;
  TREE = data.tree || [];

  // Prefer merged from /api/merged because it includes totals
  const m = await fetch("/api/merged");
  const md = await m.json().catch(()=>({}));
  MERGED = (md.groups || []);

  renderSidebar();
}

function renderSidebar() {
  const treeEl = document.getElementById("tree");
  treeEl.innerHTML = "";

  renderFolderNodes(TREE, treeEl);

  const sep = document.createElement("div");
  sep.className = "separator";
  sep.textContent = "Merged (same-named folders)";
  treeEl.appendChild(sep);

  const mergedWrap = document.createElement("div");
  mergedWrap.className = "mergedWrap";
  treeEl.appendChild(mergedWrap);

  renderMergedList(mergedWrap);
}

function renderFolderNodes(nodes, el) {
  for (let n of nodes) {
    const hasKids = n.children && n.children.length > 0;

    const row = document.createElement("div");
    row.className = "folderRow";

    const caret = document.createElement("button");
    caret.className = "caretBtn";
    caret.textContent = hasKids ? (isCollapsed(n.id) ? "▶" : "▼") : "•";
    caret.disabled = !hasKids;
    caret.title = hasKids ? "Collapse/expand" : "";
    caret.onclick = (e) => {
      e.stopPropagation();
      if (!hasKids) return;
      setCollapsed(n.id, !isCollapsed(n.id));
      renderSidebar();
    };

    const name = document.createElement("div");
    name.className = "folder";
    const count = (n.count ?? 0);
    name.textContent = `${n.name} (${count})`;
    name.onclick = () => selectFolder(n.id, n.name);

    name.oncontextmenu = async (e) => {
      e.preventDefault();
      if (n.id === ROOT) return;
      const next = prompt(`Rename folder "${n.name}" to:`, n.name);
      if (!next) return;
      const res = await fetch(`/api/folder/${n.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next })
      });
      const j = await res.json().catch(()=> ({}));
      if (!res.ok) return alert(j.error || "Rename failed");
      await loadAll();
    };

    const del = document.createElement("button");
    del.className = "delBtn";
    del.textContent = "x";
    del.title = "Delete folder";
    del.onclick = async (e) => {
      e.stopPropagation();
      if (n.id === ROOT) return alert("Can't delete Root.");
      const ok = confirm(`Delete "${n.name}" and EVERYTHING inside it?`);
      if (!ok) return;

      const res = await fetch(`/api/folder/${n.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return alert(j.error || "Delete failed");

      if (current === n.id) {
        current = null;
        currentMode = "folder";
        currentMergedKey = null;
        document.getElementById("title").textContent = "Select folder";
        document.getElementById("cards").innerHTML = "";
      }
      await loadAll();
    };

    row.appendChild(caret);
    row.appendChild(name);
    row.appendChild(del);
    el.appendChild(row);

    // Collapsing Root (or any node) hides its subtree WITHOUT changing child collapse states.
    if (hasKids && !isCollapsed(n.id)) {
      const sub = document.createElement("div");
      sub.className = "indent";
      el.appendChild(sub);
      renderFolderNodes(n.children, sub);
    }
  }
}

function renderMergedList(el) {
  el.innerHTML = "";
  if (!Array.isArray(MERGED) || MERGED.length === 0) {
    el.innerHTML = "<div class='empty'>No duplicates yet.</div>";
    return;
  }
  for (const g of MERGED) {
    const row = document.createElement("div");
    row.className = "mergedRow";
    const total = (g.total_bookmarks ?? 0);
    row.textContent = `${g.name} (${total})`;
    row.onclick = () => selectMerged(g.key, g.name);
    el.appendChild(row);
  }
}

async function selectFolder(id, nameText) {
  currentMode = "folder";
  currentMergedKey = null;
  current = id;
  document.getElementById("title").textContent = nameText;

  const r = await fetch(`/api/bookmarks?folder_id=${id}`);
  const data = await r.json();
  renderCards(data);
}

async function selectMerged(key, displayName) {
  currentMode = "merged";
  currentMergedKey = key;
  current = null;
  document.getElementById("title").textContent = `${displayName} (merged)`;

  const r = await fetch(`/api/merged_bookmarks?key=${encodeURIComponent(key)}`);
  const data = await r.json();
  renderCards(data);
}

function renderCards(list) {
  const el = document.getElementById("cards");
  el.innerHTML = "";
  if (!Array.isArray(list) || list.length === 0) {
    el.innerHTML = "<div class='empty'>No entries yet.</div>";
    return;
  }

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const c = document.createElement("div");

    // Check if it's a media entry or YouTube entry
    if (b.entry_type === 'media') {
      // Simple media entry - just show title and date
      c.className = "mediaCard";
      c.innerHTML = `
        <div class="mediaCardContent">
          <span class="mediaTitle">${escapeHtml(b.title)} - ${escapeHtml(b.upload_date)}</span>
          <button class="miniBtn" data-id="${b.id}">Delete</button>
        </div>`;
    } else {
      // YouTube entry with full details
      c.className = "card";
      const dur = fmt(b.duration_seconds || 0);
      const hasSrt = !!b.srt_file_path;
      
      let srtButtons = '';
      if (hasSrt) {
        srtButtons = `
          <button class="srtViewBtn" data-id="${b.id}">View SRT</button>
          <button class="srtDelBtn" data-id="${b.id}">Delete SRT</button>
        `;
      } else {
        srtButtons = `<button class="srtBtn" data-id="${b.id}">Upload SRT</button>`;
      }
      
      c.innerHTML = `
        <img src="${b.thumbnail_url || ""}" alt="">
        <div class="cardBody">
          <div class="cardTitle">${escapeHtml(b.title || b.url)}</div>
          <div class="cardMeta">${escapeHtml(b.uploader || "")}</div>
          <div class="cardMeta">${escapeHtml(b.upload_date || "")} • ${dur}</div>
          <div class="cardLinks">
            <a href="${b.url}" target="_blank" rel="noreferrer">Open</a>
            ${srtButtons}
            <button class="miniBtn" data-id="${b.id}">Delete</button>
          </div>
        </div>
        <input type="file" accept=".srt" class="srtFileInput" data-id="${b.id}" style="display: none;">`;
    }
    c.classList.add("cardAnimateIn");
    c.style.animationDelay = `${i * 0.04}s`;
    el.appendChild(c);
  }

  // Handle Upload SRT buttons
  el.querySelectorAll(".srtBtn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-id");
      const fileInput = el.querySelector(`.srtFileInput[data-id="${id}"]`);
      fileInput.click();
    };
  });

  // Handle View SRT buttons
  el.querySelectorAll(".srtViewBtn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-id");
      window.open(`/api/bookmark/${id}/srt`, '_blank');
    };
  });

  // Handle Delete SRT buttons
  el.querySelectorAll(".srtDelBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const confirmDelete = confirm("Delete this SRT file?");
      if (!confirmDelete) return;
      
      await fetch(`/api/bookmark/${id}/srt`, { method: "DELETE" });
      
      if (currentMode === "folder" && current) {
        await selectFolder(current, document.getElementById("title").textContent);
      } else if (currentMode === "merged" && currentMergedKey) {
        const display = document.getElementById("title").textContent.replace(" (merged)", "");
        await selectMerged(currentMergedKey, display);
      }
    };
  });

  // Handle file input changes
  el.querySelectorAll(".srtFileInput").forEach(input => {
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const id = input.getAttribute("data-id");
      const formData = new FormData();
      formData.append("srt_file", file);
      
      try {
        const res = await fetch(`/api/bookmark/${id}/upload_srt`, {
          method: "POST",
          body: formData
        });
        
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(j.error || "Upload failed.");
          return;
        }
        
        // Refresh the current view
        if (currentMode === "folder" && current) {
          await selectFolder(current, document.getElementById("title").textContent);
        } else if (currentMode === "merged" && currentMergedKey) {
          const display = document.getElementById("title").textContent.replace(" (merged)", "");
          await selectMerged(currentMergedKey, display);
        }
      } catch (err) {
        alert("Upload failed: " + err.message);
      }
    };
  });

  el.querySelectorAll(".miniBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const ok = confirm("Delete this entry?");
      if (!ok) return;
      await fetch(`/api/bookmark/${id}`, { method:"DELETE" });

      if (currentMode === "folder" && current) {
        await selectFolder(current, document.getElementById("title").textContent);
      } else if (currentMode === "merged" && currentMergedKey) {
        const display = document.getElementById("title").textContent.replace(" (merged)", "");
        await selectMerged(currentMergedKey, display);
      }
      await loadAll();
    };
  });
}

function escapeHtml(s) {
  const str = String(s ?? "");
  return str.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

function fmt(sec) {
  sec = Number(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

async function newFolder() {
  const name = prompt("Folder name");
  if (!name) return;
  await fetch("/api/folder", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name, parent_id: currentMode === "folder" ? (current || ROOT) : ROOT})
  });
  await loadAll();
}

async function addVod() {
  const status = document.getElementById("status");
  if (currentMode !== "folder" || !current) return alert("Select a real folder first (merged views are read-only).");
  const url = document.getElementById("url").value.trim();
  if (!url) return;

  status.textContent = "Fetching metadata...";
  status.classList.add("statusLoading");
  const res = await fetch("/api/bookmark", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({folder_id: current, url, entry_type: "youtube"})
  });
  status.classList.remove("statusLoading");
  const j = await res.json().catch(()=> ({}));
  if (!res.ok) {
    status.textContent = j.error || "Failed.";
    return;
  }
  status.textContent = "Added.";
  document.getElementById("url").value = "";
  setTimeout(() => { status.textContent = ""; }, 2000);
  await selectFolder(current, document.getElementById("title").textContent);
  await loadAll();
}

async function addMedia() {
  const status = document.getElementById("status");
  if (currentMode !== "folder" || !current) return alert("Select a real folder first (merged views are read-only).");
  
  const title = document.getElementById("mediaTitle").value.trim();
  const date = document.getElementById("mediaDate").value.trim();
  
  if (!title || !date) {
    status.textContent = "Please fill in both title and year.";
    setTimeout(() => { status.textContent = ""; }, 2000);
    return;
  }

  status.textContent = "Adding media...";
  status.classList.add("statusLoading");
  const res = await fetch("/api/bookmark", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({folder_id: current, title, date, entry_type: "media"})
  });
  status.classList.remove("statusLoading");
  const j = await res.json().catch(()=> ({}));
  if (!res.ok) {
    status.textContent = j.error || "Failed.";
    return;
  }
  status.textContent = "Added.";
  document.getElementById("mediaTitle").value = "";
  document.getElementById("mediaDate").value = "";
  setTimeout(() => { status.textContent = ""; }, 2000);
  await selectFolder(current, document.getElementById("title").textContent);
  await loadAll();
}

window.newFolder = newFolder;
window.addVod = addVod;
window.addMedia = addMedia;

loadAll();

/* ═══════════════════════════════════════════════════
   Tab Switching
   ═══════════════════════════════════════════════════ */

let activeTab = "vod";

function switchTab(tab) {
  activeTab = tab;
  document.getElementById("tab-vod").style.display = tab === "vod" ? "" : "none";
  document.getElementById("tab-medialog").style.display = tab === "medialog" ? "" : "none";

  document.querySelectorAll(".tabBtn").forEach(btn => btn.classList.remove("tabActive"));
  const idx = tab === "vod" ? 0 : 1;
  document.querySelectorAll(".tabBtn")[idx].classList.add("tabActive");

  if (tab === "medialog") {
    loadMediaLog(mlCurrentCategory);
  }
}
window.switchTab = switchTab;

/* ═══════════════════════════════════════════════════
   Media Log
   ═══════════════════════════════════════════════════ */

let mlCurrentCategory = "anime";

const STATUS_LABELS = {
  currently: "Currently watching/reading/playing",
  completed: "Completed",
  plan_to_start: "Plan to start"
};

const STATUS_SHORT = {
  currently: "In Progress",
  completed: "Completed",
  plan_to_start: "Planned"
};

function selectCategory(cat) {
  mlCurrentCategory = cat;
  document.querySelectorAll(".mlCatBtn").forEach(b => b.classList.remove("mlCatActive"));
  const btn = document.querySelector(`.mlCatBtn[data-cat="${cat}"]`);
  if (btn) btn.classList.add("mlCatActive");
  document.getElementById("mlTitle").textContent = btn ? btn.textContent : cat;
  loadMediaLog(cat);
}
window.selectCategory = selectCategory;

async function loadMediaLog(category) {
  const r = await fetch(`/api/media_log?category=${encodeURIComponent(category)}`);
  const data = await r.json();
  renderMediaLogCards(data);
}

function renderMediaLogCards(list) {
  const el = document.getElementById("mlCards");
  el.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    el.innerHTML = "<div class='empty'>No entries yet.</div>";
    return;
  }

  // Group by status
  const groups = { currently: [], completed: [], plan_to_start: [] };
  for (const item of list) {
    const s = item.status || "plan_to_start";
    if (groups[s]) groups[s].push(item);
    else groups.plan_to_start.push(item);
  }

  let animIdx = 0;
  for (const [statusKey, items] of Object.entries(groups)) {
    if (items.length === 0) continue;

    const header = document.createElement("div");
    header.className = "mlGroupHeader";
    header.textContent = STATUS_SHORT[statusKey] || statusKey;
    el.appendChild(header);

    for (const item of items) {
      const card = document.createElement("div");
      card.className = "mlEntryCard cardAnimateIn";
      card.style.animationDelay = `${animIdx * 0.04}s`;
      animIdx++;

      card.innerHTML = `
        <div class="mlEntryContent">
          <div class="mlEntryInfo">
            <span class="mlEntryTitle">${escapeHtml(item.title)}</span>
            <span class="mlEntryProgress">${escapeHtml(item.progress || "—")}</span>
          </div>
          <div class="mlEntryActions">
            <select class="mlStatusSelect" data-id="${item.id}">
              <option value="currently" ${item.status === "currently" ? "selected" : ""}>In Progress</option>
              <option value="completed" ${item.status === "completed" ? "selected" : ""}>Completed</option>
              <option value="plan_to_start" ${item.status === "plan_to_start" ? "selected" : ""}>Planned</option>
            </select>
            <button class="mlEditBtn" data-id="${item.id}" data-title="${escapeHtml(item.title)}" data-progress="${escapeHtml(item.progress || "")}">Edit</button>
            <button class="miniBtn mlDelBtn" data-id="${item.id}">Delete</button>
          </div>
        </div>`;
      el.appendChild(card);
    }
  }

  // Status change handler
  el.querySelectorAll(".mlStatusSelect").forEach(sel => {
    sel.onchange = async () => {
      const id = sel.getAttribute("data-id");
      await fetch(`/api/media_log/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: sel.value })
      });
      loadMediaLog(mlCurrentCategory);
    };
  });

  // Edit handler
  el.querySelectorAll(".mlEditBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const oldTitle = btn.getAttribute("data-title");
      const oldProgress = btn.getAttribute("data-progress");
      const newTitle = prompt("Title:", oldTitle);
      if (newTitle === null) return;
      const newProgress = prompt("Progress:", oldProgress);
      if (newProgress === null) return;
      await fetch(`/api/media_log/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, progress: newProgress })
      });
      loadMediaLog(mlCurrentCategory);
    };
  });

  // Delete handler
  el.querySelectorAll(".mlDelBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      if (!confirm("Delete this entry?")) return;
      await fetch(`/api/media_log/${id}`, { method: "DELETE" });
      loadMediaLog(mlCurrentCategory);
    };
  });
}

async function addMediaLogEntry() {
  const status = document.getElementById("mlStatus");
  const titleInput = document.getElementById("mlEntryTitle");
  const progressInput = document.getElementById("mlEntryProgress");
  const statusSelect = document.getElementById("mlEntryStatus");

  const title = titleInput.value.trim();
  if (!title) {
    status.textContent = "Title is required.";
    setTimeout(() => { status.textContent = ""; }, 2000);
    return;
  }

  const res = await fetch("/api/media_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: mlCurrentCategory,
      title: title,
      progress: progressInput.value.trim(),
      status: statusSelect.value
    })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    status.textContent = j.error || "Failed.";
    return;
  }
  status.textContent = "Added.";
  titleInput.value = "";
  progressInput.value = "";
  statusSelect.value = "currently";
  setTimeout(() => { status.textContent = ""; }, 2000);
  loadMediaLog(mlCurrentCategory);
}
window.addMediaLogEntry = addMediaLogEntry;
