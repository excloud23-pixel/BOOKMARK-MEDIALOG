/* ══════════════════════════════════════════════════════
   VODMarks v2 — Enhanced UI
   ══════════════════════════════════════════════════════ */

// ── State ──
let current = null;
let currentMode = "folder"; // "folder" | "merged"
let currentMergedKey = null;
let ROOT = null;
let TREE = [];
let MERGED = [];
let currentCards = [];        // raw data for current view
let selectedIds = new Set();  // bulk selection
let viewMode = "card";        // "card" | "list"
let sidebarOpen = false;

const COLLAPSE_KEY = "vodmarks.collapsedFolderIds.v2";
const THEME_KEY = "vodmarks.theme";
const VIEW_KEY = "vodmarks.viewMode";
const collapsed = loadCollapsedSet();

// ── Init ──
initTheme();
initViewMode();
loadAll();

// ══════════════════════════════════════════════════════
//  Theme Toggle (#14)
// ══════════════════════════════════════════════════════

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    updateThemeIcon("light");
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "light" ? "dark" : "light";
  if (next === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  localStorage.setItem(THEME_KEY, next);
  updateThemeIcon(next);
  showToast(next === "light" ? "Switched to light theme" : "Switched to dark theme", "info");
}

function updateThemeIcon(theme) {
  const icon = document.querySelector(".themeIcon");
  if (icon) icon.textContent = theme === "light" ? "\u2600" : "\u263E";
}

window.toggleTheme = toggleTheme;

// ══════════════════════════════════════════════════════
//  View Mode Toggle (#15)
// ══════════════════════════════════════════════════════

function initViewMode() {
  const saved = localStorage.getItem(VIEW_KEY);
  if (saved === "list" || saved === "card") viewMode = saved;
  updateViewBtns();
}

function setViewMode(mode) {
  viewMode = mode;
  localStorage.setItem(VIEW_KEY, mode);
  updateViewBtns();
  const cards = document.getElementById("cards");
  if (cards) {
    cards.classList.toggle("listMode", mode === "list");
  }
}

function updateViewBtns() {
  document.querySelectorAll(".viewBtn").forEach(btn => {
    btn.classList.toggle("viewBtnActive", btn.getAttribute("data-view") === viewMode);
  });
}

window.setViewMode = setViewMode;

// ══════════════════════════════════════════════════════
//  Toast Notifications (#8)
// ══════════════════════════════════════════════════════

function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast toast${type.charAt(0).toUpperCase() + type.slice(1)}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toastOut");
    toast.addEventListener("animationend", () => toast.remove());
  }, duration);
}

// ══════════════════════════════════════════════════════
//  Custom Confirmation Modal (#11)
// ══════════════════════════════════════════════════════

let modalResolve = null;

function showModal(title, message, confirmText = "Confirm", isDanger = true) {
  return new Promise((resolve) => {
    modalResolve = resolve;
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalMessage").textContent = message;
    document.getElementById("modalExtra").innerHTML = "";
    const confirmBtn = document.getElementById("modalConfirm");
    confirmBtn.textContent = confirmText;
    confirmBtn.className = isDanger ? "btnModal btnModalDanger" : "btnModal btnModalPrimary";
    confirmBtn.onclick = () => { closeModal(); resolve(true); };
    document.getElementById("modalOverlay").style.display = "";
  });
}

function closeModal() {
  document.getElementById("modalOverlay").style.display = "none";
  if (modalResolve) { modalResolve(false); modalResolve = null; }
}

window.closeModal = closeModal;

// Move-to folder picker modal
async function showMoveModal(title) {
  const res = await fetch("/api/folders_flat");
  const folders = await res.json();

  return new Promise((resolve) => {
    modalResolve = resolve;
    document.getElementById("modalTitle").textContent = title;
    document.getElementById("modalMessage").textContent = "Select a destination folder:";

    let selectedFolderId = null;
    const extra = document.getElementById("modalExtra");
    let html = '<div class="folderPicker">';
    for (const f of folders) {
      html += `<div class="folderPickerItem" data-fid="${f.id}">${escapeHtml(f.breadcrumb)}</div>`;
    }
    html += '</div>';
    extra.innerHTML = html;

    extra.querySelectorAll(".folderPickerItem").forEach(item => {
      item.onclick = () => {
        extra.querySelectorAll(".folderPickerItem").forEach(i => i.classList.remove("fpSelected"));
        item.classList.add("fpSelected");
        selectedFolderId = parseInt(item.getAttribute("data-fid"));
      };
    });

    const confirmBtn = document.getElementById("modalConfirm");
    confirmBtn.textContent = "Move";
    confirmBtn.className = "btnModal btnModalPrimary";
    confirmBtn.onclick = () => {
      closeModal();
      resolve(selectedFolderId);
    };

    document.getElementById("modalOverlay").style.display = "";
  });
}

