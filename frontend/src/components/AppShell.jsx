import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  LayoutDashboard, Building2, Users, Boxes, FileText, FolderLock, FileStack, BellRing, Wallet, ShieldCheck, UserPlus, Activity, LogOut, KeyRound, Menu, Lock, Download,
} from "lucide-react";
import { useInstall } from "@/lib/pwa";
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
  { to: "/template", label: "Template Dokumen", icon: FileStack, id: "template" },
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
      onNavigate?.();
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
          <p key={i} className="px-3 pb-1.5 pt-6 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">{item.section}</p>
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/" || item.to === "/direktur"}
            onClick={(e) => click(e, item)}
            data-testid={`sidebar-link-${item.id}`}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-slate-400 transition-colors hover:bg-slate-800/40 hover:text-slate-100",
                isActive && "bg-gradient-to-r from-cyan-500/[0.16] to-transparent font-semibold text-[#00F0FF] shadow-[inset_2px_0_0_#00F0FF]"
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
    <div className="flex items-center gap-1 rounded-full border border-slate-700/70 bg-slate-900/60 py-1 pl-1 pr-1.5 shadow-[0_0_24px_-10px_rgba(0,240,255,0.35)] backdrop-blur-md">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#00F0FF] to-[#0369A1] font-display text-sm font-bold text-[#04121C] shadow-[0_0_14px_rgba(0,240,255,0.45)]" data-testid="topbar-avatar">
        {user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0B1220] bg-emerald-400" />
      </div>
      <div className="hidden min-w-0 px-2 leading-tight sm:block">
        <p className="truncate text-sm font-semibold text-slate-100" data-testid="topbar-user-name">{user.name}</p>
        <p className="mt-0.5 inline-flex items-center rounded-full border border-cyan-500/30 bg-cyan-950/60 px-2 py-px text-[10px] font-medium uppercase tracking-[0.12em] text-cyan-300" data-testid="topbar-user-role">{user.role_label}</p>
      </div>
      <span className="mx-1 hidden h-6 w-px bg-slate-700/70 sm:block" />
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" title="Ganti password" onClick={() => navigate("/ganti-password")} data-testid="topbar-change-password-button">
        <KeyRound className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:text-rose-300" title="Keluar" onClick={async () => { await logout(); navigate("/login"); }} data-testid="topbar-logout-button">
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
};

const InstallButton = ({ className, testId = "pwa-install-button" }) => {
  const { canInstall, iosHint, install } = useInstall();
  if (!canInstall && !iosHint) return null;
  const click = () => {
    if (canInstall) { install(); return; }
    toast.info("Di Safari: ketuk tombol Bagikan, lalu pilih 'Tambah ke Layar Utama'.", { duration: 8000 });
  };
  return (
    <Button variant="outline" size="sm" className={className} onClick={click} data-testid={testId}>
      <Download className="mr-1 h-4 w-4" />Pasang Aplikasi
    </Button>
  );
};

const BOTTOM = [
  { to: "/", label: "Beranda", icon: LayoutDashboard, id: "dashboard" },
  { to: "/penawaran", label: "Penawaran", icon: FileText, id: "penawaran" },
  { to: "/kopra", label: "Kopra", icon: Boxes, id: "kopra" },
  { to: "/pengingat", label: "Pengingat", icon: BellRing, id: "pengingat" },
];

const BottomNav = ({ onMenu }) => (
  <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800/80 bg-[#050912]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" data-testid="mobile-bottom-nav">
    <div className="grid grid-cols-5">
      {BOTTOM.map((b) => (
        <NavLink key={b.to} to={b.to} end={b.to === "/"} data-testid={`bottom-nav-${b.id}`}
          className={({ isActive }) => cn("flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-slate-400 transition-colors", isActive && "text-[#00F0FF]")}>
          {({ isActive }) => (
            <>
              <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", isActive && "bg-cyan-400/15 shadow-[0_0_14px_rgba(0,240,255,0.25)]")}><b.icon className="h-[18px] w-[18px]" /></span>
              {b.label}
            </>
          )}
        </NavLink>
      ))}
      <button onClick={onMenu} className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-slate-400" data-testid="bottom-nav-menu">
        <span className="flex h-7 w-12 items-center justify-center rounded-full"><Menu className="h-[18px] w-[18px]" /></span>Menu
      </button>
    </div>
  </nav>
);

export default function AppShell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-slate-800/70 bg-[#050912] px-3 py-6 lg:flex">
        <div className="mb-6 border-b border-slate-800/70 px-3 pb-6">
          <Logo className="h-9" />
          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">PT Gurindam Sinar Berkah</p>
        </div>
        <div className="flex-1 overflow-y-auto pr-1"><NavItems /></div>
        <p className="px-3 pt-4 font-mono text-[10px] text-slate-600">GSB31 · v1.0</p>
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-[82vw] max-w-xs flex-col border-slate-800 bg-[#050912] p-4">
          <SheetTitle className="mb-2"><Logo className="h-8" testId="mobile-logo" /></SheetTitle>
          <div className="flex-1 overflow-y-auto pb-4"><NavItems onNavigate={() => setOpen(false)} /></div>
          <InstallButton className="w-full" testId="pwa-install-button-mobile" />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-slate-800/70 bg-[#070C16]/80 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} data-testid="mobile-menu-button">
              <Menu className="h-5 w-5" />
            </Button>
            <Logo className="h-6 sm:hidden" testId="topbar-logo-mobile" />
            <span className="hidden items-center gap-2 font-mono text-xs text-slate-500 sm:flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />GSB31 · Sistem Operasional</span>
          </div>
          <div className="flex items-center gap-3">
            <InstallButton className="hidden lg:inline-flex" />
            <UserBox />
          </div>
        </header>
        <main className="flex-1 px-4 pb-28 pt-6 grid-bg sm:px-10 sm:py-10 lg:pb-10"><div className="mx-auto max-w-[1440px]"><Outlet /></div></main>
      </div>
      <BottomNav onMenu={() => setOpen(true)} />
      <RestrictionModal />
    </div>
  );
}
