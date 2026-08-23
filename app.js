const SUPABASE_URL = "https://oiaudmzrwtaljkcwbooi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_IHsq14XmgVhe9J8taquEkg_n_TCiDVn";
const PORTAL_AUTH_URL = `${SUPABASE_URL}/functions/v1/portal-auth`;

const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
});

const $ = (id) => document.getElementById(id);
const screens = { login: $("loginScreen"), otp: $("otpScreen"), reset: $("resetScreen"), app: $("portalApp") };
const showOnly = (name) => Object.entries(screens).forEach(([k, el]) => el?.classList.toggle("hidden", k !== name));

function setMessage(el, msg, type = "error") { if (!el) return; el.textContent = msg; el.className = `form-message ${type}`; }
function clearAuthParameters(){ history.replaceState({}, document.title, window.location.pathname); }
function getHashParams(){ return new URLSearchParams(window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash); }

$("theme")?.addEventListener("click", () => { document.body.classList.toggle("dark"); $("theme").textContent = document.body.classList.contains("dark") ? "Light Mode" : "Dark Mode"; });
document.querySelectorAll(".toggle-password").forEach(btn => btn.addEventListener("click", () => { const input = $(btn.dataset.target); if (!input) return; const show = input.type === "password"; input.type = show ? "text" : "password"; btn.textContent = show ? "Hide" : "Show"; }));

async function loadRecoverySession(){
  const hash = getHashParams();
  const type = hash.get("type");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const code = new URLSearchParams(location.search).get("code");
  const isRecovery = type === "recovery" || (!!accessToken && !!refreshToken) || !!code;
  if (!isRecovery) return false;
  showOnly("reset");
  let error = null;
  if (code) ({ error } = await client.auth.exchangeCodeForSession(code));
  else if (accessToken && refreshToken) ({ error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }));
  else error = new Error("Recovery session missing");
  if (error) { setMessage($("resetMessage"), "This recovery link is invalid or expired."); $("savePasswordBtn").disabled = true; return true; }
  clearAuthParameters();
  return true;
}

$("resetPasswordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = $("newPassword").value, p2 = $("confirmPassword").value;
  if (p1.length < 8) return setMessage($("resetMessage"), "Use at least 8 characters.");
  if (p1 !== p2) return setMessage($("resetMessage"), "The two passwords do not match.");
  $("savePasswordBtn").disabled = true; $("savePasswordBtn").textContent = "Saving...";
  const { error } = await client.auth.updateUser({ password: p1 });
  if (error) { setMessage($("resetMessage"), error.message || "Unable to update password."); $("savePasswordBtn").disabled = false; $("savePasswordBtn").textContent = "Save new password"; return; }
  await client.auth.signOut(); $("resetFormWrap").classList.add("hidden"); $("resetSuccess").classList.remove("hidden");
});

$("goToLoginBtn")?.addEventListener("click", () => { clearAuthParameters(); showOnly("login"); });

async function callPortalAuth(payload){
  const res = await fetch(PORTAL_AUTH_URL, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify(payload) });
  let data = {}; try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

$("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const loginId = $("loginId").value.trim(); const password = $("loginPassword").value;
  $("loginBtn").disabled = true; $("loginBtn").textContent = "Signing in..."; setMessage($("loginMessage"), "", "ok");
  try {
    const { data } = await callPortalAuth({ action: "login", loginId, password });
    if (data?.success && data?.session) {
      const { error } = await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
      if (error) throw error;
      showOnly("app"); $("loginPassword").value = ""; return;
    }
    if (data?.verificationRequired) { sessionStorage.setItem("portalLoginId", loginId); setMessage($("otpMessage"), data.message || "Verification required.", "ok"); showOnly("otp"); return; }
    setMessage($("loginMessage"), data?.message || "Sign in failed.");
  } catch (err) { setMessage($("loginMessage"), "Unable to reach the authentication service."); }
  finally { $("loginBtn").disabled = false; $("loginBtn").textContent = "Sign in"; }
});

$("otpForm")?.addEventListener("submit", async (e) => {
  e.preventDefault(); const loginId = sessionStorage.getItem("portalLoginId") || $("loginId").value.trim(); const otp = $("otpCode").value.trim();
  $("verifyBtn").disabled = true; $("verifyBtn").textContent = "Verifying...";
  try { const { data } = await callPortalAuth({ action: "verify", loginId, otp }); if (data?.success && data?.session) { await client.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }); sessionStorage.removeItem("portalLoginId"); showOnly("app"); return; } setMessage($("otpMessage"), data?.message || "Verification failed."); }
  catch { setMessage($("otpMessage"), "Unable to verify the code."); }
  finally { $("verifyBtn").disabled = false; $("verifyBtn").textContent = "Verify"; }
});

$("resendBtn")?.addEventListener("click", async () => { const loginId = sessionStorage.getItem("portalLoginId") || $("loginId").value.trim(); const { data } = await callPortalAuth({ action: "resend", loginId }); setMessage($("otpMessage"), data?.message || "Unable to resend code.", data?.success ? "ok" : "error"); });

$("logoutBtn")?.addEventListener("click", async () => { await client.auth.signOut(); sessionStorage.removeItem("portalLoginId"); showOnly("login"); });
$("settingsBtn")?.addEventListener("click", () => alert("Settings will be added in a later module."));

// ==============================
// NOTES MODULE
// ==============================
const notesState = {
  user: null,
  notebooks: [],
  notes: [],
  notebookCounts: {},
  totalNotesCount: 0,
  selectedNotebookId: "all",
  selectedNoteId: null,
  editor: null,
  editorReady: false,
  saveTimer: null,
  search: "",
  viewMode: localStorage.getItem("portalNotesViewMode") || "compact",
  orderBy: localStorage.getItem("portalNotesOrderBy") || "updated_at",
  sortDirection: localStorage.getItem("portalNotesSortDirection") || "desc",
  groupBy: localStorage.getItem("portalNotesGroupBy") || "default",
};

const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };

function showPortalView(view){
  $("dashboardView").classList.toggle("hidden", view !== "dashboard");
  $("notesView").classList.toggle("hidden", view !== "notes");
  $("navDashboard").classList.toggle("active", view === "dashboard");
  $("navNotes").classList.toggle("active", view === "notes");
}

function showNotesError(message){
  const el = $("notesError");
  if (!message) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.textContent = message;
  el.classList.remove("hidden");
}

