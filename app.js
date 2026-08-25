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
    menu.innerHTML = "";
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


const PORTAL_NOTEBOOK_COLORS = [
  { value: "", label: "No color" },
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Yellow" },
  { value: "#84cc16", label: "Lime" },
  { value: "#22c55e", label: "Green" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#06b6d4", label: "Cyan" },
  { value: "#0ea5e9", label: "Sky" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#a855f7", label: "Purple" },
  { value: "#d946ef", label: "Fuchsia" },
  { value: "#ec4899", label: "Pink" },
  { value: "#f43f5e", label: "Rose" },
  { value: "#64748b", label: "Slate" },
  { value: "#78716c", label: "Stone" },
];

function notebookColorFor(note){
  return notesState.notebooks.find((nb) => nb.id === note.notebook_id)?.color || "";
}
function parentNotebookFor(note){ return notesState.notebooks.find((nb)=>nb.id===note.notebook_id)||null; }
function isNotebookInheritedLocked(note){ return !!parentNotebookFor(note)?.is_locked; }
function isNoteEffectivelyLocked(note){ return !!note.is_locked || isNotebookInheritedLocked(note); }

function notebookActionItems(nb){
  return [
    { id:"rename", label:"Rename", icon:"✎", danger:false },
    { id:"color", label:"Assign Color", icon:"◉", danger:false },
    { id:nb.is_locked ? "unlock" : "lock", label:nb.is_locked ? "Unlock" : "Lock", icon:nb.is_locked ? "🔓" : "🔒", danger:false },
    { id:"delete", label:"Move to Trash", icon:"⌫", danger:true },
  ];
}

function notebookActionMenuHtml(nb){
  return notebookActionItems(nb).map((item)=>`
    <button data-action="${item.id}" class="${item.danger ? "danger" : ""}">
      <span class="notebook-menu-icon">${item.icon||""}</span>
      <span>${item.label}</span>
      ${item.id==="color" ? '<span class="menu-chevron">›</span>' : ""}
    </button>`).join("");
}

function showNotebookDotsMenu(button, nb){
  ensureUiLayers();

  const menu = $("notebookContextMenu");
  menu.dataset.notebookId = nb.id;
  menu.innerHTML = notebookActionMenuHtml(nb);
  menu.innerHTML = notebookActionMenuHtml(nb);

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
    title: "Move Notebook to Trash",
    message:
      noteCount > 0
        ? `"${nb.name}" contains ${noteCount} note(s). The notebook and all notes inside it will move to Trash together.`
        : `Move empty notebook "${nb.name}" to Trash?`,
    confirmText: "Move to Trash",
    destructive: true,
  });

  if (!confirmed) return;

  const trashedAt = new Date().toISOString();

  // Trash all notes inside the notebook first.
  const { error: notesError } = await client
    .from("notes")
    .update({
      is_deleted: true,
      trashed_at: trashedAt,
    })
    .eq("notebook_id", nb.id);

  if (notesError) {
    await centeredMessage(
      "Delete Cancelled",
      "The notes could not be moved to Trash, so the notebook was not deleted."
    );
    return;
  }

  // Then trash the notebook itself.
  const { error: notebookError } = await client
    .from("notebooks")
    .update({
      is_deleted: true,
      trashed_at: trashedAt,
    })
    .eq("id", nb.id);

  if (notebookError) {
    // Roll back note trash state if notebook trashing fails.
    await client
      .from("notes")
      .update({
        is_deleted: false,
        trashed_at: null,
      })
      .eq("notebook_id", nb.id)
      .eq("trashed_at", trashedAt);

    return showNotesError(notebookError.message);
  }

  if (notesState.selectedNotebookId === nb.id) {
    notesState.selectedNotebookId = "all";
  }

  notesState.selectedNoteId = null;

  await Promise.all([
    loadNotebooks(),
    loadNoteCounts(),
    loadNotes(),
  ]);

  renderNotebooks();
  renderNotes();
  clearEditorSelection();

  await centeredMessage(
    "Moved to Trash",
    noteCount > 0
      ? `"${nb.name}" and ${noteCount} note(s) were moved to Trash.`
      : `"${nb.name}" was moved to Trash.`
  );
}



