import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Building2, Users, Boxes, FileText, FolderLock, BellRing, Wallet, ShieldCheck, UserPlus, Activity, LogOut, KeyRound, Menu, Lock,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { Logo } from "@/components/Logo";
import { RestrictionModal } from "@/components/Restriction";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, id: "dashboard" },
  { to: "/perusahaan", label: "Data Perusahaan", icon: Building2, id: "perusahaan" },
  { to: "/mitra", label: "Pelanggan & Pemasok", icon: Users, id: "mitra" },
  { to: "/kopra", label: "Usaha Kopra", icon: Boxes, id: "kopra" },
  { to: "/penawaran", label: "Penawaran", icon: FileText, id: "penawaran" },
  { to: "/dokumen", label: "Dokumen & Kontrak", icon: FolderLock, id: "dokumen" },
  { to: "/pengingat", label: "Pengingat", icon: BellRing, id: "pengingat" },
  { to: "/keuangan", label: "Keuangan", icon: Wallet, id: "keuangan", perm: "finance" },
  { section: "Direktur" },
  { to: "/direktur", label: "Menu Direktur", icon: ShieldCheck, id: "direktur", perm: "director" },
  { to: "/direktur/akun", label: "Kelola Akun Anggota", icon: UserPlus, id: "akun", perm: "director" },
  { section: "Integrasi" },
  { to: "/integrasi-cp31", label: "Integrasi CP31", icon: Activity, id: "cp31" },
];

const NavItems = ({ onNavigate }) => {
  const { can } = useAuth();
  const navigate = useNavigate();
  const click = (e, item) => {
    if (item.perm && !can(item.perm)) {
      e.preventDefault();
      api.post("/access/check", { feature: item.perm }).catch(() => {});
      return;
    }
    onNavigate?.();
    navigate(item.to);
    e.preventDefault();
  };
  return (
    <nav className="space-y-1">
      {NAV.map((item, i) =>
        item.section ? (
          <p key={i} className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{item.section}</p>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/" || item.to === "/direktur"}
            onClick={(e) => click(e, item)}
            data-testid={`sidebar-link-${item.id}`}
            className={({ isActive }) =>
              cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white",
                isActive && "bg-cyan-400/10 text-[#00F0FF] neon-border"
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.perm && !can(item.perm) && <Lock className="h-3 w-3 text-slate-500" />}
          </NavLink>
        )
      )}
    </nav>
  );
};

const UserBox = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right sm:block">
        <p className="text-sm font-semibold" data-testid="topbar-user-name">{user.name}</p>
        <p className="text-xs text-cyan-300/80" data-testid="topbar-user-role">{user.role_label}</p>
      </div>
      <Button variant="ghost" size="icon" title="Ganti password" onClick={() => navigate("/ganti-password")} data-testid="topbar-change-password-button">
        <KeyRound className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" title="Keluar" onClick={async () => { await logout(); navigate("/login"); }} data-testid="topbar-logout-button">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default function AppShell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-[#070D19] px-3 py-5 lg:flex">
        <div className="mb-6 px-2">
          <Logo className="h-9" />
          <p className="mt-1 text-[11px] text-slate-500">PT Gurindam Sinar Berkah</p>
        </div>
        <div className="flex-1 overflow-y-auto"><NavItems /></div>
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-border bg-[#070D19] p-4">
          <SheetTitle className="mb-4"><Logo className="h-8" testId="mobile-logo" /></SheetTitle>
          <NavItems onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} data-testid="mobile-menu-button">
              <Menu className="h-5 w-5" />
            </Button>
            <span className="hidden font-mono text-xs text-slate-500 sm:inline">GSB31 · Sistem Operasional</span>
          </div>
          <UserBox />
        </header>
        <main className="flex-1 px-4 py-6 grid-bg sm:px-8 sm:py-8"><Outlet /></main>
      </div>
      <RestrictionModal />
    </div>
  );
}