function ensureUiLayers(){
  if (!$("portalModalOverlay")) {
    const overlay = document.createElement("div");
    overlay.id = "portalModalOverlay";
    overlay.className = "portal-modal-overlay hidden";
    overlay.innerHTML = `
      <div class="portal-modal" role="dialog" aria-modal="true" aria-labelledby="portalModalTitle">
        <h3 id="portalModalTitle"></h3>
        <p id="portalModalMessage" class="portal-modal-message hidden"></p>
        <input id="portalModalInput" class="portal-modal-input hidden" />
        <div class="portal-modal-actions">
          <button id="portalModalCancel" class="portal-modal-btn secondary">Cancel</button>
          <button id="portalModalConfirm" class="portal-modal-btn primary">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  if (!$("notebookContextMenu")) {
    const menu = document.createElement("div");
    menu.id = "notebookContextMenu";
    menu.className = "notebook-context-menu hidden";
    menu.innerHTML = notebookActionMenuHtml();
    document.body.appendChild(menu);
  }

  if (!$("noteContextMenu")) {
    const menu = document.createElement("div");
    menu.id = "noteContextMenu";
    menu.className = "note-context-menu hidden";
    document.body.appendChild(menu);
  }
}

function hideNotebookContextMenu(){
  $("notebookContextMenu")?.classList.add("hidden");
}

const NOTEBOOK_ACTIONS = [
  { id: "rename", label: "Rename", danger: false },
  { id: "delete", label: "Delete", danger: true },
];

function notebookActionMenuHtml(){
  return NOTEBOOK_ACTIONS.map((item) => `
    <button data-action="${item.id}" class="${item.danger ? "danger" : ""}">
      ${item.label}
    </button>
  `).join("");
}

function showNotebookDotsMenu(button, nb){
  ensureUiLayers();

  const menu = $("notebookContextMenu");
  menu.dataset.notebookId = nb.id;
  menu.innerHTML = notebookActionMenuHtml();
  menu.innerHTML = notebookActionMenuHtml();

  const rect = button.getBoundingClientRect();
  const menuWidth = 160;
  const menuHeight = 92;

  menu.style.left = `${Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)}px`;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menuHeight - 8)}px`;
  menu.classList.remove("hidden");
}

