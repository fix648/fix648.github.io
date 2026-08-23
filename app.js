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
    menu.innerHTML = `
      <button data-action="rename">Rename</button>
      <button data-action="delete" class="danger">Delete</button>
    `;
    document.body.appendChild(menu);
  }
}

function hideNotebookContextMenu(){
  $("notebookContextMenu")?.classList.add("hidden");
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
  const menu = $("notebookContextMenu");
  if (menu && !menu.contains(event.target)) hideNotebookContextMenu();
});

window.addEventListener("resize", hideNotebookContextMenu);
window.addEventListener("scroll", hideNotebookContextMenu, true);

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
    .select("id,notebook_id,title,content,preview,is_pinned,updated_at,created_at")
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
    `;
    row.querySelector(".notebook-name").textContent = nb.name;
    const nbCount = notesState.notebookCounts[nb.id] || 0;
    row.querySelector(".notebook-count").textContent = nbCount;

    const notebookButton = row.querySelector(".notebook-item");

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

function noteMatchesSearch(note){
  const q = notesState.search.toLowerCase().trim();
  if (!q) return true;
  return `${note.title || ""} ${note.preview || ""}`.toLowerCase().includes(q);
}

function renderNotes(){
  const list = $("noteList");
  list.innerHTML = "";
  const filtered = notesState.notes.filter(noteMatchesSearch);
  $("emptyNotes").classList.toggle("hidden", filtered.length > 0);
  for (const note of filtered) {
    const btn = document.createElement("button");
    btn.className = `note-card ${notesState.selectedNoteId === note.id ? "active" : ""}`;
    const date = new Date(note.updated_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    btn.innerHTML = `<div class="note-card-head"><strong></strong><span>${note.is_pinned ? "📌" : ""}</span></div><p></p><small>${date}</small>`;
    btn.querySelector("strong").textContent = note.title || "Untitled Note";
    btn.querySelector("p").textContent = note.preview || "No content yet.";
    btn.addEventListener("click", () => selectNote(note.id));
    list.appendChild(btn);
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

async function initTiptap(){
  if (notesState.editorReady) return;
  $("saveStatus").textContent = "Loading editor...";
  try {
    const core = await import("https://esm.sh/@tiptap/core@3.29.2");
    const starter = await import("https://esm.sh/@tiptap/starter-kit@3.29.2");
    const Editor = core.Editor;
    const StarterKit = starter.default || starter.StarterKit;

    notesState.editor = new Editor({
      element: $("editor"),
      extensions: [StarterKit],
      content: emptyDoc,
      editorProps: { attributes: { class: "tiptap-editor" } },
      onUpdate: () => {
        updateWordCount();
        scheduleSave();
      },
      onSelectionUpdate: updateToolbarState,
      onTransaction: updateToolbarState,
    });
    notesState.editorReady = true;
    bindToolbar();
    $("saveStatus").textContent = "Saved";
  } catch (error) {
    console.error(error);
    showNotesError("The rich-text editor could not load. Check your internet connection and refresh.");
  }
}

function bindToolbar(){
  $("editorToolbar").querySelectorAll("button[data-command]").forEach(btn => {
    btn.addEventListener("click", () => {
      const e = notesState.editor;
      if (!e) return;
      const chain = e.chain().focus();
      const cmd = btn.dataset.command;
      if (cmd === "undo") chain.undo().run();
      else if (cmd === "redo") chain.redo().run();
      else if (cmd === "paragraph") chain.setParagraph().run();
      else if (cmd === "heading2") chain.toggleHeading({ level: 2 }).run();
      else if (cmd === "bold") chain.toggleBold().run();
      else if (cmd === "italic") chain.toggleItalic().run();
      else if (cmd === "bulletList") chain.toggleBulletList().run();
      else if (cmd === "orderedList") chain.toggleOrderedList().run();
      else if (cmd === "blockquote") chain.toggleBlockquote().run();
      updateToolbarState();
    });
  });
}

function updateToolbarState(){
  const e = notesState.editor;
  if (!e) return;
  $("editorToolbar").querySelectorAll("button[data-command]").forEach(btn => {
    const cmd = btn.dataset.command;
    let active = false;
    if (cmd === "bold") active = e.isActive("bold");
    else if (cmd === "italic") active = e.isActive("italic");
    else if (cmd === "heading2") active = e.isActive("heading", { level: 2 });
    else if (cmd === "bulletList") active = e.isActive("bulletList");
    else if (cmd === "orderedList") active = e.isActive("orderedList");
    else if (cmd === "blockquote") active = e.isActive("blockquote");
    else if (cmd === "paragraph") active = e.isActive("paragraph");
    btn.classList.toggle("active", active);
  });
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
    await loadNotebooks();
    await loadNoteCounts();
    await loadNotes();
    renderNotebooks();
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
$("noteTitle")?.addEventListener("input", scheduleSave);

(async function init(){
  if (await loadRecoverySession()) return;
  const { data: { session } } = await client.auth.getSession();
  showOnly(session ? "app" : "login");
  if (session) showPortalView("dashboard");
})();