// ══════════════════════════════════════════════════════
//  Edit Modal (replaces prompt() for Media Log)
// ══════════════════════════════════════════════════════

function showEditModal(currentTitle, currentProgress) {
  return new Promise((resolve) => {
    document.getElementById("editTitle").value = currentTitle;
    document.getElementById("editProgress").value = currentProgress;
    document.getElementById("editModalSave").onclick = () => {
      const t = document.getElementById("editTitle").value.trim();
      const p = document.getElementById("editProgress").value.trim();
      closeEditModal();
      resolve({ title: t, progress: p });
    };
    document.getElementById("editModalOverlay").style.display = "";
    document.getElementById("editTitle").focus();
  });
}

function closeEditModal() {
  document.getElementById("editModalOverlay").style.display = "none";
}

window.closeEditModal = closeEditModal;

// ══════════════════════════════════════════════════════
//  Keyboard Shortcuts Help (#16)
// ══════════════════════════════════════════════════════

function showShortcutsHelp() {
  document.getElementById("shortcutsOverlay").style.display = "";
}

function closeShortcutsHelp() {
  document.getElementById("shortcutsOverlay").style.display = "none";
}

window.showShortcutsHelp = showShortcutsHelp;
window.closeShortcutsHelp = closeShortcutsHelp;

// ══════════════════════════════════════════════════════
//  Collapse State Persistence
// ══════════════════════════════════════════════════════

function loadCollapsedSet() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map(String));
  } catch { return new Set(); }
}

function saveCollapsedSet() {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(collapsed))); } catch {}
}

function isCollapsed(id) { return collapsed.has(String(id)); }

function setCollapsed(id, value) {
  const k = String(id);
  if (value) collapsed.add(k); else collapsed.delete(k);
  saveCollapsedSet();
}

// ══════════════════════════════════════════════════════
//  Data Loading
// ══════════════════════════════════════════════════════

async function loadAll() {
  const r = await fetch("/api/tree");
  const data = await r.json();
  ROOT = data.root;
  TREE = data.tree || [];

  const m = await fetch("/api/merged");
  const md = await m.json().catch(() => ({}));
  MERGED = md.groups || [];

  renderSidebar();
}