function showNotebookContextMenu(event, nb){
  ensureUiLayers();
  event.preventDefault();
  event.stopPropagation();

  const menu = $("notebookContextMenu");
  menu.dataset.notebookId = nb.id;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - 110)}px`;
  menu.classList.remove("hidden");
}

function centeredModal({
  title,
  message = "",
  inputValue = null,
  inputPlaceholder = "",
  confirmText = "OK",
  cancelText = "Cancel",
  destructive = false,
  showCancel = true,
}){
  ensureUiLayers();

  return new Promise((resolve) => {
    const overlay = $("portalModalOverlay");
    const titleEl = $("portalModalTitle");
    const messageEl = $("portalModalMessage");
    const input = $("portalModalInput");
    const confirmBtn = $("portalModalConfirm");
    const cancelBtn = $("portalModalCancel");

    titleEl.textContent = title || "";
    messageEl.textContent = message || "";
    messageEl.classList.toggle("hidden", !message);

    const hasInput = inputValue !== null;
    input.classList.toggle("hidden", !hasInput);
    if (hasInput) {
      input.value = inputValue ?? "";
      input.placeholder = inputPlaceholder || "";
    }

    confirmBtn.textContent = confirmText;
    confirmBtn.classList.toggle("danger", destructive);
    confirmBtn.classList.toggle("primary", !destructive);

    cancelBtn.textContent = cancelText;
    cancelBtn.classList.toggle("hidden", !showCancel);

    overlay.classList.remove("hidden");

    const finish = (value) => {
      overlay.classList.add("hidden");
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
      overlay.onclick = null;
      input.onkeydown = null;
      resolve(value);
    };

    confirmBtn.onclick = () => finish(hasInput ? input.value.trim() : true);
    cancelBtn.onclick = () => finish(null);
    overlay.onclick = (e) => {
      if (e.target === overlay && showCancel) finish(null);
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") finish(input.value.trim());
      if (e.key === "Escape" && showCancel) finish(null);
    };

    setTimeout(() => {
      if (hasInput) {
        input.focus();
        input.select();
      } else {
        confirmBtn.focus();
      }
    }, 0);
  });
}

async function centeredMessage(title, message){
  await centeredModal({
    title,
    message,
    confirmText: "OK",
    showCancel: false,
  });
}

async function getSafeFallbackNotebook(excludeNotebookId){
  let fallback = notesState.notebooks.find(
    (item) =>
      item.id !== excludeNotebookId &&
      item.name.trim().toLowerCase() === "personal"
  );

  if (!fallback) {
    fallback = notesState.notebooks.find((item) => item.id !== excludeNotebookId);
  }

  if (fallback) return fallback;

  const user = await getCurrentUser();
  const { data, error } = await client
    .from("notebooks")
    .insert({
      user_id: user.id,
      name: "Personal",
      icon: "folder",
      sort_order: 0,
    })
    .select()
    .single();

  if (error) throw error;
  notesState.notebooks.push(data);
  return data;
}

async function renameNotebook(nb){
  const name = await centeredModal({
    title: "Rename Notebook",
    message: "Enter a new notebook name.",
    inputValue: nb.name,
    confirmText: "Rename",
  });

  if (!name || name === nb.name) return;

  const duplicate = notesState.notebooks.some(
    (item) =>
      item.id !== nb.id &&
      item.name.trim().toLowerCase() === name.toLowerCase()
  );

  if (duplicate) {
    await centeredMessage(
      "Duplicate Notebook",
      `A notebook named "${name}" already exists.`
    );
    return;
  }

  const { error } = await client
    .from("notebooks")
    .update({ name })
    .eq("id", nb.id);

  if (error) {
    if (
      error.code === "23505" ||
      String(error.message || "").toLowerCase().includes("duplicate")
    ) {
      await centeredMessage(
        "Duplicate Notebook",
        `A notebook named "${name}" already exists.`
      );
      return;
    }
    return showNotesError(error.message);
  }

  await loadNotebooks();
  renderNotebooks();

  const currentNote = notesState.notes.find(
    (n) => n.id === notesState.selectedNoteId
  );
  if (currentNote) renderEditorNotebookSelector(currentNote);

  await centeredMessage("Renamed", `Notebook renamed to "${name}".`);
}

async function deleteNotebookSafely(nb){
  const noteCount = notesState.notebookCounts[nb.id] || 0;

  const confirmed = await centeredModal({
    title: "Delete Notebook",
    message:
      noteCount > 0
        ? `"${nb.name}" contains ${noteCount} note(s). The notes will be moved safely before the notebook is deleted.`
        : `Delete empty notebook "${nb.name}"?`,
    confirmText: "Delete",
    destructive: true,
  });

  if (!confirmed) return;

  let fallback = null;

  if (noteCount > 0) {
    try {
      fallback = await getSafeFallbackNotebook(nb.id);
    } catch (error) {
      return showNotesError(error.message || "Could not prepare a safe notebook.");
    }

    const { error: moveError } = await client
      .from("notes")
      .update({ notebook_id: fallback.id })
      .eq("notebook_id", nb.id);

    if (moveError) {
      await centeredMessage(
        "Delete Cancelled",
        "The notes could not be moved safely, so the notebook was not deleted."
      );
      return;
    }
  }

  const { error } = await client
    .from("notebooks")
    .delete()
    .eq("id", nb.id);

  if (error) return showNotesError(error.message);

  if (notesState.selectedNotebookId === nb.id) {
    notesState.selectedNotebookId = fallback?.id || "all";
  }

  await loadNotebooks();
  await loadNoteCounts();
  await loadNotes();
  renderNotebooks();
  clearEditorSelection();

  await centeredMessage(
    "Notebook Deleted",
    noteCount > 0 && fallback
      ? `Notebook deleted. ${noteCount} note(s) were moved to "${fallback.name}".`
      : "Notebook deleted."
  );
}

async function handleNotebookContextAction(action, nb){
  hideNotebookContextMenu();
  if (action === "rename") return renameNotebook(nb);
  if (action === "delete") return deleteNotebookSafely(nb);
}

document.addEventListener("click", (event) => {
  const notebookMenu = $("notebookContextMenu");
  if (notebookMenu && !notebookMenu.contains(event.target)) hideNotebookContextMenu();

  const noteMenu = $("noteContextMenu");
  if (noteMenu && !noteMenu.contains(event.target)) hideNoteContextMenu();
});

window.addEventListener("resize", () => {
  hideNotebookContextMenu();
  hideNoteContextMenu();
});

window.addEventListener("scroll", () => {
  hideNotebookContextMenu();
  hideNoteContextMenu();
}, true);

function ensureEditorNotebookSelector(){
  let select = $("noteNotebookSelect");
  if (select) return select;

  const actions = document.querySelector(".editor-actions");
  if (!actions) return null;

  select = document.createElement("select");
  select.id = "noteNotebookSelect";
  select.title = "Move note to another notebook";
  select.style.height = "34px";
  select.style.border = "1px solid #dfe3ea";
  select.style.borderRadius = "8px";
  select.style.background = "#fff";
  select.style.color = "#45505f";
  select.style.padding = "0 9px";
  select.style.maxWidth = "180px";
  select.style.fontSize = "12px";
  select.style.cursor = "pointer";

  actions.insertBefore(select, $("saveStatus"));

  select.addEventListener("change", moveCurrentNoteToNotebook);
  return select;
}

function renderEditorNotebookSelector(note){
  const select = ensureEditorNotebookSelector();
  if (!select || !note) return;

  select.innerHTML = "";

  for (const nb of notesState.notebooks) {
    const option = document.createElement("option");
    option.value = nb.id;
    option.textContent = nb.name;
    option.selected = note.notebook_id === nb.id;
    select.appendChild(option);
  }

  if (!note.notebook_id) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No Notebook";
    option.selected = true;
    select.insertBefore(option, select.firstChild);
  }
}

async function moveCurrentNoteToNotebook(event){
  const noteId = notesState.selectedNoteId;
  if (!noteId) return;

  const note = notesState.notes.find((n) => n.id === noteId);
  if (!note) return;

  const targetNotebookId = event.target.value || null;
  if (note.notebook_id === targetNotebookId) return;

  $("saveStatus").textContent = "Moving...";

  const { data, error } = await client
    .from("notes")
    .update({ notebook_id: targetNotebookId })
    .eq("id", noteId)
    .select("notebook_id,updated_at")
    .single();

  if (error) {
    $("saveStatus").textContent = "Move failed";
    showNotesError(error.message);
    renderEditorNotebookSelector(note);
    return;
  }

  note.notebook_id = data.notebook_id;
  note.updated_at = data.updated_at;

  await loadNoteCounts();

  if (
    notesState.selectedNotebookId !== "all" &&
    notesState.selectedNotebookId !== targetNotebookId
  ) {
    notesState.selectedNoteId = null;
    await loadNotes();
    renderNotebooks();
    clearEditorSelection();
  } else {
    await loadNotes();
    renderNotebooks();
    renderEditorNotebookSelector(note);
    $("saveStatus").textContent = "Saved";
  }
}

async function getCurrentUser(){
  if (notesState.user) return notesState.user;
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Error("Your session is not available. Please sign in again.");
  notesState.user = user;
  return user;
}

async function ensureDefaultNotebook(){
  if (notesState.notebooks.length) return;
  const user = await getCurrentUser();
  const { data, error } = await client.from("notebooks").insert({
    user_id: user.id,
    name: "Personal",
    icon: "folder",
    sort_order: 0,
  }).select().single();
  if (error) throw error;
  notesState.notebooks = [data];
}

async function loadNotebooks(){
  const user = await getCurrentUser();
  const { data, error } = await client.from("notebooks")
    .select("id,name,icon,sort_order,created_at,updated_at")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  notesState.notebooks = data || [];
  await ensureDefaultNotebook();
  renderNotebooks();
}

async function loadNoteCounts(){
  const user = await getCurrentUser();
  const { data, error } = await client.from("notes")
    .select("notebook_id")
    .eq("user_id", user.id)
    .eq("is_deleted", false)
    .eq("is_archived", false);

  if (error) throw error;

  const counts = {};
  for (const note of (data || [])) {
    const key = note.notebook_id || "__none__";
    counts[key] = (counts[key] || 0) + 1;
  }

  notesState.notebookCounts = counts;
  notesState.totalNotesCount = (data || []).length;
}

async function loadNotes(){
  const user = await getCurrentUser();
  let query = client.from("notes")
    .select("id,notebook_id,title,content,preview,is_pinned,is_favorite,is_locked,color,updated_at,created_at")
    .eq("user_id", user.id)
    .eq("is_deleted", false)
    .eq("is_archived", false)
    .order("is_pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  if (notesState.selectedNotebookId !== "all") query = query.eq("notebook_id", notesState.selectedNotebookId);

  const { data, error } = await query;
  if (error) throw error;
  notesState.notes = data || [];
  renderNotes();
}

function renderNotebooks(){
  const list = $("notebookList");
  list.innerHTML = "";
  for (const nb of notesState.notebooks) {
    const count = notesState.selectedNotebookId === "all"
      ? ""
      : "";
    const row = document.createElement("div");
    row.className = "notebook-row";
    row.innerHTML = `
      <button class="notebook-item ${notesState.selectedNotebookId === nb.id ? "active" : ""}" data-id="${nb.id}">
        <span class="notebook-icon">▤</span>
        <span class="notebook-name"></span>
        <span class="notebook-count"></span>
      </button>
      <button class="notebook-menu" title="Notebook menu" aria-label="Notebook menu">⋮</button>
    `;
    row.querySelector(".notebook-name").textContent = nb.name;
    const nbCount = notesState.notebookCounts[nb.id] || 0;
    row.querySelector(".notebook-count").textContent = nbCount;

    const notebookButton = row.querySelector(".notebook-item");
    const dotsButton = row.querySelector(".notebook-menu");

    notebookButton.addEventListener("click", async () => {
      notesState.selectedNotebookId = nb.id;
      notesState.selectedNoteId = null;
      await loadNotes();
      renderNotebooks();
      clearEditorSelection();
    });

    notebookButton.addEventListener("contextmenu", (event) => {
      notesState.selectedNotebookId = nb.id;
      renderNotebooks();
      showNotebookContextMenu(event, nb);
    });

    dotsButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      notesState.selectedNotebookId = nb.id;
      renderNotebooks();
      const liveRow = [...document.querySelectorAll(".notebook-row")].find(
        (item) => item.querySelector(".notebook-item")?.dataset.id === nb.id
      );
      const liveDots = liveRow?.querySelector(".notebook-menu");
      if (liveDots) showNotebookDotsMenu(liveDots, nb);
    });

    list.appendChild(row);
  }
  document.querySelector('[data-notebook="all"]').classList.toggle("active", notesState.selectedNotebookId === "all");
  $("allNotesCount").textContent = notesState.totalNotesCount;
}

async function notebookMenu(nb){
  const action = await centeredModal({
    title: nb.name,
    message: "Choose an action.",
    confirmText: "Rename",
  });
  if (action) return renameNotebook(nb);
}

async function createNotebook(){
  const name = await centeredModal({
    title: "New Notebook",
    message: "Enter a notebook name.",
    inputValue: "",
    inputPlaceholder: "Notebook name",
    confirmText: "Create",
  });

  if (!name) return;

  const normalizedName = name.toLowerCase();

  const duplicate = notesState.notebooks.some(
    (item) => item.name.trim().toLowerCase() === normalizedName
  );

  if (duplicate) {
    await centeredMessage(
      "Duplicate Notebook",
      `A notebook named "${name}" already exists.`
    );
    return;
  }

  const user = await getCurrentUser();

  const { data, error } = await client.from("notebooks").insert({
    user_id: user.id,
    name,
    icon: "folder",
    sort_order: notesState.notebooks.length,
  }).select().single();

  if (error) {
    if (
      error.code === "23505" ||
      String(error.message || "").toLowerCase().includes("duplicate")
    ) {
      await centeredMessage(
        "Duplicate Notebook",
        `A notebook named "${name}" already exists.`
      );
      return;
    }
    return showNotesError(error.message);
  }

  notesState.notebooks.push(data);
  notesState.selectedNotebookId = data.id;
  await loadNoteCounts();
  await loadNotes();
  renderNotebooks();

  await centeredMessage("Notebook Created", `"${name}" was created.`);
}


function hideNoteContextMenu(){
  $("noteContextMenu")?.classList.add("hidden");
}

function noteActionMenuItems(note){
  return [
    { id: "pin", icon: note.is_pinned ? "📌" : "📍", label: note.is_pinned ? "Unpin" : "Pin", group: 1 },
    { id: "favorite", icon: note.is_favorite ? "★" : "☆", label: note.is_favorite ? "Remove Favorite" : "Favorite", group: 1 },

    { id: "move", icon: "▤", label: "Move to Notebook", group: 2 },
    { id: "color", icon: "◉", label: "Assign Color", group: 2 },
    { id: "duplicate", icon: "⧉", label: "Duplicate", group: 2 },

    { id: "trash", icon: "🗑", label: "Move to Trash", group: 3, danger: true },
  ];
}

function noteActionMenuHtml(note){
  const items = noteActionMenuItems(note);
  let lastGroup = null;
  return items.map((item) => {
    const divider = lastGroup !== null && item.group !== lastGroup
      ? '<div class="note-menu-divider"></div>'
      : "";
    lastGroup = item.group;

    return `${divider}
      <button data-note-action="${item.id}" class="${item.danger ? "danger" : ""}">
        <span class="note-menu-icon" aria-hidden="true">${item.icon}</span>
        <span>${item.label}</span>
      </button>`;
  }).join("");
}

function positionFloatingMenu(menu, x, y, width = 205, height = 250){
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

function showNoteContextMenuAt(x, y, note){
  ensureUiLayers();
  hideNotebookContextMenu();

  const menu = $("noteContextMenu");
  menu.dataset.noteId = note.id;
  menu.innerHTML = noteActionMenuHtml(note);
  positionFloatingMenu(menu, x, y);
  menu.classList.remove("hidden");
}

function showNoteDotsMenu(button, note){
  const rect = button.getBoundingClientRect();
  showNoteContextMenuAt(rect.right - 205, rect.bottom + 5, note);
}

function centeredChoiceModal({
  title,
  message = "",
  choices = [],
  cancelText = "Cancel",
  variant = "list",
}){
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "portal-modal-overlay";
    overlay.innerHTML = `
      <div class="portal-modal note-choice-modal" role="dialog" aria-modal="true">
        <h3></h3>
        <p class="portal-modal-message ${message ? "" : "hidden"}"></p>
        <div class="note-choice-list ${variant === "palette" ? "color-palette-grid" : ""}"></div>
        <div class="portal-modal-actions">
          <button type="button" class="portal-modal-btn secondary note-choice-cancel">${cancelText}</button>
        </div>
      </div>
    `;

    overlay.querySelector("h3").textContent = title;
    overlay.querySelector(".portal-modal-message").textContent = message;

    const list = overlay.querySelector(".note-choice-list");
    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = variant === "palette" ? "color-choice" : "note-choice-button";
      button.dataset.value = choice.value;
      button.title = choice.label || choice.value;

      if (variant === "palette") {
        if (choice.value) {
          button.style.setProperty("--choice-color", choice.value);
          button.innerHTML = `<span class="color-choice-dot"></span><span>${choice.label}</span>`;
        } else {
          button.innerHTML = `<span class="color-choice-dot no-color"></span><span>${choice.label}</span>`;
        }
      } else {
        button.innerHTML = `
          <span class="note-choice-icon">${choice.icon || "▤"}</span>
          <span>${choice.label}</span>
          ${choice.meta ? `<small>${choice.meta}</small>` : ""}
        `;
      }

      button.addEventListener("click", () => finish(choice.value));
      list.appendChild(button);
    }

    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector(".note-choice-cancel").addEventListener("click", () => finish(null));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });

    document.body.appendChild(overlay);
    const first = list.querySelector("button");
    setTimeout(() => first?.focus(), 0);
  });
}

async function updateNoteActionFields(noteId, patch){
  const { data, error } = await client
    .from("notes")
    .update(patch)
    .eq("id", noteId)
    .select("id,notebook_id,title,content,preview,is_pinned,is_favorite,is_locked,color,updated_at,created_at")
    .single();

  if (error) {
    showNotesError(error.message);
    return null;
  }

  return data;
}

async function refreshNotesAfterAction(preferredNoteId = null){
  await loadNoteCounts();
  await loadNotes();
  renderNotebooks();

  if (preferredNoteId) {
    const stillVisible = notesState.notes.some((note) => note.id === preferredNoteId);
    if (stillVisible) {
      await selectNote(preferredNoteId);
      return;
    }
  }

  if (notesState.selectedNoteId && !notesState.notes.some((note) => note.id === notesState.selectedNoteId)) {
    notesState.selectedNoteId = null;
    clearEditorSelection();
  }
}

async function toggleNotePin(note){
  const updated = await updateNoteActionFields(note.id, { is_pinned: !note.is_pinned });
  if (!updated) return;
  await refreshNotesAfterAction(note.id);
}

async function toggleNoteFavorite(note){
  const updated = await updateNoteActionFields(note.id, { is_favorite: !note.is_favorite });
  if (!updated) return;
  await refreshNotesAfterAction(note.id);
}

async function moveNoteFromAction(note){
  const choices = notesState.notebooks.map((nb) => ({
    value: nb.id,
    label: nb.name,
    icon: nb.id === note.notebook_id ? "✓" : "▤",
    meta: nb.id === note.notebook_id ? "Current" : "",
  }));

  const targetId = await centeredChoiceModal({
    title: "Move to Notebook",
    message: "Choose the destination notebook.",
    choices,
  });

  if (!targetId || targetId === note.notebook_id) return;

  const updated = await updateNoteActionFields(note.id, { notebook_id: targetId });
  if (!updated) return;

  await refreshNotesAfterAction(
    notesState.selectedNotebookId === "all" || notesState.selectedNotebookId === targetId
      ? note.id
      : null
  );

  await centeredMessage(
    "Note Moved",
    `Moved to "${getNotebookName(targetId)}".`
  );
}

async function assignNoteColor(note){
  const palette = [
    { value: "", label: "No color" },
    { value: "#ef4444", label: "Red" },
    { value: "#f97316", label: "Orange" },
    { value: "#eab308", label: "Yellow" },
    { value: "#22c55e", label: "Green" },
    { value: "#06b6d4", label: "Cyan" },
    { value: "#3b82f6", label: "Blue" },
    { value: "#8b5cf6", label: "Violet" },
    { value: "#ec4899", label: "Pink" },
    { value: "#64748b", label: "Slate" },
  ];

  const color = await centeredChoiceModal({
    title: "Assign Color",
    message: "Choose a color for this note.",
    choices: palette,
    variant: "palette",
  });

  if (color === null) return;

  const updated = await updateNoteActionFields(note.id, { color: color || null });
  if (!updated) return;
  await refreshNotesAfterAction(note.id);
}

async function duplicateNote(note){
  const user = await getCurrentUser();
  const baseTitle = note.title || "Untitled Note";
  const newTitle = `${baseTitle} — Copy`;

  const { data, error } = await client
    .from("notes")
    .insert({
      user_id: user.id,
      notebook_id: note.notebook_id,
      title: newTitle,
      content: note.content || emptyDoc,
      preview: note.preview || "",
      is_pinned: false,
      is_favorite: false,
      color: note.color || null,
    })
    .select()
    .single();

  if (error) {
    showNotesError(error.message);
    return;
  }

  await refreshNotesAfterAction(data.id);
  await centeredMessage("Note Duplicated", `"${newTitle}" was created.`);
}

async function moveNoteToTrash(note){
  const confirmed = await centeredModal({
    title: "Move to Trash",
    message: `Move "${note.title || "Untitled Note"}" to Trash?`,
    confirmText: "Move to Trash",
    destructive: true,
  });

  if (!confirmed) return;

  const { error } = await client
    .from("notes")
    .update({
      is_deleted: true,
      trashed_at: new Date().toISOString(),
    })
    .eq("id", note.id);

  if (error) {
    showNotesError(error.message);
    return;
  }

  if (notesState.selectedNoteId === note.id) {
    notesState.selectedNoteId = null;
    clearEditorSelection();
  }

  await refreshNotesAfterAction();
  await centeredMessage("Moved to Trash", "The note is now in Trash.");
}

async function handleNoteAction(action, note){
  hideNoteContextMenu();

  if (action === "pin") return toggleNotePin(note);
  if (action === "favorite") return toggleNoteFavorite(note);
  if (action === "move") return moveNoteFromAction(note);
  if (action === "color") return assignNoteColor(note);
  if (action === "duplicate") return duplicateNote(note);
  if (action === "trash") return moveNoteToTrash(note);
}

function noteMatchesSearch(note){
  const q = notesState.search.toLowerCase().trim();
  if (!q) return true;
  return `${note.title || ""} ${note.preview || ""}`.toLowerCase().includes(q);
}


function getNotebookName(notebookId){
  if (!notebookId) return "No Notebook";
  return notesState.notebooks.find((nb) => nb.id === notebookId)?.name || "Unknown Notebook";
}

function relativeEditedTime(dateValue){
  const date = new Date(dateValue);
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}m`;
  return `${Math.floor(days / 365)}y`;
}

