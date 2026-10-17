import { Link } from "react-router-dom";
import { Users, FileText, FolderLock, BellRing, Boxes, Wallet, Lock, TrendingUp, TrendingDown } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { fmtIDR, fmtNum, fmtDate } from "@/lib/api";
import { PageHeader, Card, StatCard, Badge, Empty, useFetch } from "@/components/common";

const SectionTitle = ({ children, to, testId }) => (
  <div className="mb-3 flex items-center justify-between">
    <h2 className="font-display text-base font-semibold">{children}</h2>
    {to && <Link to={to} className="text-xs text-cyan-300 hover:underline" data-testid={testId}>Lihat semua</Link>}
  </div>
);

const FinanceCard = ({ data }) => {
  if (!data) {
    return (
      <Card className="flex flex-col items-center justify-center gap-2 text-center" data-testid="dashboard-finance-locked">
        <Lock className="h-5 w-5 text-amber-400" />
        <p className="font-display font-semibold">Ringkasan Keuangan</p>
        <p className="text-xs text-muted-foreground">Akses dibatasi untuk akun Anda.</p>
      </Card>
    );
  }
  const m = data.month;
  return (
    <Card data-testid="dashboard-finance-card">
      <SectionTitle to="/keuangan" testId="dashboard-finance-link">Keuangan Bulan Ini</SectionTitle>
      <div className="space-y-2 text-sm">
        <p className="flex justify-between"><span className="flex items-center gap-1 text-emerald-300"><TrendingUp className="h-3.5 w-3.5" />Pemasukan</span><span data-testid="dashboard-finance-income">{fmtIDR(m.income)}</span></p>
        <p className="flex justify-between"><span className="flex items-center gap-1 text-red-300"><TrendingDown className="h-3.5 w-3.5" />Pengeluaran</span><span data-testid="dashboard-finance-expense">{fmtIDR(m.expense)}</span></p>
        <p className="flex justify-between border-t border-border pt-2 font-semibold"><span>Selisih</span><span data-testid="dashboard-finance-net">{fmtIDR(m.net)}</span></p>
        <p className="text-xs text-muted-foreground">{m.count} transaksi tercatat</p>
      </div>
    </Card>
  );
};

export default function Dashboard() {
  const { user } = useAuth();
  const { data: d, loading } = useFetch("/dashboard");
  if (loading && !d) return <p className="text-sm text-muted-foreground">Memuat dashboard…</p>;
  if (!d) return <Empty text="Dashboard tidak dapat dimuat." />;
  const q = d.quotations || {};
  return (
    <div data-testid="dashboard-page">
      <PageHeader title={`Selamat datang, ${user.name}`} subtitle={`Ringkasan bisnis · periode ${fmtDate(d.period.from)} – ${fmtDate(d.period.to)}`} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pelanggan" value={d.partners.pelanggan} hint={`${d.partners.pemasok} pemasok · ${d.partners.mitra} mitra`} icon={Users} testId="stat-partners" />
        <StatCard label="Penawaran aktif" value={(q.pending || 0) + (q.approved || 0) + (q.sent || 0)} hint={`${q.pending || 0} menunggu persetujuan`} icon={FileText} testId="stat-quotations" />
        <StatCard label="Kontrak aktif" value={d.contracts.aktif} hint={`${d.contracts.segera} segera berakhir · ${d.contracts.kedaluwarsa} kedaluwarsa`} icon={FolderLock} testId="stat-contracts" />
        <StatCard label="Pengingat terbuka" value={d.reminders_open} hint={`${d.reminders_overdue} terlambat`} icon={BellRing} accent="text-amber-400" testId="stat-reminders" />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-testid="dashboard-expiring">
          <SectionTitle to="/dokumen" testId="dashboard-docs-link">Dokumen & Kontrak Mendekati/Lewat Masa Berlaku</SectionTitle>
          {d.expiring.length === 0 ? <Empty text="Tidak ada dokumen yang mendekati kedaluwarsa." /> : (
            <ul className="divide-y divide-border">
              {d.expiring.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{x.name} <span className="text-xs text-muted-foreground">· {x.kind === "kontrak" ? "Kontrak" : "Dokumen"}</span></span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{fmtDate(x.expiry_date)}<Badge value={x.validity} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <FinanceCard data={d.finance} />
        <Card className="lg:col-span-2" data-testid="dashboard-reminders">
          <SectionTitle to="/pengingat" testId="dashboard-reminders-link">Pengingat & Tugas Mendatang</SectionTitle>
          {d.reminders.length === 0 ? <Empty text="Tidak ada pengingat terbuka." /> : (
            <ul className="divide-y divide-border">
              {d.reminders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{r.title}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{fmtDate(r.due_date)}<Badge value={r.level} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card data-testid="dashboard-quotation-status">
          <SectionTitle to="/penawaran" testId="dashboard-quotations-link">Status Penawaran</SectionTitle>
          <div className="space-y-2">
            {["draft", "pending", "approved", "sent", "rejected", "expired"].map((s) => (
              <div key={s} className="flex items-center justify-between text-sm"><Badge value={s} /><span className="font-mono">{q[s] || 0}</span></div>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-2" data-testid="dashboard-recent-kopra">
          <SectionTitle to="/kopra" testId="dashboard-kopra-link">Aktivitas Usaha Kopra Terbaru</SectionTitle>
          {d.recent_kopra.length === 0 ? <Empty text="Belum ada kegiatan kopra tercatat." /> : (
            <ul className="divide-y divide-border">
              {d.recent_kopra.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{k.activity_type} · {fmtNum(k.quantity)} {k.unit}{k.partner_name ? ` · ${k.partner_name}` : ""}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{fmtDate(k.date)}<Badge value={k.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card data-testid="dashboard-kopra-month">
          <SectionTitle>
            <span className="flex items-center gap-2"><Boxes className="h-4 w-4 text-cyan-300" />Volume Kopra Bulan Ini</span>
          </SectionTitle>
          {d.kopra_month.length === 0 ? <Empty text="Belum ada volume bulan ini." /> : d.kopra_month.map((k) => (
            <p key={k.activity_type + k.unit} className="flex justify-between py-1 text-sm"><span>{k.activity_type}</span><span className="font-mono">{fmtNum(k.quantity)} {k.unit}</span></p>
          ))}
        </Card>
      </div>
      {!d.finance && <p className="mt-4 flex items-center gap-1 text-xs text-muted-foreground"><Wallet className="h-3 w-3" />Data keuangan tidak ditampilkan untuk peran Anda.</p>}
    </div>
  );
}
