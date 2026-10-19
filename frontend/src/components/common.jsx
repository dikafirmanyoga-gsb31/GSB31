import { useEffect, useState, forwardRef } from "react";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const PageHeader = ({ title, subtitle, actions, testId }) => (
  <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between fade-up">
    <div>
      <div className="mb-2 h-[2px] w-10 rounded-full bg-gradient-to-r from-[#00F0FF] to-transparent" />
      <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-[2rem]" data-testid={testId || "page-title"}>{title}</h1>
      {subtitle && <p className="mt-1.5 max-w-3xl text-sm text-slate-400">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const Card = ({ className, children, ...p }) => (
  <div className={cn("glass-card accent-line rounded-2xl border border-slate-800/80 p-5 transition-[border-color,box-shadow] duration-200 hover:border-cyan-500/25", className)} {...p}>{children}</div>
);

export const StatCard = ({ label, value, hint, icon: Icon, testId, accent = "text-[#00F0FF]" }) => (
  <Card className="group fade-up hover:shadow-[0_10px_30px_-12px_rgba(0,240,255,0.18)]" data-testid={testId}>
    <div className="flex items-start justify-between gap-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">{label}</p>
      {Icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700/70 bg-slate-900/60"><Icon className={cn("h-4 w-4", accent)} /></span>}
    </div>
    <p className="mt-3 break-words font-mono text-2xl font-semibold tracking-tight text-white sm:text-[1.7rem]">{value}</p>
    {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
  </Card>
);

const TONES = {
  cyan: "border-cyan-500/30 bg-cyan-950/60 text-cyan-300 [--dot:#22d3ee]",
  amber: "border-amber-500/30 bg-amber-950/60 text-amber-300 [--dot:#fbbf24]",
  red: "border-rose-500/30 bg-rose-950/60 text-rose-300 [--dot:#fb7185]",
  green: "border-emerald-500/30 bg-emerald-950/60 text-emerald-300 [--dot:#34d399]",
  slate: "border-slate-600/50 bg-slate-800/50 text-slate-300 [--dot:#94a3b8]",
  blue: "border-sky-500/30 bg-sky-950/60 text-sky-300 [--dot:#38bdf8]",
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
    <span data-testid={testId} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium", TONES[tone || t])}>
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--dot)]" />
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

export const Table = ({ head, children, testId, mobile }) => (
  <>
    {mobile && <div className="space-y-3 md:hidden" data-testid={testId ? `${testId}-mobile` : undefined}>{mobile}</div>}
    <div className={cn("glass-card overflow-x-auto rounded-2xl border border-slate-800/80", mobile && "hidden md:block")} data-testid={testId}>
    <table className="w-full min-w-[640px] text-sm">
      <thead className="border-b border-slate-800 bg-[#0A101D]/90 text-left text-[11px] uppercase tracking-[0.12em] text-slate-400">
        <tr>{head.map((h) => <th key={h} className="px-4 py-3.5 font-medium">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-slate-800/60 [&>tr]:transition-colors [&>tr:hover]:bg-cyan-400/[0.04]">{children}</tbody>
    </table>
    </div>
  </>
);

export const MobileCard = ({ title, subtitle, badge, rows = [], footer, onClick, testId }) => (
  <div onClick={onClick} className={cn("glass-card accent-line rounded-2xl border border-slate-800/80 p-4 active:scale-[0.99] transition-transform", onClick && "cursor-pointer")} data-testid={testId}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="break-words font-semibold text-slate-100">{title}</p>
        {subtitle && <p className="mt-0.5 break-words text-xs text-slate-400">{subtitle}</p>}
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </div>
    {rows.length > 0 && (
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-800/70 pt-3 text-sm">
        {rows.filter(Boolean).map(([k, v]) => (
          <div key={k} className="min-w-0"><dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{k}</dt><dd className="break-words text-slate-200">{v}</dd></div>
        ))}
      </dl>
    )}
    {footer && <div className="mt-3 flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>{footer}</div>}
  </div>
);
export const Td = ({ className, children, ...p }) => <td className={cn("px-4 py-3.5 align-top text-slate-200", className)} {...p}>{children}</td>;

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