function notesCompare(a, b){
  const direction = notesState.sortDirection === "asc" ? 1 : -1;

  if (notesState.orderBy === "title") {
    return (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }) * direction;
  }

  const key = notesState.orderBy === "created_at" ? "created_at" : "updated_at";
  const av = new Date(a[key]).getTime();
  const bv = new Date(b[key]).getTime();
  return (av - bv) * direction;
}

function weekKey(dateValue){
  const d = new Date(dateValue);
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function defaultGroup(note){
  if (note.is_pinned) return "PINNED";

  const days = Math.floor((Date.now() - new Date(note.updated_at).getTime()) / 86400000);
  if (days <= 7) return "RECENT";
  if (days <= 14) return "LAST WEEK";
  return "OLDER";
}

function groupLabelForNote(note){
  const basis = notesState.orderBy === "created_at" ? note.created_at : note.updated_at;
  const date = new Date(basis);

  switch (notesState.groupBy) {
    case "year":
      return String(date.getFullYear());
    case "month":
      return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    case "week":
      return weekKey(basis);
    case "abc": {
      const first = (note.title || "#").trim().charAt(0).toUpperCase();
      return /[A-Z0-9]/.test(first) ? first : "#";
    }
    case "default":
      return defaultGroup(note);
    default:
      return "";
  }
}

function buildNoteGroups(notes){
  if (notesState.groupBy === "none") return [{ label: "", notes }];

  const groups = new Map();
  for (const note of notes) {
    const label = groupLabelForNote(note);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(note);
  }

  let entries = [...groups.entries()];

  if (notesState.groupBy === "default") {
    const order = ["PINNED", "RECENT", "LAST WEEK", "OLDER"];
    entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  } else if (notesState.groupBy === "abc") {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  } else {
    entries.sort((a, b) => b[0].localeCompare(a[0]));
  }

  return entries.map(([label, groupedNotes]) => ({ label, notes: groupedNotes }));
}

function renderSortChecks(){
  document.querySelectorAll("[data-order-by]").forEach((btn) => {
    btn.querySelector("span:last-child").textContent =
      btn.dataset.orderBy === notesState.orderBy ? "✓" : "";
  });

  document.querySelectorAll("[data-sort-direction]").forEach((btn) => {
    btn.querySelector("span:last-child").textContent =
      btn.dataset.sortDirection === notesState.sortDirection ? "✓" : "";
  });

  document.querySelectorAll("[data-group-by]").forEach((btn) => {
    btn.querySelector("span:last-child").textContent =
      btn.dataset.groupBy === notesState.groupBy ? "✓" : "";
  });

  const orderLabels = {
    created_at: "Date created",
    updated_at: "Date edited",
    title: "Title",
  };
  const directionLabels = {
    asc: notesState.orderBy === "title" ? "A - Z" : "Oldest - newest",
    desc: notesState.orderBy === "title" ? "Z - A" : "Newest - oldest",
  };
  const groupLabels = {
    none: "None",
    default: "Default",
    year: "Year",
    month: "Month",
    week: "Week",
    abc: "Abc",
  };

  $("orderByValue").textContent = orderLabels[notesState.orderBy];
  $("sortDirectionValue").textContent = directionLabels[notesState.sortDirection];
  $("groupByValue").textContent = groupLabels[notesState.groupBy];

  $("notesSortSummary").textContent =
    `${orderLabels[notesState.orderBy].replace("Date ", "")} · ${directionLabels[notesState.sortDirection]}`;

  $("compactViewBtn").classList.toggle("active", notesState.viewMode === "compact");
  $("detailViewBtn").classList.toggle("active", notesState.viewMode === "detail");
  $("noteList").classList.toggle("compact-view", notesState.viewMode === "compact");
  $("noteList").classList.toggle("detail-view", notesState.viewMode === "detail");
}

function closeSortPopover(){
  $("notesSortPopover")?.classList.add("hidden");
  document.querySelectorAll(".sort-subpanel").forEach((el) => el.classList.add("hidden"));
}

function toggleSortPanel(panelName){
  const target = $(`${panelName}Panel`);
  if (!target) return;
  const willOpen = target.classList.contains("hidden");
  document.querySelectorAll(".sort-subpanel").forEach((el) => el.classList.add("hidden"));
  if (willOpen) target.classList.remove("hidden");
}

function renderNotes(){
  const list = $("noteList");
  list.innerHTML = "";

  const filtered = notesState.notes
    .filter(noteMatchesSearch)
    .slice()
    .sort(notesCompare);

  $("emptyNotes").classList.toggle("hidden", filtered.length > 0);

  renderSortChecks();

  const groups = buildNoteGroups(filtered);

  for (const group of groups) {
    if (group.label) {
      const heading = document.createElement("div");
      heading.className = "note-group-heading";
      heading.textContent = group.label;
      list.appendChild(heading);
    }

    for (const note of group.notes) {
      const row = document.createElement("div");
      row.className = `note-row ${notesState.selectedNoteId === note.id ? "active" : ""}`;
      row.dataset.noteId = note.id;
      if (note.color) row.style.setProperty("--note-accent", note.color);

      const btn = document.createElement("button");
      btn.className = `note-card ${notesState.selectedNoteId === note.id ? "active" : ""}`;
      btn.dataset.noteId = note.id;

      const dots = document.createElement("button");
      dots.type = "button";
      dots.className = "note-menu-button";
      dots.title = "Note menu";
      dots.setAttribute("aria-label", "Note menu");
      dots.textContent = "⋮";

      const relative = relativeEditedTime(note.updated_at);
      const notebookName = getNotebookName(note.notebook_id);

      if (notesState.viewMode === "compact") {
        btn.innerHTML = `
          <div class="note-compact-row">
            <div class="note-compact-main">
              <strong></strong>
              <div class="note-mini-icons">
                ${note.is_pinned ? '<span title="Pinned">📌</span>' : ""}
                ${note.is_favorite ? '<span title="Favorite">★</span>' : ""}
                ${note.is_locked ? '<span title="Locked">🔒</span>' : ""}
              </div>
            </div>
            <span class="note-relative-time">${relative}</span>
          </div>
        `;
      } else {
        btn.innerHTML = `
          <div class="note-card-head">
            <strong></strong>
            <div class="note-mini-icons">
              ${note.is_pinned ? '<span title="Pinned">📌</span>' : ""}
              ${note.is_favorite ? '<span title="Favorite">★</span>' : ""}
              ${note.is_locked ? '<span title="Locked">🔒</span>' : ""}
            </div>
          </div>
          <p></p>
          <div class="note-detail-meta">
            <span class="note-notebook-label">▤ ${notebookName}</span>
            <span>${relative}</span>
          </div>
        `;
        btn.querySelector("p").textContent = note.preview || "No content yet.";
      }

      btn.querySelector("strong").textContent = note.title || "Untitled Note";

      btn.addEventListener("click", () => selectNote(note.id));
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showNoteContextMenuAt(event.clientX, event.clientY, note);
      });

      dots.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showNoteDotsMenu(dots, note);
      });

      row.appendChild(btn);
      row.appendChild(dots);
      list.appendChild(row);
    }
  }

  $("allNotesCount").textContent = notesState.totalNotesCount;
}