async function passwordModal(title,message,confirmText){
  return centeredModal({title,message,inputValue:"",inputPlaceholder:"Password",confirmText});
}
async function rpcSecurity(name,args){
  const {data,error}=await client.rpc(name,args);
  if(error){ showNotesError(error.message); return {ok:false,data:null}; }
  return {ok:true,data};
}
async function lockNotebook(nb){
  const p=await passwordModal("Lock Notebook",`Set a password for "${nb.name}". Notes inside it will also be locked.`,"Lock");
  if(p===null)return;
  if(!p||p.length<4)return centeredMessage("Password Required","Use at least 4 characters.");
  const r=await rpcSecurity("portal_lock_notebook",{p_notebook_id:nb.id,p_password:p}); if(!r.ok)return;
  await loadNotebooks(); await loadNotes(); renderNotebooks(); renderNotes();
}
async function unlockNotebook(nb){
  const p=await passwordModal("Unlock Notebook",`Enter the password for "${nb.name}".`,"Unlock"); if(p===null)return;
  const r=await rpcSecurity("portal_unlock_notebook",{p_notebook_id:nb.id,p_password:p});
  if(!r.ok)return; if(!r.data)return centeredMessage("Incorrect Password","The notebook password is incorrect.");
  await loadNotebooks(); await loadNotes(); renderNotebooks(); renderNotes();
}
async function lockNote(note){
  const p=await passwordModal("Lock Note",`Set a password for "${note.title||"Untitled Note"}".`,"Lock"); if(p===null)return;
  if(!p||p.length<4)return centeredMessage("Password Required","Use at least 4 characters.");
  const r=await rpcSecurity("portal_lock_note",{p_note_id:note.id,p_password:p}); if(!r.ok)return;
  await refreshNotesAfterAction(note.id);
}
async function unlockNote(note){
  const p=await passwordModal("Unlock Note",`Enter the password for "${note.title||"Untitled Note"}".`,"Unlock"); if(p===null)return;
  const r=await rpcSecurity("portal_unlock_note",{p_note_id:note.id,p_password:p});
  if(!r.ok)return; if(!r.data)return centeredMessage("Incorrect Password","The note password is incorrect.");
  await refreshNotesAfterAction(note.id);
}
function centeredAutoDeleteModal(){
  return new Promise((resolve)=>{
    const o=document.createElement("div"); o.className="portal-modal-overlay";
    o.innerHTML=`<div class="portal-modal auto-delete-modal"><h3>Auto Delete</h3>
      <p class="portal-modal-message">Choose when this note should be deleted.</p>
      <label class="auto-delete-label">Date & time<input class="auto-delete-datetime" type="datetime-local"></label>
      <label class="auto-delete-label">Action<select class="auto-delete-mode">
        <option value="trash">Move to Trash</option><option value="permanent">Delete Permanently</option>
      </select></label>
      <div class="portal-modal-actions"><button class="portal-modal-btn secondary" data-cancel>Cancel</button>
      <button class="portal-modal-btn" data-save>Schedule</button></div></div>`;
    const done=v=>{o.remove();resolve(v)};
    o.querySelector("[data-cancel]").onclick=()=>done(null);
    o.querySelector("[data-save]").onclick=()=>{
      const d=o.querySelector(".auto-delete-datetime").value,m=o.querySelector(".auto-delete-mode").value;
      if(d)done({datetime:d,mode:m});
    };
    o.addEventListener("click",e=>{if(e.target===o)done(null)}); document.body.appendChild(o);
  });
}
async function scheduleAutoDelete(note){
  const v=await centeredAutoDeleteModal(); if(!v)return;
  const when=new Date(v.datetime);
  if(Number.isNaN(when.getTime())||when<=new Date())return centeredMessage("Invalid Time","Choose a future date and time.");
  const u=await updateNoteActionFields(note.id,{auto_delete_at:when.toISOString(),auto_delete_mode:v.mode});
  if(u){await refreshNotesAfterAction(note.id); await centeredMessage("Auto Delete Scheduled","Schedule saved.");}
}

