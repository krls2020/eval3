// --- tiny helpers -----------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const api = {
  async list(q) {
    const url = q ? `/api/notes?q=${encodeURIComponent(q)}` : "/api/notes";
    const r = await fetch(url);
    return r.json();
  },
  async get(id) {
    const r = await fetch(`/api/notes/${id}`);
    return r.json();
  },
  async create() {
    const r = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", content: "" }),
    });
    return r.json();
  },
  async update(id, data) {
    const r = await fetch(`/api/notes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return r.json();
  },
  async remove(id) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
  },
};

function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// --- state ------------------------------------------------------------------
const state = {
  notes: [],
  currentId: null,
  query: "",
  saveTimer: null,
  previewMode: false,
};

// --- rendering --------------------------------------------------------------
async function refreshList() {
  state.notes = await api.list(state.query);
  const list = $("#note-list");
  list.innerHTML = "";

  if (!state.notes.length) {
    list.innerHTML = `<li class="empty-list">${
      state.query ? "No matching notes." : "No notes yet. Create one!"
    }</li>`;
  }

  for (const n of state.notes) {
    const li = document.createElement("li");
    li.className = "note-item" + (n.id === state.currentId ? " active" : "");
    li.dataset.id = n.id;
    li.innerHTML = `
      <div class="ni-title">${escapeHtml(n.title) || "Untitled"}</div>
      <div class="ni-excerpt">${escapeHtml(n.excerpt || "") || "&nbsp;"}</div>
      <div class="ni-date">${fmtDate(n.updated_at)}</div>`;
    li.addEventListener("click", () => openNote(n.id));
    list.appendChild(li);
  }
  $("#count").textContent = `${state.notes.length} note${
    state.notes.length === 1 ? "" : "s"
  }`;
}

function escapeHtml(s) {
  return (s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function openNote(id) {
  const note = await api.get(id);
  if (note.error) return;
  state.currentId = id;
  $("#empty-state").classList.add("hidden");
  $("#editor-pane").classList.remove("hidden");
  $("#title").value = note.title;
  $("#content").value = note.content;
  renderPreview();
  setStatus("");
  document
    .querySelectorAll(".note-item")
    .forEach((el) =>
      el.classList.toggle("active", el.dataset.id === String(id))
    );
}

function renderPreview() {
  $("#preview").innerHTML = window.marked.parse($("#content").value || "");
}

function setStatus(text) {
  $("#status").textContent = text;
}

// --- saving (debounced autosave) -------------------------------------------
function scheduleSave() {
  setStatus("Editing…");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, 600);
}

async function save() {
  if (!state.currentId) return;
  setStatus("Saving…");
  const data = { title: $("#title").value, content: $("#content").value };
  const updated = await api.update(state.currentId, data);
  setStatus("Saved");
  // Update list entry in place without losing focus
  const idx = state.notes.findIndex((n) => n.id === state.currentId);
  if (idx > -1) {
    state.notes[idx].title = updated.title;
    state.notes[idx].excerpt = (updated.content || "").slice(0, 200);
    state.notes[idx].updated_at = updated.updated_at;
  }
  await refreshList();
}

// --- actions ----------------------------------------------------------------
async function newNote() {
  const note = await api.create();
  state.query = "";
  $("#search").value = "";
  await refreshList();
  await openNote(note.id);
  $("#title").focus();
}

async function deleteCurrent() {
  if (!state.currentId) return;
  if (!confirm("Delete this note?")) return;
  await api.remove(state.currentId);
  state.currentId = null;
  $("#editor-pane").classList.add("hidden");
  $("#empty-state").classList.remove("hidden");
  await refreshList();
}

function togglePreview() {
  state.previewMode = !state.previewMode;
  const body = $(".editor-body");
  const preview = $("#preview");
  const btn = $("#preview-toggle");
  if (state.previewMode) {
    renderPreview();
    preview.classList.remove("hidden");
    body.classList.add("preview-only");
    btn.textContent = "Edit";
  } else {
    preview.classList.add("hidden");
    body.classList.remove("preview-only");
    btn.textContent = "Preview";
  }
}

// --- events -----------------------------------------------------------------
$("#new-btn").addEventListener("click", newNote);
$("#delete-btn").addEventListener("click", deleteCurrent);
$("#preview-toggle").addEventListener("click", togglePreview);

$("#title").addEventListener("input", scheduleSave);
$("#content").addEventListener("input", () => {
  if (state.previewMode) renderPreview();
  scheduleSave();
});

let searchTimer;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    refreshList();
  }, 200);
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "n") {
    e.preventDefault();
    newNote();
  }
});

// --- boot -------------------------------------------------------------------
refreshList();