async function createNote(){
  const user = await getCurrentUser();
  let notebookId = notesState.selectedNotebookId === "all" ? notesState.notebooks[0]?.id : notesState.selectedNotebookId;
  if (!notebookId) { await ensureDefaultNotebook(); notebookId = notesState.notebooks[0].id; }
  const { data, error } = await client.from("notes").insert({
    user_id: user.id,
    notebook_id: notebookId,
    title: "Untitled Note",
    content: emptyDoc,
    preview: "",
  }).select().single();
  if (error) return showNotesError(error.message);
  if (notesState.selectedNotebookId !== "all" && notesState.selectedNotebookId !== notebookId) notesState.selectedNotebookId = notebookId;
  await loadNoteCounts();
  await loadNotes();
  renderNotebooks();
  await selectNote(data.id);
}

function updateEditorPlaceholder(){
  const placeholder = $("editorPlaceholder");
  const editor = notesState.editor;
  if (!placeholder || !editor) return;

  placeholder.classList.toggle("hidden", !editor.isEmpty);
}

async function initTiptap(){
  if (notesState.editorReady) return notesState.editor;
  if (notesState.editorLoadingPromise) return notesState.editorLoadingPromise;

  notesState.editorLoadingPromise = (async () => {
    $("saveStatus").textContent = "Loading editor...";

    try {
    const [
      core,
      starter,
      underlineModule,
      linkModule,
      colorModule,
      textStyleModule,
      highlightModule,
      textAlignModule,
    ] = await Promise.all([
      import("https://esm.sh/@tiptap/core@3.29.2"),
      import("https://esm.sh/@tiptap/starter-kit@3.29.2"),
      import("https://esm.sh/@tiptap/extension-underline@3.29.2"),
      import("https://esm.sh/@tiptap/extension-link@3.29.2"),
      import("https://esm.sh/@tiptap/extension-color@3.29.2"),
      import("https://esm.sh/@tiptap/extension-text-style@3.29.2"),
      import("https://esm.sh/@tiptap/extension-highlight@3.29.2"),
      import("https://esm.sh/@tiptap/extension-text-align@3.29.2"),
    ]);

    const Editor = core.Editor;
    const Extension = core.Extension;
    const StarterKit = starter.default || starter.StarterKit;
    const Underline = underlineModule.default || underlineModule.Underline;
    const Link = linkModule.default || linkModule.Link;
    const Color = colorModule.default || colorModule.Color;
    const TextStyle = textStyleModule.default || textStyleModule.TextStyle;
    const Highlight = highlightModule.default || highlightModule.Highlight;
    const TextAlign = textAlignModule.default || textAlignModule.TextAlign;

    const FontFamily = Extension.create({
      name: "fontFamily",
      addGlobalAttributes() {
        return [{
          types: ["textStyle"],
          attributes: {
            fontFamily: {
              default: null,
              parseHTML: (element) => element.style.fontFamily || null,
              renderHTML: (attributes) => {
                if (!attributes.fontFamily) return {};
                return { style: `font-family: ${attributes.fontFamily}` };
              },
            },
          },
        }];
      },
      addCommands() {
        return {
          setFontFamily: (fontFamily) => ({ chain }) =>
            chain().setMark("textStyle", { fontFamily }).run(),
          unsetFontFamily: () => ({ chain }) =>
            chain().setMark("textStyle", { fontFamily: null }).removeEmptyTextStyle().run(),
        };
      },
    });

    const FontSize = Extension.create({
      name: "fontSize",
      addGlobalAttributes() {
        return [{
          types: ["textStyle"],
          attributes: {
            fontSize: {
              default: null,
              parseHTML: (element) => element.style.fontSize || null,
              renderHTML: (attributes) => {
                if (!attributes.fontSize) return {};
                return { style: `font-size: ${attributes.fontSize}` };
              },
            },
          },
        }];
      },
      addCommands() {
        return {
          setFontSize: (fontSize) => ({ chain }) =>
            chain().setMark("textStyle", { fontSize }).run(),
          unsetFontSize: () => ({ chain }) =>
            chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
        };
      },
    });

    notesState.editor = new Editor({
      element: $("editor"),
      extensions: [
        StarterKit,
        TextStyle,
        Color,
        Underline,
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            rel: "noopener noreferrer",
            target: "_blank",
          },
        }),
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({
          types: ["heading", "paragraph"],
          alignments: ["left", "center", "right", "justify"],
        }),
        FontFamily,
        FontSize,
      ],
      content: emptyDoc,
      editorProps: {
        attributes: {
          class: "tiptap-editor",
          spellcheck: "true",
        },
      },
      onUpdate: () => {
        updateWordCount();
        updateEditorPlaceholder();
        scheduleSave();
      },
      onSelectionUpdate: updateToolbarState,
      onTransaction: () => {
        updateToolbarState();
        updateEditorPlaceholder();
      },
    });

    notesState.editorReady = true;
    bindToolbar();
    bindAdvancedToolbarControls();
    updateEditorPlaceholder();
    $("saveStatus").textContent = "Saved";
    } catch (error) {
      console.error(error);
      showNotesError("The rich-text editor could not load. Check your internet connection and refresh.");
      throw error;
    } finally {
      notesState.editorLoadingPromise = null;
    }

    return notesState.editor;
  })();

  return notesState.editorLoadingPromise;
}