// ══════════════════════════════════════════════════════
//  Sidebar Rendering (#4 rename button, #7 accessibility)
// ══════════════════════════════════════════════════════

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
  for (const n of nodes) {
    const hasKids = n.children && n.children.length > 0;
    const row = document.createElement("div");
    row.className = "folderRow";
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-expanded", hasKids ? (!isCollapsed(n.id)).toString() : undefined);

    // Caret
    const caret = document.createElement("button");
    caret.className = "caretBtn";
    caret.textContent = hasKids ? (isCollapsed(n.id) ? "\u25B6" : "\u25BC") : "\u2022";
    caret.disabled = !hasKids;
    caret.title = hasKids ? "Collapse/expand" : "";
    caret.setAttribute("aria-label", hasKids ? "Toggle folder" : "");
    caret.onclick = (e) => {
      e.stopPropagation();
      if (!hasKids) return;
      setCollapsed(n.id, !isCollapsed(n.id));
      renderSidebar();
    };

    // Name
    const name = document.createElement("div");
    name.className = "folder" + (current === n.id && currentMode === "folder" ? " folderActive" : "");
    name.setAttribute("tabindex", "0");
    name.setAttribute("role", "button");
    name.setAttribute("aria-label", `${n.name}, ${n.count ?? 0} items`);
    const count = n.count ?? 0;
    name.textContent = `${n.name} (${count})`;
    name.onclick = () => selectFolder(n.id, n.name);
    name.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectFolder(n.id, n.name); } };

    // Drag-and-drop: folders as drop targets
    name.addEventListener("dragover", (e) => { e.preventDefault(); name.classList.add("dragOver"); });
    name.addEventListener("dragleave", () => name.classList.remove("dragOver"));
    name.addEventListener("drop", async (e) => {
      e.preventDefault();
      name.classList.remove("dragOver");
      const bid = e.dataTransfer.getData("text/plain");
      if (!bid) return;
      await fetch(`/api/bookmark/${bid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: n.id })
      });
      showToast(`Moved to ${n.name}`, "success");
      await refreshCurrentView();
      await loadAll();
    });

    // Actions container (#4 visible rename + delete)
    const actions = document.createElement("div");
    actions.className = "folderActions";

    if (n.id !== ROOT) {
      const renameBtn = document.createElement("button");
      renameBtn.className = "renameBtn";
      renameBtn.innerHTML = "&#9998;";
      renameBtn.title = "Rename folder";
      renameBtn.setAttribute("aria-label", `Rename ${n.name}`);
      renameBtn.onclick = async (e) => {
        e.stopPropagation();
        const next = prompt(`Rename folder "${n.name}" to:`, n.name);
        if (!next) return;
        const res = await fetch(`/api/folder/${n.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return showToast(j.error || "Rename failed", "error");
        showToast(`Renamed to "${next}"`, "success");
        await loadAll();
      };
      actions.appendChild(renameBtn);
    }

    const del = document.createElement("button");
    del.className = "delBtn";
    del.textContent = "x";
    del.title = "Delete folder";
    del.setAttribute("aria-label", `Delete ${n.name}`);
    del.onclick = async (e) => {
      e.stopPropagation();
      if (n.id === ROOT) return showToast("Can't delete Root.", "error");
      const ok = await showModal(
        "Delete Folder",
        `Are you sure you want to delete "${n.name}" and everything inside it? This cannot be undone.`,
        "Delete",
        true
      );
      if (!ok) return;

      showToast("Deleting folder...", "info");
      const res = await fetch(`/api/folder/${n.id}`, { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return showToast(j.error || "Delete failed", "error");

      if (current === n.id) {
        current = null;
        currentMode = "folder";
        currentMergedKey = null;
        document.getElementById("title").textContent = "Select folder";
        document.getElementById("cards").innerHTML = "";
      }
      showToast(`Deleted "${n.name}"`, "success");
      await loadAll();
    };
    actions.appendChild(del);

    row.appendChild(caret);
    row.appendChild(name);
    row.appendChild(actions);
    el.appendChild(row);

    if (hasKids && !isCollapsed(n.id)) {
      const sub = document.createElement("div");
      sub.className = "indent";
      sub.setAttribute("role", "group");
      el.appendChild(sub);
      renderFolderNodes(n.children, sub);
    }
  }
}

function renderMergedList(el) {
  el.innerHTML = "";
  if (!Array.isArray(MERGED) || MERGED.length === 0) {
    el.innerHTML = `<div class="emptyState"><div class="emptyIcon">\uD83D\uDD00</div><div class="emptyHint">No duplicate folder names yet.</div></div>`;
    return;
  }
  for (const g of MERGED) {
    const row = document.createElement("div");
    row.className = "mergedRow";
    row.setAttribute("tabindex", "0");
    row.setAttribute("role", "button");
    const total = g.total_bookmarks ?? 0;
    row.textContent = `${g.name} (${total})`;
    row.onclick = () => selectMerged(g.key, g.name);
    row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectMerged(g.key, g.name); } };
    el.appendChild(row);
  }
}

// ══════════════════════════════════════════════════════
//  Folder / Merged Selection
// ══════════════════════════════════════════════════════

async function selectFolder(id, nameText) {
  currentMode = "folder";
  currentMergedKey = null;
  current = id;
  document.getElementById("title").textContent = nameText;
  clearSelection();
  renderSidebar(); // update active state

  const r = await fetch(`/api/bookmarks?folder_id=${id}`);
  const data = await r.json();
  currentCards = data;
  applySearchAndSort();
}

async function selectMerged(key, displayName) {
  currentMode = "merged";
  currentMergedKey = key;
  current = null;
  document.getElementById("title").textContent = `${displayName} (merged)`;
  clearSelection();
  renderSidebar();

  const r = await fetch(`/api/merged_bookmarks?key=${encodeURIComponent(key)}`);
  const data = await r.json();
  currentCards = data;
  applySearchAndSort();
}