async function assignNotebookColor(nb){
  const color = await centeredChoiceModal({
    title: "Assign Notebook Color",
    message: "This color will also be used for titles of notes inside this notebook.",
    choices: PORTAL_NOTEBOOK_COLORS,
    variant: "palette",
  });
  if (color === null) return;

  const { error } = await client
    .from("notebooks")
    .update({ color: color || null })
    .eq("id", nb.id);

  if (error) return showNotesError(error.message);

  await loadNotebooks();
  await loadNotes();
  renderNotebooks();
  renderNotes();
}

async function handleNotebookContextAction(action, nb){
  hideNotebookContextMenu();
  if (action === "rename") return renameNotebook(nb);
  if (action === "color") return assignNotebookColor(nb);
  if (action === "lock") return lockNotebook(nb);
  if (action === "unlock") return unlockNotebook(nb);
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
    .select("id,name,icon,sort_order,color,is_favorite,is_locked,is_deleted,trashed_at,created_at,updated_at")
    .eq("user_id", user.id)
    .eq("is_deleted", false)
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
    .select("id,notebook_id,title,content,preview,is_pinned,is_favorite,is_locked,color,auto_delete_at,auto_delete_mode,updated_at,created_at")
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
    if(nb.is_locked){
      const lock=document.createElement("span"); lock.className="notebook-lock-indicator"; lock.textContent="🔒";
      row.querySelector(".notebook-name").after(lock);
    }
    if (nb.color) {
      row.querySelector(".notebook-icon").style.color = nb.color;
      row.querySelector(".notebook-name").style.color = nb.color;
    }
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
  removeNoteSubmenu();
}

