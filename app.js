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
      <button class="notebook-menu" title="Notebook options">⋮</button>
    `;
    row.querySelector(".notebook-name").textContent = nb.name;
    const nbCount = notesState.selectedNotebookId === nb.id ? notesState.notes.length : "";
    row.querySelector(".notebook-count").textContent = nbCount;
    row.querySelector(".notebook-item").addEventListener("click", async () => {
      notesState.selectedNotebookId = nb.id;
      notesState.selectedNoteId = null;
      renderNotebooks();
      await loadNotes();
      clearEditorSelection();
    });
    row.querySelector(".notebook-menu").addEventListener("click", () => notebookMenu(nb));
    list.appendChild(row);
  }
  document.querySelector('[data-notebook="all"]').classList.toggle("active", notesState.selectedNotebookId === "all");
  $("allNotesCount").textContent = notesState.selectedNotebookId === "all" ? notesState.notes.length : "—";
}

async function notebookMenu(nb){
  const action = prompt(`Notebook: ${nb.name}\nType R to rename or D to delete.`);
  if (!action) return;
  if (action.toLowerCase() === "r") {
    const name = prompt("New notebook name:", nb.name)?.trim();
    if (!name || name === nb.name) return;
    const { error } = await client.from("notebooks").update({ name }).eq("id", nb.id);
    if (error) return showNotesError(error.message);
    await loadNotebooks();
  } else if (action.toLowerCase() === "d") {
    if (!confirm(`Delete "${nb.name}"? Notes will move to All Notes and will not be deleted.`)) return;
    const { error } = await client.from("notebooks").delete().eq("id", nb.id);
    if (error) return showNotesError(error.message);
    if (notesState.selectedNotebookId === nb.id) notesState.selectedNotebookId = "all";
    await loadNotebooks();
    await loadNotes();
    clearEditorSelection();
  }
}

async function createNotebook(){
  const name = prompt("Notebook name:")?.trim();
  if (!name) return;
  const user = await getCurrentUser();
  const { data, error } = await client.from("notebooks").insert({
    user_id: user.id,
    name,
    icon: "folder",
    sort_order: notesState.notebooks.length,
  }).select().single();
  if (error) return showNotesError(error.message);
  notesState.notebooks.push(data);
  notesState.selectedNotebookId = data.id;
  await loadNotes();
  renderNotebooks();
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
  $("allNotesCount").textContent = notesState.selectedNotebookId === "all" ? notesState.notes.length : "—";
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
  await loadNotes();
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
  if (!confirm("Move this note to Trash?")) return;
  const { error } = await client.from("notes").update({ is_deleted: true }).eq("id", notesState.selectedNoteId);
  if (error) return showNotesError(error.message);
  notesState.selectedNoteId = null;
  await loadNotes();
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
    await loadNotes();
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
  renderNotebooks();
  await loadNotes();
  clearEditorSelection();
});
$("newNotebookBtn")?.addEventListener("click", createNotebook);
$("newNotebookBottom")?.addEventListener("click", createNotebook);
$("newNoteBtn")?.addEventListener("click", createNote);
$("deleteNoteBtn")?.addEventListener("click", deleteCurrentNote);
$("noteSearch")?.addEventListener("input", (e) => { notesState.search = e.target.value; renderNotes(); });
$("noteTitle")?.addEventListener("input", scheduleSave);

(async function init(){
  if (await loadRecoverySession()) return;
  const { data: { session } } = await client.auth.getSession();
  showOnly(session ? "app" : "login");
  if (session) showPortalView("dashboard");
})();