async function refreshCurrentView() {
  if (currentMode === "folder" && current) {
    const r = await fetch(`/api/bookmarks?folder_id=${current}`);
    currentCards = await r.json();
  } else if (currentMode === "merged" && currentMergedKey) {
    const r = await fetch(`/api/merged_bookmarks?key=${encodeURIComponent(currentMergedKey)}`);
    currentCards = await r.json();
  }
  applySearchAndSort();
}

// ══════════════════════════════════════════════════════
//  Search & Sort (#2, #13)
// ══════════════════════════════════════════════════════

function applySearchAndSort() {
  let list = [...currentCards];

  // Search filter
  const query = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  if (query) {
    list = list.filter(b => {
      const title = (b.title || "").toLowerCase();
      const uploader = (b.uploader || "").toLowerCase();
      const url = (b.url || "").toLowerCase();
      return title.includes(query) || uploader.includes(query) || url.includes(query);
    });
  }

  // Sort
  const sortVal = document.getElementById("sortSelect").value;
  list = sortList(list, sortVal);

  renderCards(list);
}

function applySort() { applySearchAndSort(); }
window.applySort = applySort;

function sortList(list, sortVal) {
  const sorted = [...list];
  switch (sortVal) {
    case "title_asc": sorted.sort((a, b) => (a.title || "").localeCompare(b.title || "")); break;
    case "title_desc": sorted.sort((a, b) => (b.title || "").localeCompare(a.title || "")); break;
    case "date_asc": sorted.sort((a, b) => (a.upload_date || "").localeCompare(b.upload_date || "")); break;
    case "date_desc": sorted.sort((a, b) => (b.upload_date || "").localeCompare(a.upload_date || "")); break;
    case "duration_asc": sorted.sort((a, b) => (a.duration_seconds || 0) - (b.duration_seconds || 0)); break;
    case "duration_desc": sorted.sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0)); break;
  }
  return sorted;
}

// Search input handler
document.getElementById("searchInput").addEventListener("input", () => {
  applySearchAndSort();
});

// ══════════════════════════════════════════════════════
//  Card Rendering (#5 empty states, #7 alt text, #10 breadcrumbs, #12 checkboxes, #3 drag)
// ══════════════════════════════════════════════════════