function noteActionMenuItems(note){
  const inherited=isNotebookInheritedLocked(note);
  const items=[
    {id:"pin",icon:note.is_pinned?"📌":"📍",label:note.is_pinned?"Unpin":"Pin",group:1},
    {id:"favorite",icon:note.is_favorite?"★":"☆",label:note.is_favorite?"Remove Favorite":"Favorite",group:1},
  ];
  if(!inherited) items.push({id:note.is_locked?"unlock":"lock",icon:note.is_locked?"🔓":"🔒",label:note.is_locked?"Unlock":"Lock",group:1});
  items.push(
    {id:"move",icon:"▤",label:"Move to Notebook",group:2,submenu:true},
    {id:"color",icon:"◉",label:"Assign Color",group:2,submenu:true},
    {id:"duplicate",icon:"⧉",label:"Duplicate",group:2},
    {id:"autoDelete",icon:"◷",label:"Auto Delete",group:3},
    {id:"trash",icon:"⌫",label:"Move to Trash",group:4,danger:true}
  );
  return items;
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
        ${item.submenu ? '<span class="menu-chevron">›</span>' : ""}
      </button>`;
  }).join("");
}

function positionFloatingMenu(menu, x, y, width = 205, height = 250){
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}


function removeNoteSubmenu(){
  document.querySelectorAll(".note-action-submenu").forEach((el) => el.remove());
}

function showNoteActionSubmenu(parentButton, note, type){
  removeNoteSubmenu();

  const submenu = document.createElement("div");
  submenu.className = `note-action-submenu ${type === "color" ? "color-submenu" : ""}`;

  if (type === "move") {
    for (const nb of notesState.notebooks) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "submenu-row";
      const current = nb.id === note.notebook_id;
      button.innerHTML = `
        <span class="submenu-icon" style="${nb.color ? `color:${nb.color}` : ""}">▤</span>
        <span class="submenu-label"></span>
        <span class="submenu-check">${current ? "✓" : ""}</span>
      `;
      button.querySelector(".submenu-label").textContent = nb.name;
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (!current) {
          const updated = await updateNoteActionFields(note.id, { notebook_id: nb.id });
          if (updated) {
            removeNoteSubmenu();
            hideNoteContextMenu();
            await refreshNotesAfterAction(
              notesState.selectedNotebookId === "all" || notesState.selectedNotebookId === nb.id
                ? note.id : null
            );
          }
        } else {
          removeNoteSubmenu();
          hideNoteContextMenu();
        }
      });
      submenu.appendChild(button);
    }
  } else {
    for (const choice of PORTAL_NOTEBOOK_COLORS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "submenu-color-row";
      button.innerHTML = `
        <span class="submenu-color-dot ${choice.value ? "" : "none"}"
              style="${choice.value ? `--submenu-color:${choice.value}` : ""}"></span>
        <span>${choice.label}</span>
        <span class="submenu-check">${(note.color || "") === choice.value ? "✓" : ""}</span>
      `;
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        const updated = await updateNoteActionFields(note.id, { color: choice.value || null });
        if (updated) {
          removeNoteSubmenu();
          hideNoteContextMenu();
          await refreshNotesAfterAction(note.id);
        }
      });
      submenu.appendChild(button);
    }
  }

  document.body.appendChild(submenu);
  const rect = parentButton.getBoundingClientRect();
  const width = type === "color" ? 190 : 220;
  const height = Math.min(submenu.scrollHeight || 360, window.innerHeight - 16);
  let left = rect.right + 4;
  if (left + width > window.innerWidth - 8) left = rect.left - width - 4;
  let top = Math.min(rect.top, window.innerHeight - height - 8);
  submenu.style.left = `${Math.max(8, left)}px`;
  submenu.style.top = `${Math.max(8, top)}px`;
  submenu.style.width = `${width}px`;
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
    .select("id,notebook_id,title,content,preview,is_pinned,is_favorite,is_locked,color,auto_delete_at,auto_delete_mode,updated_at,created_at")
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
    { value: "#84cc16", label: "Lime" },
    { value: "#14b8a6", label: "Teal" },
    { value: "#0ea5e9", label: "Sky" },
    { value: "#6366f1", label: "Indigo" },
    { value: "#a855f7", label: "Purple" },
    { value: "#d946ef", label: "Fuchsia" },
    { value: "#f43f5e", label: "Rose" },
    { value: "#78716c", label: "Stone" },
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
  if (action === "lock") return lockNote(note);
  if (action === "unlock") return unlockNote(note);
  if (action === "move") return moveNoteFromAction(note);
  if (action === "color") return assignNoteColor(note);
  if (action === "duplicate") return duplicateNote(note);
  if (action === "autoDelete") return scheduleAutoDelete(note);
  if (action === "trash") return moveNoteToTrash(note);
}


async function openTrashView(){
  hideNoteContextMenu();
  hideNotebookContextMenu();

  const [
    { data: deletedNotes, error: notesError },
    { data: deletedNotebooks, error: notebooksError }
  ] = await Promise.all([
    client.from("notes")
      .select("id,notebook_id,title,preview,trashed_at,updated_at")
      .eq("is_deleted", true)
      .order("trashed_at", { ascending: false }),
    client.from("notebooks")
      .select("id,name,trashed_at,color")
      .eq("is_deleted", true)
      .order("trashed_at", { ascending: false })
  ]);

  if (notesError || notebooksError) {
    showNotesError((notesError || notebooksError).message);
    return;
  }

  const notes = deletedNotes || [];
  const notebooks = deletedNotebooks || [];
  const isEmpty = notes.length === 0 && notebooks.length === 0;

  const overlay = document.createElement("div");
  overlay.className = "portal-modal-overlay trash-overlay";
  overlay.innerHTML = `
    <div class="portal-modal trash-modal ${isEmpty ? "trash-modal-empty" : "trash-modal-filled"}" role="dialog" aria-modal="true">
      <div class="trash-head">
        <div>
          <div class="trash-kicker">PERSONAL NOTES</div>
          <h3>Trash</h3>
          <p class="trash-help">Restore an item or permanently delete it.</p>
        </div>
        <button class="trash-close" type="button" aria-label="Close">×</button>
      </div>

      ${isEmpty ? `
        <div class="trash-empty-state">
          <div class="trash-empty-illustration" aria-hidden="true">
            <div class="trash-empty-bin">🗑</div>
          </div>
          <strong>Trash is empty</strong>
          <span>Deleted notes and notebooks will appear here.</span>
        </div>
      ` : `
        <div class="trash-sections">
          <section class="trash-section">
            <div class="trash-section-title">
              <div class="trash-section-title-left">
                <span class="trash-section-icon">📝</span>
                <h4>Notes</h4>
                <span class="trash-count">${notes.length}</span>
              </div>
            </div>
            <div class="trash-list" data-trash-notes></div>
          </section>

          <section class="trash-section">
            <div class="trash-section-title">
              <div class="trash-section-title-left">
                <span class="trash-section-icon">📓</span>
                <h4>Notebooks</h4>
                <span class="trash-count">${notebooks.length}</span>
              </div>
            </div>
            <div class="trash-list" data-trash-notebooks></div>
          </section>
        </div>
      `}
    </div>`;

  const close = () => overlay.remove();
  overlay.querySelector(".trash-close").onclick = close;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  if (!isEmpty) {
    const notesList = overlay.querySelector("[data-trash-notes]");
    const notebooksList = overlay.querySelector("[data-trash-notebooks]");

    const relativeDeletedTime = (value) => {
      if (!value) return "Deleted recently";
      const diff = Math.max(0, Date.now() - new Date(value).getTime());
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);

      if (mins < 1) return "Deleted just now";
      if (mins < 60) return `Deleted ${mins} min ago`;
      if (hours < 24) return `Deleted ${hours} hour${hours === 1 ? "" : "s"} ago`;
      if (days === 1) return "Deleted yesterday";
      return `Deleted ${days} days ago`;
    };

    const renderCompactEmpty = (container, label) => {
      container.innerHTML = `
        <div class="trash-column-empty">
          <span>${label}</span>
        </div>`;
    };

    if (!notes.length) {
      renderCompactEmpty(notesList, "No deleted notes.");
    }

    for (const note of notes) {
      const row = document.createElement("div");
      row.className = "trash-row";
      row.innerHTML = `
        <div class="trash-item-main">
          <div class="trash-item-icon note-icon">📝</div>
          <div class="trash-item-copy">
            <strong></strong>
            <small></small>
          </div>
        </div>

        <div class="trash-actions">
          <button class="restore-action" data-restore title="Restore">
            <span class="trash-action-icon">↶</span>
            <span>Restore</span>
          </button>
          <div class="trash-action-divider"></div>
          <button class="delete-action" data-delete title="Delete permanently">
            <span class="trash-action-icon"><svg class="trash-action-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16"></path>
              <path d="M9 7V4h6v3"></path>
              <path d="M6.5 7l.8 13h9.4l.8-13"></path>
              <path d="M10 11v5"></path>
              <path d="M14 11v5"></path>
            </svg></span>
            <span>Delete</span>
          </button>
        </div>`;

      row.querySelector("strong").textContent = note.title || "Untitled Note";
      const deletedParentNotebook = notebooks.find((nb) => nb.id === note.notebook_id);
      row.querySelector("small").textContent = deletedParentNotebook
        ? `${relativeDeletedTime(note.trashed_at)} · ${deletedParentNotebook.name}`
        : relativeDeletedTime(note.trashed_at);

      row.querySelector("[data-restore]").onclick = async () => {
        const { error } = await client
          .from("notes")
          .update({ is_deleted: false, trashed_at: null })
          .eq("id", note.id);

        if (error) return showNotesError(error.message);

        row.remove();
        await refreshNotesAfterAction();

        const remainingNotes = notesList.querySelectorAll(".trash-row").length;
        if (!remainingNotes) {
          renderCompactEmpty(notesList, "No deleted notes.");
        }

        await centeredMessage("Note Restored", "The note was restored.");
      };

      row.querySelector("[data-delete]").onclick = async () => {
        const ok = await centeredModal({
          title: "Permanently Delete Note",
          message: `Permanently delete "${note.title || "Untitled Note"}"? This cannot be undone.`,
          confirmText: "Delete Forever",
          destructive: true
        });

        if (!ok) return;

        const { error } = await client
          .from("notes")
          .delete()
          .eq("id", note.id);

        if (error) return showNotesError(error.message);

        row.remove();

        const remainingNotes = notesList.querySelectorAll(".trash-row").length;
        if (!remainingNotes) {
          renderCompactEmpty(notesList, "No deleted notes.");
        }
      };

      notesList.appendChild(row);
    }

    if (!notebooks.length) {
      renderCompactEmpty(notebooksList, "No deleted notebooks.");
    }

    for (const notebook of notebooks) {
      const row = document.createElement("div");
      row.className = "trash-row";
      row.innerHTML = `
        <div class="trash-item-main">
          <div class="trash-item-icon notebook-icon">📓</div>
          <div class="trash-item-copy">
            <strong></strong>
            <small></small>
          </div>
        </div>

        <div class="trash-actions">
          <button class="restore-action" data-restore title="Restore">
            <span class="trash-action-icon">↶</span>
            <span>Restore</span>
          </button>
          <div class="trash-action-divider"></div>
          <button class="delete-action" data-delete title="Delete permanently">
            <span class="trash-action-icon"><svg class="trash-action-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16"></path>
              <path d="M9 7V4h6v3"></path>
              <path d="M6.5 7l.8 13h9.4l.8-13"></path>
              <path d="M10 11v5"></path>
              <path d="M14 11v5"></path>
            </svg></span>
            <span>Delete</span>
          </button>
        </div>`;

      row.querySelector("strong").textContent = notebook.name;
      row.querySelector("small").textContent = relativeDeletedTime(notebook.trashed_at);

      if (notebook.color) {
        row.querySelector(".trash-item-icon").style.color = notebook.color;
      }

      row.querySelector("[data-restore]").onclick = async () => {
        const { error: notebookRestoreError } = await client
          .from("notebooks")
          .update({ is_deleted: false, trashed_at: null })
          .eq("id", notebook.id);

        if (notebookRestoreError) return showNotesError(notebookRestoreError.message);

        const { error: notesRestoreError } = await client
          .from("notes")
          .update({ is_deleted: false, trashed_at: null })
          .eq("notebook_id", notebook.id)
          .eq("is_deleted", true);

        if (notesRestoreError) {
          // Keep state consistent if restoring child notes fails.
          await client
            .from("notebooks")
            .update({ is_deleted: true, trashed_at: notebook.trashed_at || new Date().toISOString() })
            .eq("id", notebook.id);

          return showNotesError(notesRestoreError.message);
        }

        row.remove();

        await Promise.all([
          loadNotebooks(),
          loadNoteCounts(),
          loadNotes(),
        ]);

        renderNotebooks();
        renderNotes();

        const remainingNotebooks = notebooksList.querySelectorAll(".trash-row").length;
        if (!remainingNotebooks) {
          renderCompactEmpty(notebooksList, "No deleted notebooks.");
        }

        await centeredMessage(
          "Notebook Restored",
          `"${notebook.name}" and its trashed notes were restored.`
        );
      };

      row.querySelector("[data-delete]").onclick = async () => {
        const ok = await centeredModal({
          title: "Permanently Delete Notebook",
          message: `Permanently delete "${notebook.name}" and its linked notes? This cannot be undone.`,
          confirmText: "Delete Forever",
          destructive: true
        });

        if (!ok) return;

        const { error: noteDeleteError } = await client
          .from("notes")
          .delete()
          .eq("notebook_id", notebook.id);

        if (noteDeleteError) return showNotesError(noteDeleteError.message);

        const { error } = await client
          .from("notebooks")
          .delete()
          .eq("id", notebook.id);

        if (error) return showNotesError(error.message);

        row.remove();

        const remainingNotebooks = notebooksList.querySelectorAll(".trash-row").length;
        if (!remainingNotebooks) {
          renderCompactEmpty(notebooksList, "No deleted notebooks.");
        }
      };

      notebooksList.appendChild(row);
    }
  }

  document.body.appendChild(overlay);
}

function bindTrashButton(){
  const btn = $("trashViewBtn");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", openTrashView);
  }
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
  if (notesState.orderBy === "off" || notesState.sortDirection === "off") return 0;

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
    case "notebook":
      return getNotebookName(note.notebook_id);
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
  } else if (notesState.groupBy === "abc" || notesState.groupBy === "notebook") {
    entries.sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));
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
    off: "Off",
    created_at: "Date created",
    updated_at: "Date edited",
    title: "Title",
  };
  const directionLabels = {
    off: "Off",
    asc: notesState.orderBy === "title" ? "A - Z" : "Oldest - newest",
    desc: notesState.orderBy === "title" ? "Z - A" : "Newest - oldest",
  };
  const groupLabels = {
    none: "None",
    default: "Default",
    year: "Year",
    month: "Month",
    week: "Week",
    notebook: "Notebook",
    abc: "Abc",
  };

  $("orderByValue").textContent = orderLabels[notesState.orderBy];
  $("sortDirectionValue").textContent = directionLabels[notesState.sortDirection];
  $("groupByValue").textContent = groupLabels[notesState.groupBy];

  const orderText = orderLabels[notesState.orderBy] || "Off";
  const directionText = directionLabels[notesState.sortDirection] || "Off";
  $("notesSortSummary").textContent =
    notesState.orderBy === "off" && notesState.sortDirection === "off"
      ? "Manual"
      : `${orderText.replace("Date ", "")} · ${directionText}`;

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
                ${isNoteEffectivelyLocked(note) ? '<span title="Locked">🔒</span>' : ""}
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
              ${isNoteEffectivelyLocked(note) ? '<span title="Locked">🔒</span>' : ""}
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
      const inheritedNotebookColor = notebookColorFor(note);
      if (inheritedNotebookColor) {
        btn.querySelector("strong").style.color = inheritedNotebookColor;
      }

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
          style: "font-family: monospace; font-size: 13px; line-height: normal;",
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
        chain.unsetAllMarks().clearNodes().setTextAlign("left").setFontFamily("monospace").setFontSize("13px").run();
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
    $("fontFamilySelect").value = attrs.fontFamily || "monospace";
  }
  if ($("fontSizeSelect")) {
    $("fontSizeSelect").value = attrs.fontSize || "13px";
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
  if(isNotebookInheritedLocked(note)){
    await centeredMessage("Notebook Locked","Unlock the Notebook first to open this Note.");
    return;
  }
  if(note.is_locked){
    const p=await passwordModal("Unlock Note",`Enter the password for "${note.title||"Untitled Note"}".`,"Open");
    if(p===null)return;
    const r=await rpcSecurity("portal_verify_note",{p_note_id:note.id,p_password:p});
    if(!r.ok||!r.data){await centeredMessage("Incorrect Password","The note password is incorrect.");return;}
  }
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


async function processDueAutoDeletesClient(){
  const now=new Date().toISOString();
  const {data:due}=await client.from("notes").select("id,auto_delete_mode").eq("is_deleted",false).not("auto_delete_at","is",null).lte("auto_delete_at",now);
  for(const n of due||[]){
    if(n.auto_delete_mode==="permanent") await client.from("notes").delete().eq("id",n.id);
    else await client.from("notes").update({is_deleted:true,trashed_at:now,auto_delete_at:null}).eq("id",n.id);
  }
}

async function openNotes(){
  showPortalView("notes");
  showNotesError("");
  bindTrashButton();

  try {
    await processDueAutoDeletesClient();
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
bindTrashButton();

$("noteContextMenu")?.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-note-action]");
  if (!button) return;

  const noteId = $("noteContextMenu").dataset.noteId;
  const note = notesState.notes.find((item) => item.id === noteId);
  if (!note) return hideNoteContextMenu();

  if (button.dataset.noteAction === "move" || button.dataset.noteAction === "color") {
    event.stopPropagation();
    showNoteActionSubmenu(button, note, button.dataset.noteAction);
    return;
  }

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


/* =========================================================
   Notes v7.2 — Lock behavior hotfix
   - successful Lock closes current editor immediately
   - prevents the same click from triggering immediate Unlock
   - locked note content is never left editable/visible
   ========================================================= */
(() => {
  let lockActionGuardUntil = 0;

  function v72CloseLockedEditor(noteId){
    try {
      if (typeof currentNote !== "undefined" && currentNote && String(currentNote.id) === String(noteId)) {
        currentNote = null;
      }
    } catch(e) {}

    const editor = document.querySelector(
      '#noteEditor,[data-note-editor],.note-editor,[contenteditable="true"].editor,.editor-content,[contenteditable="true"]'
    );
    if (editor) {
      if (editor.hasAttribute('contenteditable')) editor.setAttribute('contenteditable','false');
      if ('innerHTML' in editor) editor.innerHTML = '';
    }

    const title = document.querySelector('#noteTitle,[data-note-title],.note-title-input');
    if (title && 'value' in title) {
      title.value = '';
      title.disabled = true;
    }

    const pane = document.querySelector('.editor-pane,.note-editor-pane,#editorPane,[data-editor-pane]');
    if (pane) pane.classList.add('locked-note-closed');

    // Prefer the app's normal empty-editor renderer when available.
    for (const fn of ['clearEditor','showEmptyEditor','renderEmptyEditor','renderNoNoteSelected']) {
      try {
        if (typeof window[fn] === 'function') { window[fn](); break; }
      } catch(e) {}
    }
  }

  // Capture Lock button submission. After the existing handler succeeds and the
  // note becomes locked, close the editor before any selection/unlock flow can run.
  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const txt = (btn.textContent || '').trim().toLowerCase();
    const modal = btn.closest('.modal,.dialog,[role="dialog"],.confirm-modal,.custom-modal');
    const heading = modal ? (modal.textContent || '').toLowerCase() : '';

    if (txt === 'lock' && heading.includes('lock note')) {
      lockActionGuardUntil = Date.now() + 1800;
      let noteId = null;
      try { noteId = currentNote?.id || selectedNoteId || activeNoteId || null; } catch(e) {}

      setTimeout(() => {
        // Only close if the UI now marks this note locked, or if app state says locked.
        let locked = false;
        try {
          const n = (typeof notes !== 'undefined' && Array.isArray(notes))
            ? notes.find(x => String(x.id) === String(noteId)) : null;
          locked = !!(n && (n.is_locked || n.locked));
        } catch(e) {}
        if (!locked) {
          const row = noteId
            ? document.querySelector(`[data-note-id="${CSS.escape(String(noteId))}"]`)
            : document.querySelector('.note-item.selected,.note-row.selected,.note-item.active');
          locked = !!(row && (row.querySelector('.lock-icon,[data-lock-icon]') || /🔒|🔐/.test(row.textContent || '')));
        }
        if (locked) v72CloseLockedEditor(noteId);
      }, 450);
    }
  }, true);

  // Prevent an immediate Unlock dialog caused by the same Lock interaction.
  document.addEventListener('click', (ev) => {
    if (Date.now() >= lockActionGuardUntil) return;
    const row = ev.target.closest('[data-note-id],.note-item,.note-row');
    if (!row) return;
    if (row.querySelector('.lock-icon,[data-lock-icon]') || /🔒|🔐/.test(row.textContent || '')) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, true);
})();
