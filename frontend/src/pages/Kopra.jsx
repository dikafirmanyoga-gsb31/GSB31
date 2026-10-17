import { useState } from "react";
import { Plus, Pencil, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, fmtDate, fmtNum, fmtIDR, todayISO, downloadFile } from "@/lib/api";
import { PageHeader, Field, Select, Table, Td, Badge, Empty, useFetch, useSettings, usePartners } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const STATUSES = ["rencana", "berjalan", "selesai", "dibatalkan"];

function KopraDialog({ initial, settings, partners, onClose, onSaved }) {
  const { can } = useAuth();
  const [f, setF] = useState({
    activity_type: settings.kopra_activity_types[0], date: todayISO(), partner_id: "", location: "", quantity: "",
    unit: settings.kopra_units[0], status: "rencana", reference_no: "", notes: "", price_per_unit: "", ...initial,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const qty = parseFloat(f.quantity);
    if (!(qty > 0)) return toast.error("Kuantitas harus lebih dari 0.");
    const body = { ...f, quantity: qty, partner_id: f.partner_id || null };
    if (can("finance")) body.price_per_unit = f.price_per_unit === "" || f.price_per_unit === null ? null : parseFloat(f.price_per_unit);
    else delete body.price_per_unit;
    ["id", "created_at", "created_by", "updated_at", "partner_name", "total_value"].forEach((k) => delete body[k]);
    try {
      if (initial?.id) await api.put(`/kopra/${initial.id}`, body);
      else await api.post("/kopra", body);
      toast.success("Kegiatan kopra disimpan.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="kopra-dialog">
        <DialogHeader><DialogTitle>{initial?.id ? "Ubah Kegiatan Kopra" : "Catat Kegiatan Kopra"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jenis kegiatan *"><Select value={f.activity_type} onChange={set("activity_type")} data-testid="kopra-type-select">{settings.kopra_activity_types.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Tanggal *" htmlFor="k-date"><Input id="k-date" type="date" value={f.date} onChange={set("date")} data-testid="kopra-date-input" /></Field>
          <Field label="Mitra (pelanggan/pemasok)" className="sm:col-span-2">
            <Select value={f.partner_id || ""} onChange={set("partner_id")} data-testid="kopra-partner-select">
              <option value="">— Tanpa mitra —</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Kuantitas *" htmlFor="k-qty"><Input id="k-qty" type="number" min="0" step="any" value={f.quantity} onChange={set("quantity")} data-testid="kopra-quantity-input" /></Field>
          <Field label="Satuan *"><Select value={f.unit} onChange={set("unit")} data-testid="kopra-unit-select">{settings.kopra_units.map((u) => <option key={u}>{u}</option>)}</Select></Field>
          <Field label="Lokasi kegiatan" htmlFor="k-loc"><Input id="k-loc" value={f.location || ""} onChange={set("location")} data-testid="kopra-location-input" /></Field>
          <Field label="Status"><Select value={f.status} onChange={set("status")} data-testid="kopra-status-select">{STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</Select></Field>
          <Field label="No. referensi" htmlFor="k-ref"><Input id="k-ref" value={f.reference_no || ""} onChange={set("reference_no")} data-testid="kopra-reference-input" /></Field>
          {can("finance") && (
            <Field label="Harga per satuan (Rp)" htmlFor="k-price" hint="Hanya terlihat oleh peran keuangan.">
              <Input id="k-price" type="number" min="0" step="any" value={f.price_per_unit ?? ""} onChange={set("price_per_unit")} data-testid="kopra-price-input" />
            </Field>
          )}
          <Field label="Catatan" htmlFor="k-notes" className="sm:col-span-2"><Textarea id="k-notes" value={f.notes || ""} onChange={set("notes")} data-testid="kopra-notes-input" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="kopra-cancel-button">Batal</Button>
          <Button onClick={save} data-testid="kopra-save-button">Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Kopra() {
  const { can } = useAuth();
  const settings = useSettings();
  const partners = usePartners();
  const [flt, setFlt] = useState({ activity_type: "", status: "", date_from: "", date_to: "" });
  const qs = new URLSearchParams(flt).toString();
  const { data, reload } = useFetch(`/kopra?${qs}`);
  const [dlg, setDlg] = useState(null);
  const set = (k) => (e) => setFlt({ ...flt, [k]: e.target.value });
  const fin = can("finance");
  if (!settings) return null;
  return (
    <div data-testid="kopra-page">
      <PageHeader title="Usaha Kopra" subtitle="Catatan kegiatan usaha kopra: pembelian, penjualan, pengiriman, dan lainnya."
        actions={<>
          <Button variant="outline" onClick={() => downloadFile("/reports/kopra.xlsx", { date_from: flt.date_from, date_to: flt.date_to }).catch(() => toast.error("Gagal mengunduh laporan."))} data-testid="kopra-export-button"><FileSpreadsheet className="mr-1 h-4 w-4" />Ekspor Excel</Button>
          <Button onClick={() => setDlg({})} data-testid="kopra-add-button"><Plus className="mr-1 h-4 w-4" />Catat Kegiatan</Button>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Select value={flt.activity_type} onChange={set("activity_type")} data-testid="kopra-filter-type"><option value="">Semua jenis</option>{settings.kopra_activity_types.map((t) => <option key={t}>{t}</option>)}</Select>
        <Select value={flt.status} onChange={set("status")} data-testid="kopra-filter-status"><option value="">Semua status</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Input type="date" value={flt.date_from} onChange={set("date_from")} data-testid="kopra-filter-from" />
        <Input type="date" value={flt.date_to} onChange={set("date_to")} data-testid="kopra-filter-to" />
      </div>
      <Table head={["Tanggal", "Jenis", "Mitra", "Kuantitas", "Lokasi", ...(fin ? ["Nilai"] : []), "Status", ""]} testId="kopra-table">
        {(data || []).map((k) => (
          <tr key={k.id} className="hover:bg-white/5" data-testid={`kopra-row-${k.id}`}>
            <Td>{fmtDate(k.date)}</Td>
            <Td className="font-medium">{k.activity_type}</Td>
            <Td>{k.partner_name || "—"}</Td>
            <Td className="font-mono">{fmtNum(k.quantity)} {k.unit}</Td>
            <Td>{k.location || "—"}</Td>
            {fin && <Td className="font-mono">{fmtIDR(k.total_value)}</Td>}
            <Td><Badge value={k.status} /></Td>
            <Td className="text-right"><Button size="icon" variant="ghost" onClick={() => setDlg(k)} data-testid={`kopra-edit-${k.id}`}><Pencil className="h-4 w-4" /></Button></Td>
          </tr>
        ))}
      </Table>
      {data && data.length === 0 && <Empty text="Belum ada kegiatan kopra." />}
      {dlg && <KopraDialog initial={dlg.id ? dlg : null} settings={settings} partners={partners} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); reload(); }} />}
    </div>
  );
}