function renderCards(list) {
  const el = document.getElementById("cards");
  el.innerHTML = "";
  el.classList.toggle("listMode", viewMode === "list");

  if (!Array.isArray(list) || list.length === 0) {
    const q = (document.getElementById("searchInput").value || "").trim();
    if (q) {
      el.innerHTML = `<div class="emptyState">
        <div class="emptyIcon">\uD83D\uDD0D</div>
        <div class="emptyTitle">No results found</div>
        <div class="emptyHint">Try a different search term.</div>
      </div>`;
    } else if (current || currentMergedKey) {
      el.innerHTML = `<div class="emptyState">
        <div class="emptyIcon">\uD83D\uDCDA</div>
        <div class="emptyTitle">No entries yet</div>
        <div class="emptyHint">Paste a YouTube URL above to add your first VOD, or add a media entry.</div>
      </div>`;
    } else {
      el.innerHTML = `<div class="emptyState">
        <div class="emptyIcon">\uD83D\uDCC2</div>
        <div class="emptyTitle">Select a folder</div>
        <div class="emptyHint">Choose a folder from the sidebar to view its contents.</div>
      </div>`;
    }
    return;
  }

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const c = document.createElement("div");
    c.setAttribute("role", "listitem");

    if (b.entry_type === "media") {
      c.className = "mediaCard" + (selectedIds.has(b.id) ? " selected" : "");
      const breadcrumbHtml = b.folder_breadcrumb ? `<div class="cardBreadcrumb">${escapeHtml(b.folder_breadcrumb)}</div>` : "";
      c.innerHTML = `
        <input type="checkbox" class="cardCheckbox" data-id="${b.id}" ${selectedIds.has(b.id) ? "checked" : ""} aria-label="Select ${escapeHtml(b.title)}">
        <div class="mediaCardContent">
          <span class="mediaTitle">${escapeHtml(b.title)} - ${escapeHtml(b.upload_date)}</span>
          ${breadcrumbHtml}
          <button class="miniBtn" data-id="${b.id}" aria-label="Delete ${escapeHtml(b.title)}">Delete</button>
        </div>`;
    } else {
      c.className = "card" + (selectedIds.has(b.id) ? " selected" : "");
      const dur = fmt(b.duration_seconds || 0);
      const hasSrt = !!b.srt_file_path;
      const altText = escapeHtml(b.title || "Video thumbnail");

      let srtButtons = "";
      if (hasSrt) {
        srtButtons = `
          <button class="srtViewBtn" data-id="${b.id}">View SRT</button>
          <button class="srtDelBtn" data-id="${b.id}">Delete SRT</button>`;
      } else {
        srtButtons = `<button class="srtBtn" data-id="${b.id}">Upload SRT</button>`;
      }

      const breadcrumbHtml = b.folder_breadcrumb ? `<div class="cardBreadcrumb">${escapeHtml(b.folder_breadcrumb)}</div>` : "";

      c.innerHTML = `
        <input type="checkbox" class="cardCheckbox" data-id="${b.id}" ${selectedIds.has(b.id) ? "checked" : ""} aria-label="Select ${altText}">
        <img src="${b.thumbnail_url || ""}" alt="${altText}" loading="lazy">
        <div class="cardBody">
          <div class="cardTitle">${escapeHtml(b.title || b.url)}</div>
          <div class="cardMeta">${escapeHtml(b.uploader || "")}</div>
          <div class="cardMeta">${escapeHtml(b.upload_date || "")} \u2022 ${dur}</div>
          ${breadcrumbHtml}
          <div class="cardLinks">
            <a href="${b.url}" target="_blank" rel="noreferrer">Open</a>
            ${srtButtons}
            <button class="miniBtn" data-id="${b.id}" aria-label="Delete entry">Delete</button>
          </div>
        </div>
        <input type="file" accept=".srt" class="srtFileInput" data-id="${b.id}" style="display: none;">`;
    }

    // Drag-and-drop (#3)
    c.setAttribute("draggable", "true");
    c.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(b.id));
      c.classList.add("dragging");
    });
    c.addEventListener("dragend", () => c.classList.remove("dragging"));

    c.classList.add("cardAnimateIn");
    c.style.animationDelay = `${i * 0.04}s`;
    el.appendChild(c);
  }

  // ── Event handlers ──

  // Checkbox selection (#12)
  el.querySelectorAll(".cardCheckbox").forEach(cb => {
    cb.onchange = () => {
      const id = parseInt(cb.getAttribute("data-id"));
      if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
      cb.closest(".card, .mediaCard").classList.toggle("selected", cb.checked);
      updateBulkBar();
    };
  });

  // SRT buttons
  el.querySelectorAll(".srtBtn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-id");
      el.querySelector(`.srtFileInput[data-id="${id}"]`).click();
    };
  });

  el.querySelectorAll(".srtViewBtn").forEach(btn => {
    btn.onclick = () => window.open(`/api/bookmark/${btn.getAttribute("data-id")}/srt`, "_blank");
  });

  el.querySelectorAll(".srtDelBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const ok = await showModal("Delete SRT", "Delete this subtitle file?", "Delete", true);
      if (!ok) return;
      await fetch(`/api/bookmark/${id}/srt`, { method: "DELETE" });
      showToast("SRT file deleted", "success");
      await refreshCurrentView();
    };
  });

  el.querySelectorAll(".srtFileInput").forEach(input => {
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const id = input.getAttribute("data-id");
      const formData = new FormData();
      formData.append("srt_file", file);
      showToast("Uploading SRT...", "info");
      try {
        const res = await fetch(`/api/bookmark/${id}/upload_srt`, { method: "POST", body: formData });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return showToast(j.error || "Upload failed.", "error");
        showToast("SRT uploaded successfully", "success");
        await refreshCurrentView();
      } catch (err) {
        showToast("Upload failed: " + err.message, "error");
      }
    };
  });

  // Delete buttons
  el.querySelectorAll(".miniBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const ok = await showModal("Delete Entry", "Are you sure you want to delete this entry?", "Delete", true);
      if (!ok) return;
      await fetch(`/api/bookmark/${id}`, { method: "DELETE" });
      showToast("Entry deleted", "success");
      await refreshCurrentView();
      await loadAll();
    };
  });
}

