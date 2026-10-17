import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
export const api = axios.create({ baseURL: API, withCredentials: true });

let refreshing = null;
api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const { response, config } = err;
    if (response?.status === 401 && config && !config._retry && !config.url.includes("/auth/")) {
      config._retry = true;
      try {
        refreshing = refreshing || api.post("/auth/refresh");
        await refreshing;
        refreshing = null;
        return api(config);
      } catch (e) {
        refreshing = null;
        window.dispatchEvent(new Event("gsb:logout"));
      }
    }
    const code = response?.data?.detail?.code;
    if (response?.status === 403 && (code === "DIRECTOR_ONLY" || code === "FINANCE_RESTRICTED")) {
      window.dispatchEvent(new CustomEvent("gsb:restricted", { detail: code }));
    }
    if (code === "PASSWORD_CHANGE_REQUIRED") window.dispatchEvent(new Event("gsb:mustchange"));
    return Promise.reject(err);
  }
);

export function errMsg(e) {
  const d = e?.response?.data?.detail;
  if (!d) return e?.response ? "Terjadi kesalahan. Silakan coba lagi." : "Tidak dapat terhubung ke server.";
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => (x?.msg || "").replace(/^Value error, /, "")).filter(Boolean).join(" ");
  if (d.message) return d.message;
  return "Terjadi kesalahan.";
}

export async function downloadFile(url, params) {
  const res = await api.get(url, { params, responseType: "blob" });
  const cd = res.headers["content-disposition"] || "";
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || "laporan.xlsx";
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
}

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
export const fmtIDR = (v) => (v === null || v === undefined ? "—" : idr.format(v));
export const fmtNum = (v) => (v === null || v === undefined ? "—" : num.format(v));
export const fmtDate = (s) =>
  s ? new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }) : "—";
export const fmtDateTime = (s) =>
  s ? new Date(s).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) : "—";
export const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
