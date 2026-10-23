// Minimal loader for the Facebook JS SDK, used only for "Continue with Facebook".
declare global {
  interface Window { FB?: any; fbAsyncInit?: () => void }
}

const APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;
const VERSION = (import.meta.env.VITE_META_GRAPH_VERSION as string | undefined) || "v23.0";

export const metaConfigured = Boolean(APP_ID);

// Permissions needed to subscribe a page to Lead Ads and read the leads.
const SCOPE = [
  "pages_show_list", "pages_read_engagement", "pages_manage_metadata",
  "pages_manage_ads", "leads_retrieval", "business_management",
].join(",");

let loading: Promise<any> | null = null;

function loadSdk(): Promise<any> {
  if (window.FB) return Promise.resolve(window.FB);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId: APP_ID, cookie: false, xfbml: false, version: VERSION });
      resolve(window.FB);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.onerror = () => reject(new Error("Could not load Facebook. Check ad blockers and try again."));
    document.body.appendChild(s);
  });
  return loading;
}

/** Opens the Facebook login popup and resolves with a short-lived user token. */
export async function facebookLogin(): Promise<string> {
  if (!APP_ID) throw new Error("VITE_META_APP_ID is not set");
  const FB = await loadSdk();
  return new Promise((resolve, reject) => {
    FB.login((res: any) => {
      if (res.authResponse?.accessToken) resolve(res.authResponse.accessToken);
      else reject(new Error("Facebook login was cancelled"));
    }, { scope: SCOPE, return_scopes: true, auth_type: "rerequest" });
  });
}