// ══════════════════════════════════════════════════════
//  Bulk Operations (#12)
// ══════════════════════════════════════════════════════

function updateBulkBar() {
  const bar = document.getElementById("bulkBar");
  const count = selectedIds.size;
  if (count > 0) {
    bar.style.display = "";
    document.getElementById("bulkCount").textContent = `${count} selected`;
  } else {
    bar.style.display = "none";
  }
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll(".cardCheckbox").forEach(cb => { cb.checked = false; });
  document.querySelectorAll(".card.selected, .mediaCard.selected").forEach(c => c.classList.remove("selected"));
  updateBulkBar();
}

async function bulkDelete() {
  if (selectedIds.size === 0) return;
  const ok = await showModal(
    "Delete Selected",
    `Delete ${selectedIds.size} selected entries? This cannot be undone.`,
    "Delete All",
    true
  );
  if (!ok) return;

  showToast("Deleting...", "info");
  await fetch("/api/bookmarks/bulk_delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: Array.from(selectedIds) })
  });
  showToast(`Deleted ${selectedIds.size} entries`, "success");
  selectedIds.clear();
  updateBulkBar();
  await refreshCurrentView();
  await loadAll();
}

async function bulkMove() {
  if (selectedIds.size === 0) return;
  const folderId = await showMoveModal(`Move ${selectedIds.size} entries`);
  if (!folderId) return;

  showToast("Moving...", "info");
  await fetch("/api/bookmarks/bulk_move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: Array.from(selectedIds), folder_id: folderId })
  });
  showToast(`Moved ${selectedIds.size} entries`, "success");
  selectedIds.clear();
  updateBulkBar();
  await refreshCurrentView();
  await loadAll();
}

window.bulkDelete = bulkDelete;
window.bulkMove = bulkMove;
window.clearSelection = clearSelection;

// ══════════════════════════════════════════════════════
//  Utility Functions
// ══════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════
//  VOD / Media Adding (#6 loading states)
// ══════════════════════════════════════════════════════

async function newFolder() {
  const name = prompt("Folder name");
  if (!name) return;
  showToast("Creating folder...", "info");
  await fetch("/api/folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent_id: currentMode === "folder" ? (current || ROOT) : ROOT })
  });
  showToast(`Folder "${name}" created`, "success");
  await loadAll();
}

async function addVod() {
  if (currentMode !== "folder" || !current) {
    return showToast("Select a real folder first (merged views are read-only).", "error");
  }
  const url = document.getElementById("url").value.trim();
  if (!url) return;

  showToast("Fetching metadata...", "info");
  const res = await fetch("/api/bookmark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: current, url, entry_type: "youtube" })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(j.error || "Failed to add VOD.", "error");
    return;
  }
  showToast("VOD added successfully!", "success");
  document.getElementById("url").value = "";
  await refreshCurrentView();
  await loadAll();
}

async function addMedia() {
  if (currentMode !== "folder" || !current) {
    return showToast("Select a real folder first (merged views are read-only).", "error");
  }
  const title = document.getElementById("mediaTitle").value.trim();
  const date = document.getElementById("mediaDate").value.trim();

  if (!title || !date) {
    showToast("Please fill in both title and year.", "error");
    return;
  }

  showToast("Adding media...", "info");
  const res = await fetch("/api/bookmark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: current, title, date, entry_type: "media" })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    showToast(j.error || "Failed to add media.", "error");
    return;
  }
  showToast("Media added!", "success");
  document.getElementById("mediaTitle").value = "";
  document.getElementById("mediaDate").value = "";
  await refreshCurrentView();
  await loadAll();
}

window.newFolder = newFolder;
window.addVod = addVod;
window.addMedia = addMedia;

// ══════════════════════════════════════════════════════
//  Tab Switching
// ══════════════════════════════════════════════════════

let activeTab = "vod";

