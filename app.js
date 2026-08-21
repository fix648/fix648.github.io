const SUPABASE_URL = "https://oiaudmzrwtaljkcwbooi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_IHsq14XmgVhe9J8taquEkg_n_TCiDVn";

const client = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);

const themeButton = document.getElementById("theme");
const portalApp = document.getElementById("portalApp");
const resetScreen = document.getElementById("resetScreen");
const resetForm = document.getElementById("resetPasswordForm");
const resetMessage = document.getElementById("resetMessage");
const savePasswordBtn = document.getElementById("savePasswordBtn");
const resetFormWrap = document.getElementById("resetFormWrap");
const resetSuccess = document.getElementById("resetSuccess");

if (themeButton) {
  themeButton.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    themeButton.textContent = document.body.classList.contains("dark")
      ? "Light Mode"
      : "Dark Mode";
  });
}

document.querySelectorAll(".toggle-password").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target);
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
  });
});

function showMessage(message, type = "error") {
  resetMessage.textContent = message;
  resetMessage.className = `form-message ${type}`;
}

function clearAuthParameters() {
  history.replaceState({}, document.title, window.location.pathname);
}

function getHashParams() {
  const raw = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(raw);
}

async function loadRecoverySession() {
  const hash = getHashParams();
  const type = hash.get("type");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const code = new URLSearchParams(window.location.search).get("code");

  const appearsToBeRecovery =
    type === "recovery" ||
    (!!accessToken && !!refreshToken) ||
    !!code;

  if (!appearsToBeRecovery) return false;

  portalApp.classList.add("hidden");
  resetScreen.classList.remove("hidden");

  try {
    let error = null;

    if (code) {
      const result = await client.auth.exchangeCodeForSession(code);
      error = result.error;
    } else if (accessToken && refreshToken) {
      const result = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      error = result.error;
    } else {
      error = new Error("Recovery session was not found.");
    }

    if (error) {
      showMessage("This recovery link is invalid or has expired. Request a new recovery email.");
      savePasswordBtn.disabled = true;
      return true;
    }

    clearAuthParameters();
    return true;
  } catch (error) {
    console.error("RECOVERY_SESSION_ERROR", error);
    showMessage("Unable to open this recovery session. Request a new recovery email.");
    savePasswordBtn.disabled = true;
    return true;
  }
}

if (resetForm) {
  resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword.length < 8) {
      showMessage("Use at least 8 characters for the new base password.");
      return;
    }

    if (newPassword !== confirmPassword) {
      showMessage("The two passwords do not match.");
      return;
    }

    savePasswordBtn.disabled = true;
    savePasswordBtn.textContent = "Saving...";
    showMessage("", "ok");

    const { error } = await client.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      console.error("PASSWORD_UPDATE_ERROR", error);
      showMessage(error.message || "Unable to update password.");
      savePasswordBtn.disabled = false;
      savePasswordBtn.textContent = "Save new password";
      return;
    }

    await client.auth.signOut();
    resetFormWrap.classList.add("hidden");
    resetSuccess.classList.remove("hidden");
  });
}

loadRecoverySession();
