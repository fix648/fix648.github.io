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
$("settingsBtn")?.addEventListener("click", () => alert("Settings will be added in the next module. Log out is now available separately."));

(async function init(){
  if (await loadRecoverySession()) return;
  const { data: { session } } = await client.auth.getSession();
  showOnly(session ? "app" : "login");
})();