function switchTab(tab) {
  activeTab = tab;
  document.getElementById("tab-vod").style.display = tab === "vod" ? "" : "none";
  document.getElementById("tab-medialog").style.display = tab === "medialog" ? "" : "none";

  document.querySelectorAll(".tabBtn").forEach(btn => {
    btn.classList.remove("tabActive");
    btn.setAttribute("aria-selected", "false");
  });
  const idx = tab === "vod" ? 0 : 1;
  const btns = document.querySelectorAll(".tabBtn");
  btns[idx].classList.add("tabActive");
  btns[idx].setAttribute("aria-selected", "true");

  // Close mobile sidebar on tab switch
  closeSidebar();

  if (tab === "medialog") {
    loadMediaLog(mlCurrentCategory);
  }
}
window.switchTab = switchTab;

// ══════════════════════════════════════════════════════
//  Mobile Sidebar (#1 responsive)
// ══════════════════════════════════════════════════════

function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  const sidebar = activeTab === "vod"
    ? document.querySelector(".sidebar")
    : document.querySelector(".mlSidebar");

  if (sidebar) sidebar.classList.toggle("sidebarOpen", sidebarOpen);

  // Manage backdrop
  let backdrop = document.querySelector(".sidebarBackdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "sidebarBackdrop";
    backdrop.onclick = closeSidebar;
    document.body.appendChild(backdrop);
  }
  backdrop.classList.toggle("active", sidebarOpen);
}

function closeSidebar() {
  sidebarOpen = false;
  document.querySelectorAll(".sidebar, .mlSidebar").forEach(s => s.classList.remove("sidebarOpen"));
  const backdrop = document.querySelector(".sidebarBackdrop");
  if (backdrop) backdrop.classList.remove("active");
}

window.toggleSidebar = toggleSidebar;

// ══════════════════════════════════════════════════════
//  Media Log
// ══════════════════════════════════════════════════════

let mlCurrentCategory = "anime";
let mlCurrentCards = [];

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
  closeSidebar();
}
window.selectCategory = selectCategory;

async function loadMediaLog(category) {
  const r = await fetch(`/api/media_log?category=${encodeURIComponent(category)}`);
  const data = await r.json();
  mlCurrentCards = data;
  applyMlSearchAndSort();
}

function applyMlSearchAndSort() {
  let list = [...mlCurrentCards];

  const query = (document.getElementById("mlSearchInput").value || "").trim().toLowerCase();
  if (query) {
    list = list.filter(item => {
      const title = (item.title || "").toLowerCase();
      const progress = (item.progress || "").toLowerCase();
      return title.includes(query) || progress.includes(query);
    });
  }

  const sortVal = document.getElementById("mlSortSelect").value;
  if (sortVal === "title_asc") list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  else if (sortVal === "title_desc") list.sort((a, b) => (b.title || "").localeCompare(a.title || ""));

  renderMediaLogCards(list);
}

function applyMlSort() { applyMlSearchAndSort(); }
window.applyMlSort = applyMlSort;

document.getElementById("mlSearchInput").addEventListener("input", () => {
  applyMlSearchAndSort();
});

