import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const CONTENT = {
  DIRECTOR_ONLY: {
    title: "DIRECTOR ONLY — KHUSUS DIREKTUR",
    message: "Maaf, fitur ini hanya dapat diakses oleh Direktur PT Gurindam Sinar Berkah. Akun Anda tidak memiliki izin untuk membuka fitur ini.",
  },
  FINANCE_RESTRICTED: {
    title: "ACCESS RESTRICTED — AKSES DIBATASI",
    message: "Maaf, akun Anda tidak memiliki izin untuk mengakses fitur keuangan. Silakan hubungi direktur jika Anda memerlukan perubahan hak akses.",
  },
};

export const RestrictionModal = () => {
  const [code, setCode] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const h = (e) => setCode(e.detail);
    window.addEventListener("gsb:restricted", h);
    return () => window.removeEventListener("gsb:restricted", h);
  }, []);

  const c = CONTENT[code];
  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && setCode(null)}>
      <DialogContent className="border-amber-500/40 bg-[#0F172A] sm:max-w-md" data-testid="restriction-modal">
        <DialogHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-amber-400/50 bg-amber-500/10">
            <ShieldAlert className="h-6 w-6 text-amber-400" />
          </div>
          <DialogTitle className="font-display text-lg tracking-wide text-amber-300" data-testid="restriction-modal-title">
            {c?.title}
          </DialogTitle>
          <DialogDescription className="text-slate-300" data-testid="restriction-modal-message">
            {c?.message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => setCode(null)} data-testid="restriction-modal-close-button">Tutup</Button>
          <Button onClick={() => { setCode(null); navigate("/"); }} data-testid="restriction-modal-dashboard-button">Kembali ke Dashboard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const LockedPanel = ({ perm }) => (
  <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center" data-testid="locked-panel">
    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-amber-400/40 bg-amber-500/10">
      <Lock className="h-6 w-6 text-amber-400" />
    </div>
    <h2 className="font-display text-xl font-bold">{perm === "director" ? "Khusus Direktur" : "Akses Dibatasi"}</h2>
    <p className="max-w-md text-sm text-muted-foreground">Halaman ini tidak tersedia untuk akun Anda. Data tidak ditampilkan.</p>
  </div>
);
