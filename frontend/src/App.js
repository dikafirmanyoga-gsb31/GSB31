import { useEffect } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { LockedPanel } from "@/components/Restriction";
import Login from "@/pages/Login";
import ChangePassword from "@/pages/ChangePassword";
import Dashboard from "@/pages/Dashboard";
import Company from "@/pages/Company";
import Partners from "@/pages/Partners";
import Kopra from "@/pages/Kopra";
import Quotations from "@/pages/Quotations";
import QuotationForm from "@/pages/QuotationForm";
import QuotationDetail from "@/pages/QuotationDetail";
import Documents from "@/pages/Documents";
import Reminders from "@/pages/Reminders";
import Finance from "@/pages/Finance";
import Director from "@/pages/Director";
import CP31 from "@/pages/CP31";

const Splash = () => (
  <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground" data-testid="app-loading">Memuat GSB31…</div>
);

function Guard({ perm, children }) {
  const { can } = useAuth();
  const ok = can(perm);
  useEffect(() => {
    if (!ok) { api.post("/access/check", { feature: perm }).catch(() => {}); }
  }, [ok, perm]);
  return ok ? children : <LockedPanel perm={perm} />;
}

function Protected() {
  const { user } = useAuth();
  if (user === null) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <ChangePassword forced />;
  return <AppShell />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="perusahaan" element={<Company />} />
        <Route path="mitra" element={<Partners />} />
        <Route path="kopra" element={<Kopra />} />
        <Route path="penawaran" element={<Quotations />} />
        <Route path="penawaran/baru" element={<QuotationForm />} />
        <Route path="penawaran/:id" element={<QuotationDetail />} />
        <Route path="penawaran/:id/edit" element={<QuotationForm />} />
        <Route path="dokumen" element={<Documents />} />
        <Route path="pengingat" element={<Reminders />} />
        <Route path="keuangan" element={<Guard perm="finance"><Finance /></Guard>} />
        <Route path="direktur" element={<Guard perm="director"><Director tab="ringkasan" /></Guard>} />
        <Route path="direktur/akun" element={<Guard perm="director"><Director tab="akun" /></Guard>} />
        <Route path="integrasi-cp31" element={<CP31 />} />
        <Route path="ganti-password" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App dark">
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster theme="dark" richColors position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
