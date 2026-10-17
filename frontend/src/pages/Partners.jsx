import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Pencil } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fmtDate, fmtNum, fmtIDR } from "@/lib/api";
import { PageHeader, Field, Select, Table, Td, Badge, Empty, useFetch } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const TYPES = [["pelanggan", "Pelanggan"], ["pemasok", "Pemasok"], ["mitra", "Mitra"]];
const EMPTY = { name: "", types: ["pelanggan"], contact_person: "", phone: "", email: "", address: "", location: "", notes: "", is_active: true };

function PartnerDialog({ open, initial, onClose, onSaved }) {
  const [f, setF] = useState(initial || EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (t) => setF({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] });
  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Nama mitra minimal 2 karakter.");
    if (!f.types.length) return toast.error("Pilih minimal satu jenis hubungan.");
    setBusy(true);
    try {
      if (initial?.id) await api.put(`/partners/${initial.id}`, f);
      else await api.post("/partners", f);
      toast.success("Data mitra disimpan.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="partner-dialog">
        <DialogHeader><DialogTitle>{initial?.id ? "Ubah Mitra" : "Tambah Mitra"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama perusahaan / individu *" htmlFor="p-name" className="sm:col-span-2">
            <Input id="p-name" value={f.name} onChange={set("name")} data-testid="partner-name-input" />
          </Field>
          <Field label="Jenis hubungan *" className="sm:col-span-2">
            <div className="flex flex-wrap gap-4">
              {TYPES.map(([v, l]) => (
                <label key={v} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={f.types.includes(v)} onCheckedChange={() => toggle(v)} data-testid={`partner-type-${v}-checkbox`} />{l}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Kontak person" htmlFor="p-cp"><Input id="p-cp" value={f.contact_person || ""} onChange={set("contact_person")} data-testid="partner-contact-input" /></Field>
          <Field label="Telepon" htmlFor="p-phone"><Input id="p-phone" value={f.phone || ""} onChange={set("phone")} data-testid="partner-phone-input" /></Field>
          <Field label="Email" htmlFor="p-email"><Input id="p-email" value={f.email || ""} onChange={set("email")} data-testid="partner-email-input" /></Field>
          <Field label="Lokasi / Kota" htmlFor="p-loc"><Input id="p-loc" value={f.location || ""} onChange={set("location")} data-testid="partner-location-input" /></Field>
          <Field label="Alamat" htmlFor="p-addr" className="sm:col-span-2"><Input id="p-addr" value={f.address || ""} onChange={set("address")} data-testid="partner-address-input" /></Field>
          <Field label="Catatan hubungan bisnis" htmlFor="p-notes" className="sm:col-span-2"><Textarea id="p-notes" value={f.notes || ""} onChange={set("notes")} data-testid="partner-notes-input" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="partner-cancel-button">Batal</Button>
          <Button onClick={save} disabled={busy} data-testid="partner-save-button">Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartnerSheet({ id, onClose }) {
  const { data: p } = useFetch(id ? `/partners/${id}` : null);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-border bg-[#0F172A] sm:max-w-lg" data-testid="partner-detail-sheet">
        {p && (
          <>
            <SheetHeader><SheetTitle className="font-display text-xl">{p.name}</SheetTitle></SheetHeader>
            <div className="mt-2 flex gap-2">{p.types.map((t) => <Badge key={t} label={t} tone="cyan" />)}</div>
            <div className="mt-4 space-y-1 text-sm text-slate-300">
              <p>{p.contact_person || "—"} · {p.phone || "—"} · {p.email || "—"}</p>
              <p>{p.address || "—"} {p.location ? `(${p.location})` : ""}</p>
              {p.notes && <p className="text-muted-foreground">{p.notes}</p>}
            </div>
            <h3 className="mt-6 text-sm font-semibold">Penawaran terkait</h3>
            {p.quotations.length === 0 ? <Empty text="Belum ada." /> : p.quotations.map((q) => (
              <Link key={q.id} to={`/penawaran/${q.id}`} className="flex justify-between py-1.5 text-sm hover:text-cyan-300">
                <span>{q.number} · {fmtIDR(q.total)}</span><Badge value={q.effective_status} />
              </Link>
            ))}
            <h3 className="mt-6 text-sm font-semibold">Dokumen & kontrak terkait</h3>
            {p.documents.length === 0 ? <Empty text="Belum ada." /> : p.documents.map((d) => (
              <p key={d.id} className="flex justify-between py-1.5 text-sm"><span>{d.name}</span><span className="text-xs text-muted-foreground">{d.kind} · {fmtDate(d.expiry_date)}</span></p>
            ))}
            <h3 className="mt-6 text-sm font-semibold">Riwayat kegiatan kopra</h3>
            {p.kopra.length === 0 ? <Empty text="Belum ada." /> : p.kopra.map((k) => (
              <p key={k.id} className="flex justify-between py-1.5 text-sm"><span>{k.activity_type} · {fmtNum(k.quantity)} {k.unit}</span><span className="text-xs text-muted-foreground">{fmtDate(k.date)}</span></p>
            ))}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Partners() {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const { data, reload } = useFetch(`/partners?q=${encodeURIComponent(q)}&type=${type}`);
  const [dlg, setDlg] = useState(null);
  const [detail, setDetail] = useState(null);
  return (
    <div data-testid="partners-page">
      <PageHeader title="Pelanggan, Pemasok & Mitra" subtitle="Satu database mitra bisnis perusahaan."
        actions={<Button onClick={() => setDlg({})} data-testid="partner-add-button"><Plus className="mr-1 h-4 w-4" />Tambah Mitra</Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Cari nama, kontak, lokasi, telepon…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="partner-search-input" />
        </div>
        <Select className="sm:w-48" value={type} onChange={(e) => setType(e.target.value)} data-testid="partner-type-filter">
          <option value="">Semua jenis</option>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </div>
      <Table head={["Nama", "Jenis", "Kontak", "Lokasi", ""]} testId="partners-table">
        {(data || []).map((p) => (
          <tr key={p.id} className="cursor-pointer hover:bg-white/5" onClick={() => setDetail(p.id)} data-testid={`partner-row-${p.id}`}>
            <Td className="font-medium">{p.name}</Td>
            <Td><div className="flex flex-wrap gap-1">{p.types.map((t) => <Badge key={t} label={t} tone="cyan" />)}</div></Td>
            <Td className="text-slate-300">{p.contact_person || "—"}<div className="text-xs text-muted-foreground">{p.phone}</div></Td>
            <Td className="text-slate-300">{p.location || "—"}</Td>
            <Td className="text-right">
              <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setDlg(p); }} data-testid={`partner-edit-${p.id}`}><Pencil className="h-4 w-4" /></Button>
            </Td>
          </tr>
        ))}
      </Table>
      {data && data.length === 0 && <Empty text="Belum ada mitra. Tambahkan mitra pertama Anda." />}
      {dlg && <PartnerDialog open initial={dlg.id ? dlg : null} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); reload(); }} />}
      <PartnerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
