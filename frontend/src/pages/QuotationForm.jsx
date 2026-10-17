import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fmtIDR, todayISO } from "@/lib/api";
import { PageHeader, Card, Field, Select, usePartners } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const ITEM = { description: "", quantity: "", unit: "kg", unit_price: "" };
const addDays = (n) => {
  const d = new Date(`${todayISO()}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};

const ItemsEditor = ({ items, setItems }) => {
  const upd = (i, k, v) => setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  return (
    <div className="space-y-2" data-testid="quotation-items">
      <div className="hidden grid-cols-12 gap-2 text-xs text-muted-foreground sm:grid">
        <span className="col-span-5">Uraian barang/jasa</span><span className="col-span-2">Kuantitas</span><span className="col-span-1">Satuan</span><span className="col-span-2">Harga satuan</span><span className="col-span-2 text-right">Jumlah</span>
      </div>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2 sm:grid-cols-12 sm:border-0 sm:p-0">
          <Input className="col-span-2 sm:col-span-5" placeholder="Uraian" value={it.description} onChange={(e) => upd(i, "description", e.target.value)} data-testid={`quotation-item-description-${i}`} />
          <Input className="sm:col-span-2" type="number" min="0" step="any" placeholder="Qty" value={it.quantity} onChange={(e) => upd(i, "quantity", e.target.value)} data-testid={`quotation-item-quantity-${i}`} />
          <Input className="sm:col-span-1" placeholder="Satuan" value={it.unit} onChange={(e) => upd(i, "unit", e.target.value)} data-testid={`quotation-item-unit-${i}`} />
          <Input className="sm:col-span-2" type="number" min="0" step="any" placeholder="Harga" value={it.unit_price} onChange={(e) => upd(i, "unit_price", e.target.value)} data-testid={`quotation-item-price-${i}`} />
          <div className="flex items-center justify-end gap-1 sm:col-span-2">
            <span className="font-mono text-sm">{fmtIDR((parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0))}</span>
            <Button size="icon" variant="ghost" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} data-testid={`quotation-item-remove-${i}`}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => setItems([...items, { ...ITEM }])} data-testid="quotation-add-item-button"><Plus className="mr-1 h-4 w-4" />Tambah baris</Button>
    </div>
  );
};

export default function QuotationForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const partners = usePartners().filter((p) => p.types.includes("pelanggan") || p.types.includes("mitra"));
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id) {
      api.get(`/quotations/${id}`).then(({ data }) => setF({ ...data, items: data.items.map(({ amount, ...r }) => r) }));
    } else {
      api.get("/quotations/next-number").then(({ data }) =>
        setF({ number: data.number, date: todayISO(), valid_until: addDays(14), partner_id: "", subject: "Penawaran Harga Kopra", items: [{ ...ITEM }], tax_percent: 0, terms: "", notes: "" })
      );
    }
  }, [id]);
  if (!f) return null;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const subtotal = f.items.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0);
  const tax = (subtotal * (parseFloat(f.tax_percent) || 0)) / 100;

  const save = async () => {
    if (!f.partner_id) return toast.error("Pilih pelanggan terlebih dahulu.");
    if (f.items.some((it) => !it.description.trim() || !(parseFloat(it.quantity) > 0) || it.unit_price === "")) return toast.error("Lengkapi uraian, kuantitas (>0), dan harga setiap baris.");
    const body = {
      number: f.number, date: f.date, valid_until: f.valid_until, partner_id: f.partner_id, subject: f.subject, terms: f.terms, notes: f.notes,
      tax_percent: parseFloat(f.tax_percent) || 0,
      items: f.items.map((it) => ({ description: it.description, unit: it.unit, quantity: parseFloat(it.quantity), unit_price: parseFloat(it.unit_price) })),
    };
    setBusy(true);
    try {
      const { data } = id ? await api.put(`/quotations/${id}`, body) : await api.post("/quotations", body);
      toast.success("Draf penawaran disimpan.");
      navigate(`/penawaran/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl" data-testid="quotation-form-page">
      <PageHeader title={id ? "Edit Draf Penawaran" : "Buat Penawaran Baru"} subtitle="Total dihitung ulang dan divalidasi oleh server saat disimpan." />
      <Card className="grid gap-4 sm:grid-cols-3">
        <Field label="Nomor penawaran *" htmlFor="q-num"><Input id="q-num" value={f.number} onChange={set("number")} data-testid="quotation-number-input" /></Field>
        <Field label="Tanggal *" htmlFor="q-date"><Input id="q-date" type="date" value={f.date} onChange={set("date")} data-testid="quotation-date-input" /></Field>
        <Field label="Berlaku sampai *" htmlFor="q-valid"><Input id="q-valid" type="date" value={f.valid_until} onChange={set("valid_until")} data-testid="quotation-valid-until-input" /></Field>
        <Field label="Pelanggan *" className="sm:col-span-2">
          <Select value={f.partner_id} onChange={set("partner_id")} data-testid="quotation-partner-select">
            <option value="">— Pilih pelanggan —</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Perihal" htmlFor="q-subj"><Input id="q-subj" value={f.subject || ""} onChange={set("subject")} data-testid="quotation-subject-input" /></Field>
      </Card>
      <Card className="mt-4">
        <h2 className="mb-3 font-display font-semibold">Rincian Barang / Jasa</h2>
        <ItemsEditor items={f.items} setItems={(items) => setF({ ...f, items })} />
        <div className="ml-auto mt-5 max-w-xs space-y-2 text-sm">
          <p className="flex justify-between"><span>Subtotal</span><span className="font-mono" data-testid="quotation-subtotal">{fmtIDR(subtotal)}</span></p>
          <div className="flex items-center justify-between gap-2"><span>PPN (%)</span><Input className="h-8 w-24 text-right" type="number" min="0" max="100" value={f.tax_percent} onChange={set("tax_percent")} data-testid="quotation-tax-input" /></div>
          <p className="flex justify-between"><span>Pajak</span><span className="font-mono">{fmtIDR(tax)}</span></p>
          <p className="flex justify-between border-t border-border pt-2 text-base font-semibold"><span>Total</span><span className="font-mono text-cyan-300" data-testid="quotation-total">{fmtIDR(subtotal + tax)}</span></p>
        </div>
      </Card>
      <Card className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Syarat & ketentuan" htmlFor="q-terms"><Textarea id="q-terms" rows={5} value={f.terms || ""} onChange={set("terms")} data-testid="quotation-terms-input" /></Field>
        <Field label="Catatan internal" htmlFor="q-notes"><Textarea id="q-notes" rows={5} value={f.notes || ""} onChange={set("notes")} data-testid="quotation-notes-input" /></Field>
      </Card>
      <div className="mt-4 flex gap-2">
        <Button onClick={save} disabled={busy} data-testid="quotation-save-button">Simpan Draf</Button>
        <Button variant="ghost" onClick={() => navigate(-1)} data-testid="quotation-cancel-button">Batal</Button>
      </div>
    </div>
  );
}
