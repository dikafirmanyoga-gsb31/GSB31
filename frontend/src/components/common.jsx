import { useEffect, useState, forwardRef } from "react";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const PageHeader = ({ title, subtitle, actions, testId }) => (
  <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between fade-up">
    <div>
      <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl" data-testid={testId || "page-title"}>{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const Card = ({ className, children, ...p }) => (
  <div className={cn("rounded-xl border border-border bg-card/80 p-5", className)} {...p}>{children}</div>
);

export const StatCard = ({ label, value, hint, icon: Icon, testId, accent = "text-[#00F0FF]" }) => (
  <Card className="fade-up transition-colors hover:border-cyan-400/40" data-testid={testId}>
    <div className="flex items-start justify-between">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      {Icon && <Icon className={cn("h-4 w-4", accent)} />}
    </div>
    <p className="mt-3 font-display text-2xl font-bold">{value}</p>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </Card>
);

const TONES = {
  cyan: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  amber: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  red: "border-red-400/40 bg-red-500/10 text-red-300",
  green: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  slate: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  blue: "border-sky-400/40 bg-sky-400/10 text-sky-300",
};

export const STATUS = {
  draft: ["Draft", "slate"], pending: ["Menunggu Persetujuan", "amber"], approved: ["Disetujui", "green"],
  sent: ["Dikirim", "blue"], rejected: ["Ditolak", "red"], expired: ["Kedaluwarsa", "red"],
  berlaku: ["Berlaku", "green"], segera: ["Segera Berakhir", "amber"], kedaluwarsa: ["Kedaluwarsa", "red"],
  tanpa_batas: ["Tanpa Batas", "slate"], arsip: ["Arsip", "slate"],
  rencana: ["Rencana", "slate"], berjalan: ["Berjalan", "cyan"], selesai: ["Selesai", "green"], dibatalkan: ["Dibatalkan", "red"],
  terlambat: ["Terlambat", "red"], terjadwal: ["Terjadwal", "slate"], open: ["Belum Ditindaklanjuti", "amber"], done: ["Sudah Ditindaklanjuti", "green"],
  pemasukan: ["Pemasukan", "green"], pengeluaran: ["Pengeluaran", "red"],
};

export const Badge = ({ value, label, tone, testId }) => {
  const [l, t] = STATUS[value] || [label || (value?.startsWith?.("H-") ? value : value), value?.startsWith?.("H-") ? "amber" : "slate"];
  return (
    <span data-testid={testId} className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium", TONES[tone || t])}>
      {label || l}
    </span>
  );
};

export const Field = ({ label, htmlFor, children, hint, className }) => (
  <div className={cn("space-y-1.5", className)}>
    <Label htmlFor={htmlFor} className="text-xs text-slate-300">{label}</Label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

export const Select = forwardRef(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn("field-select", className)} {...p}>{children}</select>
));
Select.displayName = "Select";

export const Empty = ({ text = "Belum ada data.", testId = "empty-state" }) => (
  <div className="py-10 text-center text-sm text-muted-foreground" data-testid={testId}>{text}</div>
);

export const Table = ({ head, children, testId }) => (
  <div className="overflow-x-auto rounded-xl border border-border bg-card/60" data-testid={testId}>
    <table className="w-full min-w-[640px] text-sm">
      <thead className="bg-[#0F172A] text-left text-xs uppercase tracking-wider text-muted-foreground">
        <tr>{head.map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-border">{children}</tbody>
    </table>
  </div>
);
export const Td = ({ className, children, ...p }) => <td className={cn("px-4 py-3 align-top", className)} {...p}>{children}</td>;

export function useFetch(url, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) { return; }
    let alive = true;
    setLoading(true);
    api.get(url).then((r) => alive && setData(r.data)).catch(() => alive && setData(null)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  return { data, loading, reload: () => setTick((t) => t + 1) };
}

export const useSettings = () => useFetch("/settings").data;
export const usePartners = () => useFetch("/partners").data || [];
