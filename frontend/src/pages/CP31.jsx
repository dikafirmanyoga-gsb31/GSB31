import { Activity, CircleDashed } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/common";

const SCOPE = [
  "Ringkasan mitra yang juga terlibat di bisnis limbah B3 (hanya referensi, tanpa duplikasi database CP31).",
  "Tautan dokumen/kontrak lintas aplikasi bila ada kebutuhan bisnis yang nyata.",
  "Pertukaran data hanya melalui API terautentikasi dan dengan izin Direktur.",
];

export default function CP31() {
  return (
    <div className="max-w-3xl" data-testid="cp31-page">
      <PageHeader title="Integrasi CP31" subtitle="CP31 adalah sistem terpisah untuk transportasi, pengelolaan, dan intelijen bisnis limbah B3." />
      <Card className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-500/40"><Activity className="h-5 w-5 text-slate-400" /></div>
        <div className="flex-1">
          <p className="font-display font-semibold">Status koneksi</p>
          <p className="text-sm text-muted-foreground">Belum ada endpoint atau dokumentasi API CP31. Tidak ada data yang dikirim atau diterima.</p>
        </div>
        <Badge label="Belum terhubung" tone="slate" testId="cp31-status-badge" />
      </Card>
      <Card className="mt-4">
        <h2 className="mb-3 font-display font-semibold">Rancangan cakupan integrasi (belum aktif)</h2>
        <ul className="space-y-2">
          {SCOPE.map((s) => <li key={s} className="flex gap-2 text-sm text-slate-300"><CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400/60" />{s}</li>)}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">Integrasi akan diaktifkan setelah endpoint dan metode autentikasi CP31 tersedia dan disetujui Direktur.</p>
      </Card>
    </div>
  );
}
