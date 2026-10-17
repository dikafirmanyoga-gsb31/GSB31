import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, PageHeader, Card } from "@/components/common";

export default function ChangePassword({ forced }) {
  const { setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ current_password: "", new_password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (f.new_password.length < 8) return setError("Password baru minimal 8 karakter.");
    if (f.new_password !== f.confirm) return setError("Konfirmasi password tidak sama.");
    setBusy(true);
    try {
      const { data } = await api.post("/auth/change-password", { current_password: f.current_password, new_password: f.new_password });
      setUser(data);
      toast.success("Password berhasil diganti.");
      navigate("/");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const form = (
    <form onSubmit={submit} className="space-y-4" data-testid="change-password-form">
      <Field label="Password saat ini" htmlFor="cp-cur">
        <Input id="cp-cur" type="password" value={f.current_password} onChange={set("current_password")} data-testid="change-password-current-input" />
      </Field>
      <Field label="Password baru" htmlFor="cp-new" hint="Minimal 8 karakter, mengandung huruf dan angka.">
        <Input id="cp-new" type="password" value={f.new_password} onChange={set("new_password")} data-testid="change-password-new-input" />
      </Field>
      <Field label="Ulangi password baru" htmlFor="cp-conf">
        <Input id="cp-conf" type="password" value={f.confirm} onChange={set("confirm")} data-testid="change-password-confirm-input" />
      </Field>
      {error && <p className="text-sm text-red-300" data-testid="change-password-error">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} data-testid="change-password-submit-button">Simpan Password</Button>
        {forced && <Button type="button" variant="ghost" onClick={logout} data-testid="change-password-logout-button">Keluar</Button>}
      </div>
    </form>
  );

  if (!forced) {
    return (
      <div className="max-w-lg">
        <PageHeader title="Ganti Password" subtitle="Perbarui password akun Anda." />
        <Card>{form}</Card>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0B1120] grid-bg px-4">
      <div className="w-full max-w-md rounded-2xl border border-cyan-400/20 bg-[#0F172A]/90 p-7 neon-border fade-up">
        <Logo className="mb-4 h-10" testId="change-password-logo" />
        <h1 className="font-display text-xl font-bold">Atur Password Baru</h1>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">Demi keamanan, ganti password sementara Anda sebelum menggunakan aplikasi.</p>
        {form}
      </div>
    </div>
  );
}