function bindToolbar(){
  $("editorToolbar").querySelectorAll("button[data-command]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const e = notesState.editor;
      if (!e) return;

      const chain = e.chain().focus();
      const cmd = btn.dataset.command;

      if (cmd === "undo") chain.undo().run();
      else if (cmd === "redo") chain.redo().run();
      else if (cmd === "bold") chain.toggleBold().run();
      else if (cmd === "italic") chain.toggleItalic().run();
      else if (cmd === "underline") chain.toggleUnderline().run();
      else if (cmd === "bulletList") chain.toggleBulletList().run();
      else if (cmd === "orderedList") chain.toggleOrderedList().run();
      else if (cmd === "blockquote") chain.toggleBlockquote().run();
      else if (cmd === "alignLeft") chain.setTextAlign("left").run();
      else if (cmd === "alignCenter") chain.setTextAlign("center").run();
      else if (cmd === "alignRight") chain.setTextAlign("right").run();
      else if (cmd === "alignJustify") chain.setTextAlign("justify").run();
      else if (cmd === "clearFormatting") {
        chain.unsetAllMarks().clearNodes().setTextAlign("left").run();
      }
      else if (cmd === "link") {
        const previousUrl = e.getAttributes("link").href || "";
        const url = await centeredModal({
          title: e.isActive("link") ? "Edit Link" : "Insert Link",
          message: "Enter the web address. Leave blank to remove the current link.",
          inputValue: previousUrl,
          inputPlaceholder: "https://example.com",
          confirmText: previousUrl ? "Update" : "Add Link",
        });

        if (url === null) return;

        if (!url) {
          e.chain().focus().extendMarkRange("link").unsetLink().run();
        } else {
          let safeUrl = url.trim();
          if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(safeUrl)) {
            safeUrl = `https://${safeUrl}`;
          }
          e.chain().focus().extendMarkRange("link").setLink({ href: safeUrl }).run();
        }
      }

      updateToolbarState();
    });
  });
}


