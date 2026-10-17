import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { errMsg } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/common";

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!identifier.trim() || !password) return setError("Username/email dan password wajib diisi.");
    setBusy(true);
    try {
      await login(identifier.trim(), password);
      navigate("/");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0B1120] grid-bg px-4">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full border border-cyan-400/10" />
      <div className="pointer-events-none absolute -bottom-52 -right-32 h-[34rem] w-[34rem] rounded-full border border-cyan-400/10" />
      <div className="relative w-full max-w-md fade-up">
        <div className="mb-8 text-center">
          <Logo className="mx-auto h-14" testId="login-logo" />
          <p className="mt-3 text-sm text-slate-400">Sistem Operasional PT Gurindam Sinar Berkah</p>
        </div>
        <form onSubmit={submit} className="space-y-5 rounded-2xl border border-cyan-400/20 bg-[#0F172A]/80 p-7 backdrop-blur-xl neon-border" data-testid="login-form">
          <Field label="Username atau Email" htmlFor="identifier">
            <Input id="identifier" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} data-testid="login-identifier-input" />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password-input" />
          </Field>
          {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300" data-testid="login-error">{error}</p>}
          <Button type="submit" className="w-full font-semibold" disabled={busy} data-testid="login-submit-button">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Masuk"}
          </Button>
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400/70" />
            Tidak ada pendaftaran publik. Akun dibuat oleh Direktur. Lupa password? Hubungi Direktur untuk reset.
          </p>
        </form>
      </div>
    </div>
  );
}