function renderMediaLogCards(list) {
  const el = document.getElementById("mlCards");
  el.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    const q = (document.getElementById("mlSearchInput").value || "").trim();
    if (q) {
      el.innerHTML = `<div class="emptyState">
        <div class="emptyIcon">\uD83D\uDD0D</div>
        <div class="emptyTitle">No results found</div>
        <div class="emptyHint">Try a different search term.</div>
      </div>`;
    } else {
      el.innerHTML = `<div class="emptyState">
        <div class="emptyIcon">\uD83C\uDFAC</div>
        <div class="emptyTitle">No entries yet</div>
        <div class="emptyHint">Add your first ${mlCurrentCategory} entry using the form above.</div>
      </div>`;
    }
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
      card.setAttribute("role", "listitem");
      animIdx++;

      card.innerHTML = `
        <div class="mlEntryContent">
          <div class="mlEntryInfo">
            <span class="mlEntryTitle" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
            <span class="mlEntryProgress">${escapeHtml(item.progress || "\u2014")}</span>
          </div>
          <div class="mlEntryActions">
            <select class="mlStatusSelect" data-id="${item.id}" aria-label="Status for ${escapeHtml(item.title)}">
              <option value="currently" ${item.status === "currently" ? "selected" : ""}>In Progress</option>
              <option value="completed" ${item.status === "completed" ? "selected" : ""}>Completed</option>
              <option value="plan_to_start" ${item.status === "plan_to_start" ? "selected" : ""}>Planned</option>
            </select>
            <button class="mlEditBtn" data-id="${item.id}" data-title="${escapeHtml(item.title)}" data-progress="${escapeHtml(item.progress || "")}" aria-label="Edit ${escapeHtml(item.title)}">Edit</button>
            <button class="miniBtn mlDelBtn" data-id="${item.id}" aria-label="Delete ${escapeHtml(item.title)}">Delete</button>
          </div>
        </div>`;
      el.appendChild(card);
    }
  }

  // Status change
  el.querySelectorAll(".mlStatusSelect").forEach(sel => {
    sel.onchange = async () => {
      const id = sel.getAttribute("data-id");
      await fetch(`/api/media_log/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: sel.value })
      });
      showToast("Status updated", "success");
      loadMediaLog(mlCurrentCategory);
    };
  });

  // Edit — uses modal (#11)
  el.querySelectorAll(".mlEditBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const oldTitle = btn.getAttribute("data-title");
      const oldProgress = btn.getAttribute("data-progress");
      const result = await showEditModal(oldTitle, oldProgress);
      if (!result || !result.title) return;
      await fetch(`/api/media_log/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: result.title, progress: result.progress })
      });
      showToast("Entry updated", "success");
      loadMediaLog(mlCurrentCategory);
    };
  });

  // Delete — uses modal (#11)
  el.querySelectorAll(".mlDelBtn").forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute("data-id");
      const ok = await showModal("Delete Entry", "Are you sure you want to delete this entry?", "Delete", true);
      if (!ok) return;
      await fetch(`/api/media_log/${id}`, { method: "DELETE" });
      showToast("Entry deleted", "success");
      loadMediaLog(mlCurrentCategory);
    };
  });
}

async function addMediaLogEntry() {
  const titleInput = document.getElementById("mlEntryTitle");
  const progressInput = document.getElementById("mlEntryProgress");
  const statusSelect = document.getElementById("mlEntryStatus");

  const title = titleInput.value.trim();
  if (!title) {
    showToast("Title is required.", "error");
    return;
  }

  showToast("Adding entry...", "info");
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
    showToast(j.error || "Failed to add entry.", "error");
    return;
  }
  showToast("Entry added!", "success");
  titleInput.value = "";
  progressInput.value = "";
  statusSelect.value = "currently";
  loadMediaLog(mlCurrentCategory);
}
window.addMediaLogEntry = addMediaLogEntry;

// ══════════════════════════════════════════════════════
//  Keyboard Shortcuts (#16)
// ══════════════════════════════════════════════════════

document.addEventListener("keydown", (e) => {
  // Don't trigger shortcuts when typing in inputs
  const tag = e.target.tagName;
  const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable;

  // Escape always works
  if (e.key === "Escape") {
    // Close modals (display="" means visible, display="none" means hidden)
    const modal = document.getElementById("modalOverlay");
    if (modal.style.display === "") {
      closeModal();
      return;
    }
    const editModal = document.getElementById("editModalOverlay");
    if (editModal.style.display === "") {
      closeEditModal();
      return;
    }
    const shortcuts = document.getElementById("shortcutsOverlay");
    if (shortcuts.style.display === "") {
      closeShortcutsHelp();
      return;
    }
    // Clear selection
    if (selectedIds.size > 0) {
      clearSelection();
      return;
    }
    // Close sidebar on mobile
    if (sidebarOpen) {
      closeSidebar();
      return;
    }
    // Blur focused input
    if (isInput) {
      e.target.blur();
      return;
    }
    return;
  }

  if (isInput) return;

  switch (e.key) {
    case "/":
      e.preventDefault();
      if (activeTab === "vod") {
        document.getElementById("searchInput").focus();
      } else {
        document.getElementById("mlSearchInput").focus();
      }
      break;
    case "n":
    case "N":
      if (activeTab === "vod") {
        e.preventDefault();
        newFolder();
      }
      break;
    case "t":
    case "T":
      e.preventDefault();
      toggleTheme();
      break;
    case "1":
      e.preventDefault();
      switchTab("vod");
      break;
    case "2":
      e.preventDefault();
      switchTab("medialog");
      break;
    case "?":
      e.preventDefault();
      showShortcutsHelp();
      break;
  }
});