function bindAdvancedToolbarControls(){
  const editor = notesState.editor;
  if (!editor) return;

  $("fontFamilySelect")?.addEventListener("change", (event) => {
    const value = event.target.value;
    const chain = editor.chain().focus();
    if (value) chain.setFontFamily(value).run();
    else chain.unsetFontFamily().run();
    updateToolbarState();
  });

  $("fontSizeSelect")?.addEventListener("change", (event) => {
    const value = event.target.value;
    const chain = editor.chain().focus();
    if (value) chain.setFontSize(value).run();
    else chain.unsetFontSize().run();
    updateToolbarState();
  });

  $("textColorPicker")?.addEventListener("input", (event) => {
    editor.chain().focus().setColor(event.target.value).run();
    updateToolbarState();
  });

  $("highlightColorPicker")?.addEventListener("input", (event) => {
    editor.chain().focus().setHighlight({ color: event.target.value }).run();
    updateToolbarState();
  });
}

function updateToolbarState(){
  const e = notesState.editor;
  if (!e) return;

  $("editorToolbar").querySelectorAll("button[data-command]").forEach((btn) => {
    const cmd = btn.dataset.command;
    let active = false;

    if (cmd === "bold") active = e.isActive("bold");
    else if (cmd === "italic") active = e.isActive("italic");
    else if (cmd === "underline") active = e.isActive("underline");
    else if (cmd === "bulletList") active = e.isActive("bulletList");
    else if (cmd === "orderedList") active = e.isActive("orderedList");
    else if (cmd === "blockquote") active = e.isActive("blockquote");
    else if (cmd === "link") active = e.isActive("link");
    else if (cmd === "alignLeft") active = e.isActive({ textAlign: "left" });
    else if (cmd === "alignCenter") active = e.isActive({ textAlign: "center" });
    else if (cmd === "alignRight") active = e.isActive({ textAlign: "right" });
    else if (cmd === "alignJustify") active = e.isActive({ textAlign: "justify" });

    btn.classList.toggle("active", active);
  });

  const attrs = e.getAttributes("textStyle") || {};
  if ($("fontFamilySelect")) {
    $("fontFamilySelect").value = attrs.fontFamily || "";
  }
  if ($("fontSizeSelect")) {
    $("fontSizeSelect").value = attrs.fontSize || "";
  }

  const color = attrs.color;
  if (color && /^#[0-9a-fA-F]{6}$/.test(color) && $("textColorPicker")) {
    $("textColorPicker").value = color;
  }

  const highlight = e.getAttributes("highlight")?.color;
  if (highlight && /^#[0-9a-fA-F]{6}$/.test(highlight) && $("highlightColorPicker")) {
    $("highlightColorPicker").value = highlight;
  }
}

async function selectNote(id){
  notesState.selectedNoteId = id;
  renderNotes();
  const note = notesState.notes.find(n => n.id === id);
  if (!note) return;
  await initTiptap();
  $("editorEmpty").classList.add("hidden");
  $("editorWrap").classList.remove("hidden");
  $("noteTitle").value = note.title || "Untitled Note";
  renderEditorNotebookSelector(note);
  notesState.editor.commands.setContent(note.content || emptyDoc);
  updateWordCount();
  updateEditorPlaceholder();
  $("lastUpdated").textContent = `Last updated ${new Date(note.updated_at).toLocaleString()}`;
  $("saveStatus").textContent = "Saved";
}

