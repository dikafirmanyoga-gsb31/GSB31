import { useState } from "react";
import { Plus, Pencil, Ban, FileSpreadsheet, TrendingUp, TrendingDown, Scale } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, fmtDate, fmtIDR, todayISO, downloadFile } from "@/lib/api";
import { PageHeader, Card, StatCard, Field, Select, Table, Td, Badge, Empty, MobileCard, useFetch, useSettings, usePartners } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

function TxDialog({ initial, settings, partners, onClose, onSaved }) {
  const [f, setF] = useState({ type: "pemasukan", date: todayISO(), category: settings.income_categories[0], amount: "", description: "", partner_id: "", reference_no: "", ...initial });
  const cats = f.type === "pemasukan" ? settings.income_categories : settings.expense_categories;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const amount = parseFloat(f.amount);
    if (!(amount > 0)) return toast.error("Nominal harus lebih dari 0.");
    if (f.description.trim().length < 2) return toast.error("Keterangan wajib diisi.");
    const body = { type: f.type, date: f.date, category: f.category, amount, description: f.description, partner_id: f.partner_id || null, reference_no: f.reference_no || null };
    try {
      if (initial?.id) await api.put(`/finance/transactions/${initial.id}`, body);
      else await api.post("/finance/transactions", body);
      toast.success("Transaksi disimpan.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="transaction-dialog">
        <DialogHeader><DialogTitle>{initial?.id ? "Ubah Transaksi" : "Catat Transaksi"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jenis"><Select value={f.type} onChange={(e) => { const t = e.target.value; setF({ ...f, type: t, category: (t === "pemasukan" ? settings.income_categories : settings.expense_categories)[0] }); }} data-testid="transaction-type-select"><option value="pemasukan">Pemasukan</option><option value="pengeluaran">Pengeluaran</option></Select></Field>
          <Field label="Tanggal" htmlFor="tx-date"><Input id="tx-date" type="date" value={f.date} onChange={set("date")} data-testid="transaction-date-input" /></Field>
          <Field label="Kategori"><Select value={f.category} onChange={set("category")} data-testid="transaction-category-select">{cats.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Nominal (Rp) *" htmlFor="tx-amt"><Input id="tx-amt" type="number" min="0" step="any" value={f.amount} onChange={set("amount")} data-testid="transaction-amount-input" /></Field>
          <Field label="Pelanggan / pemasok" className="sm:col-span-2"><Select value={f.partner_id || ""} onChange={set("partner_id")} data-testid="transaction-partner-select"><option value="">— Tidak ada —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Keterangan *" htmlFor="tx-desc" className="sm:col-span-2"><Input id="tx-desc" value={f.description} onChange={set("description")} data-testid="transaction-description-input" /></Field>
          <Field label="No. referensi" htmlFor="tx-ref"><Input id="tx-ref" value={f.reference_no || ""} onChange={set("reference_no")} data-testid="transaction-reference-input" /></Field>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={save} data-testid="transaction-save-button">Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Finance() {
  const { can } = useAuth();
  const settings = useSettings();
  const partners = usePartners();
  const [p, setP] = useState({ date_from: `${todayISO().slice(0, 4)}-01-01`, date_to: todayISO(), type: "" });
  const qs = new URLSearchParams(p).toString();
  const { data: tx, reload } = useFetch(`/finance/transactions?${qs}`);
  const { data: sum, reload: reloadSum } = useFetch(`/finance/summary?date_from=${p.date_from}&date_to=${p.date_to}`);
  const [dlg, setDlg] = useState(null);
  const refresh = () => { reload(); reloadSum(); };
  const [voiding, setVoiding] = useState(null);
  const [reason, setReason] = useState("");
  const voidTx = async () => {
    if (reason.trim().length < 3) return toast.error("Alasan minimal 3 karakter.");
    try {
      await api.post(`/finance/transactions/${voiding.id}/void`, { reason });
      toast.success("Transaksi dibatalkan.");
      setVoiding(null);
      setReason("");
      refresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  if (!settings) return null;
  return (
    <div data-testid="finance-page">
      <PageHeader title="Keuangan" subtitle="Pencatatan pemasukan dan pengeluaran berdasarkan data nyata yang diinput."
        actions={<>
          <Button variant="outline" onClick={() => downloadFile("/reports/finance.xlsx", { date_from: p.date_from, date_to: p.date_to }).catch(() => toast.error("Gagal mengunduh laporan."))} data-testid="finance-export-button"><FileSpreadsheet className="mr-1 h-4 w-4" />Ekspor Excel</Button>
          <Button onClick={() => setDlg({})} data-testid="transaction-add-button"><Plus className="mr-1 h-4 w-4" />Catat Transaksi</Button>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input type="date" value={p.date_from} onChange={(e) => setP({ ...p, date_from: e.target.value })} data-testid="finance-filter-from" />
        <Input type="date" value={p.date_to} onChange={(e) => setP({ ...p, date_to: e.target.value })} data-testid="finance-filter-to" />
        <Select value={p.type} onChange={(e) => setP({ ...p, type: e.target.value })} data-testid="finance-filter-type"><option value="">Semua jenis</option><option value="pemasukan">Pemasukan</option><option value="pengeluaran">Pengeluaran</option></Select>
      </div>
      {sum && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Pemasukan" value={fmtIDR(sum.income)} icon={TrendingUp} accent="text-emerald-400" testId="finance-income" />
          <StatCard label="Pengeluaran" value={fmtIDR(sum.expense)} icon={TrendingDown} accent="text-red-400" testId="finance-expense" />
          <StatCard label="Selisih" value={fmtIDR(sum.net)} hint={`${sum.count} transaksi`} icon={Scale} testId="finance-net" />
        </div>
      )}
      {sum && sum.monthly.length > 0 && (
        <Card className="mt-4 h-72" data-testid="finance-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sum.monthly}>
              <CartesianGrid stroke="#1E293B" vertical={false} />
              <XAxis dataKey="month" stroke="#64748B" fontSize={12} />
              <YAxis stroke="#64748B" fontSize={11} tickFormatter={(v) => new Intl.NumberFormat("id-ID", { notation: "compact" }).format(v)} />
              <Tooltip formatter={(v) => fmtIDR(v)} contentStyle={{ background: "#0F172A", border: "1px solid #1E293B" }} />
              <Bar dataKey="pemasukan" fill="#10B981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="pengeluaran" fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
      <div className="mt-6">
        <Table head={["Tanggal", "Jenis", "Kategori", "Keterangan", "Mitra", "Nominal", ""]} testId="transactions-table"
          mobile={(tx || []).map((t) => (
            <MobileCard key={t.id} testId={`transaction-card-${t.id}`} title={t.description} subtitle={`${t.category} · ${t.created_by_name || ""}`}
              badge={<Badge value={t.type} />}
              rows={[["Tanggal", fmtDate(t.date)], ["Nominal", <span className={t.type === "pemasukan" ? "font-mono font-semibold text-emerald-300" : "font-mono font-semibold text-rose-300"}>{fmtIDR(t.amount)}</span>], t.partner_name && ["Mitra", t.partner_name]]}
              footer={<>
                <Button size="sm" variant="outline" onClick={() => setDlg(t)} data-testid={`transaction-card-edit-${t.id}`}><Pencil className="mr-1 h-4 w-4" />Ubah</Button>
                {can("director") && <Button size="sm" variant="ghost" onClick={() => setVoiding(t)} data-testid={`transaction-card-void-${t.id}`}><Ban className="mr-1 h-4 w-4" />Batalkan</Button>}
              </>} />
          ))}>
          {(tx || []).map((t) => (
            <tr key={t.id} className="hover:bg-white/5" data-testid={`transaction-row-${t.id}`}>
              <Td>{fmtDate(t.date)}</Td>
              <Td><Badge value={t.type} /></Td>
              <Td>{t.category}</Td>
              <Td>{t.description}<div className="text-xs text-muted-foreground">{t.created_by_name}</div></Td>
              <Td>{t.partner_name || "—"}</Td>
              <Td className="font-mono">{fmtIDR(t.amount)}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button size="icon" variant="ghost" onClick={() => setDlg(t)} data-testid={`transaction-edit-${t.id}`}><Pencil className="h-4 w-4" /></Button>
                {can("director") && <Button size="icon" variant="ghost" onClick={() => setVoiding(t)} title="Batalkan (Direktur)" data-testid={`transaction-void-${t.id}`}><Ban className="h-4 w-4" /></Button>}
              </Td>
            </tr>
          ))}
        </Table>
        {tx && tx.length === 0 && <Empty text="Belum ada transaksi pada periode ini." />}
      </div>
      {voiding && (
        <Dialog open onOpenChange={(o) => !o && setVoiding(null)}>
          <DialogContent data-testid="void-dialog">
            <DialogHeader><DialogTitle>Batalkan Transaksi</DialogTitle></DialogHeader>
            <p className="text-sm text-slate-300">{voiding.description} · {fmtIDR(voiding.amount)}</p>
            <Field label="Alasan pembatalan *" htmlFor="void-reason"><Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="void-reason-input" /></Field>
            <DialogFooter><Button variant="ghost" onClick={() => setVoiding(null)}>Batal</Button><Button variant="destructive" onClick={voidTx} data-testid="void-confirm-button">Batalkan Transaksi</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {dlg && <TxDialog initial={dlg.id ? dlg : null} settings={settings} partners={partners} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); refresh(); }} />}
    </div>
  );
}