function clearEditorSelection(){
  notesState.selectedNoteId = null;
  $("editorWrap").classList.add("hidden");
  $("editorEmpty").classList.remove("hidden");
}

function scheduleSave(){
  if (!notesState.selectedNoteId || !notesState.editor) return;
  clearTimeout(notesState.saveTimer);
  $("saveStatus").textContent = "Saving...";
  notesState.saveTimer = setTimeout(saveCurrentNote, 800);
}

async function saveCurrentNote(){
  if (!notesState.selectedNoteId || !notesState.editor) return;
  const noteId = notesState.selectedNoteId;
  const title = $("noteTitle").value.trim() || "Untitled Note";
  const content = notesState.editor.getJSON();
  const preview = notesState.editor.getText().replace(/\s+/g, " ").trim().slice(0, 180);
  const { data, error } = await client.from("notes").update({ title, content, preview }).eq("id", noteId).select("updated_at").single();
  if (error) {
    $("saveStatus").textContent = "Save failed";
    return showNotesError(error.message);
  }
  const local = notesState.notes.find(n => n.id === noteId);
  if (local) { local.title = title; local.content = content; local.preview = preview; local.updated_at = data.updated_at; }
  $("saveStatus").textContent = "Saved";
  $("lastUpdated").textContent = `Last updated ${new Date(data.updated_at).toLocaleString()}`;
  renderNotes();
}

async function deleteCurrentNote(){
  if (!notesState.selectedNoteId) return;

  const note = notesState.notes.find((n) => n.id === notesState.selectedNoteId);
  const title = note?.title || "this note";

  const confirmed = confirm(
    `Permanently delete "${title}"?

This cannot be undone.`
  );

  if (!confirmed) return;

  const deletedNoteId = notesState.selectedNoteId;

  const { error } = await client
    .from("notes")
    .delete()
    .eq("id", deletedNoteId);

  if (error) return showNotesError(error.message);

  notesState.selectedNoteId = null;
  await loadNoteCounts();
  await loadNotes();
  renderNotebooks();
  clearEditorSelection();
}

function updateWordCount(){
  const text = notesState.editor?.getText().trim() || "";
  const words = text ? text.split(/\s+/).length : 0;
  $("wordCount").textContent = `${words} word${words === 1 ? "" : "s"}`;
}

async function openNotes(){
  showPortalView("notes");
  showNotesError("");

  try {
    // Render database-backed panes as soon as possible.
    await Promise.all([
      loadNotebooks(),
      loadNoteCounts(),
      loadNotes(),
    ]);

    renderNotebooks();
    renderNotes();

    // Warm the editor after the Notes UI is already usable.
    // This prevents the first Note click from waiting on all Tiptap modules.
    const warmEditor = () => {
      if (!notesState.editorReady) {
        initTiptap().catch((error) => console.error("EDITOR_PRELOAD_ERROR", error));
      }
    };

    if ("requestIdleCallback" in window) {
      requestIdleCallback(warmEditor, { timeout: 1200 });
    } else {
      setTimeout(warmEditor, 50);
    }
  } catch (error) {
    console.error(error);
    showNotesError(error.message || "Notes could not be loaded. Make sure the Notes database setup has been completed.");
  }
}

$("navDashboard")?.addEventListener("click", () => showPortalView("dashboard"));
$("backDashboard")?.addEventListener("click", () => showPortalView("dashboard"));
$("navNotes")?.addEventListener("click", openNotes);
$("openNotesCard")?.addEventListener("click", (e) => { e.preventDefault(); openNotes(); });
document.querySelector('[data-notebook="all"]')?.addEventListener("click", async () => {
  notesState.selectedNotebookId = "all";
  notesState.selectedNoteId = null;
  await loadNotes();
  renderNotebooks();
  clearEditorSelection();
});

ensureUiLayers();

$("noteContextMenu")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-note-action]");
  if (!button) return;

  const noteId = $("noteContextMenu").dataset.noteId;
  const note = notesState.notes.find((item) => item.id === noteId);
  if (!note) return hideNoteContextMenu();

  await handleNoteAction(button.dataset.noteAction, note);
});

ensureUiLayers();
$("notebookContextMenu")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const notebookId = $("notebookContextMenu").dataset.notebookId;
  const nb = notesState.notebooks.find((item) => item.id === notebookId);
  if (!nb) return hideNotebookContextMenu();

  await handleNotebookContextAction(button.dataset.action, nb);
});

$("newNotebookBtn")?.addEventListener("click", createNotebook);
$("newNotebookBottom")?.addEventListener("click", createNotebook);
$("newNoteBtn")?.addEventListener("click", createNote);
$("deleteNoteBtn")?.setAttribute("title", "Permanently delete note");
$("deleteNoteBtn")?.addEventListener("click", deleteCurrentNote);
$("noteSearch")?.addEventListener("input", (e) => { notesState.search = e.target.value; renderNotes(); });

$("notesSortMenuBtn")?.addEventListener("click", (event) => {
  event.stopPropagation();
  const popover = $("notesSortPopover");
  const willOpen = popover.classList.contains("hidden");
  closeSortPopover();
  if (willOpen) {
    renderSortChecks();
    popover.classList.remove("hidden");
  }
});

document.querySelectorAll("[data-sort-panel]").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSortPanel(btn.dataset.sortPanel);
  });
});

document.querySelectorAll("[data-order-by]").forEach((btn) => {
  btn.addEventListener("click", () => {
    notesState.orderBy = btn.dataset.orderBy;
    localStorage.setItem("portalNotesOrderBy", notesState.orderBy);
    renderNotes();
    renderSortChecks();
  });
});

document.querySelectorAll("[data-sort-direction]").forEach((btn) => {
  btn.addEventListener("click", () => {
    notesState.sortDirection = btn.dataset.sortDirection;
    localStorage.setItem("portalNotesSortDirection", notesState.sortDirection);
    renderNotes();
    renderSortChecks();
  });
});

document.querySelectorAll("[data-group-by]").forEach((btn) => {
  btn.addEventListener("click", () => {
    notesState.groupBy = btn.dataset.groupBy;
    localStorage.setItem("portalNotesGroupBy", notesState.groupBy);
    renderNotes();
    renderSortChecks();
  });
});

$("compactViewBtn")?.addEventListener("click", () => {
  notesState.viewMode = "compact";
  localStorage.setItem("portalNotesViewMode", "compact");
  renderNotes();
});

$("detailViewBtn")?.addEventListener("click", () => {
  notesState.viewMode = "detail";
  localStorage.setItem("portalNotesViewMode", "detail");
  renderNotes();
});

document.addEventListener("click", (event) => {
  const popover = $("notesSortPopover");
  if (
    popover &&
    !popover.classList.contains("hidden") &&
    !popover.contains(event.target) &&
    !$("notesSortMenuBtn")?.contains(event.target)
  ) {
    closeSortPopover();
  }
});

$("noteTitle")?.addEventListener("input", scheduleSave);

(async function init(){
  if (await loadRecoverySession()) return;
  const { data: { session } } = await client.auth.getSession();
  showOnly(session ? "app" : "login");
  if (session) showPortalView("dashboard");
})();
