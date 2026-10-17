import { useState, useRef } from "react";
import { Plus, Search, Pencil, Upload, FileDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fmtDate, todayISO } from "@/lib/api";
import { PageHeader, Field, Select, Table, Td, Badge, Empty, useFetch, useSettings, usePartners } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const STATES = [["berlaku", "Berlaku"], ["segera", "Segera Berakhir"], ["kedaluwarsa", "Kedaluwarsa"], ["tanpa_batas", "Tanpa Batas"], ["arsip", "Arsip"]];

function DocDialog({ initial, kind, settings, partners, onClose, onSaved }) {
  const { data: quotes } = useFetch("/quotations");
  const [f, setF] = useState({
    kind, name: "", number: "", category: kind === "kontrak" ? "Kontrak" : settings.document_categories[0], issue_date: todayISO(), expiry_date: "",
    partner_id: "", quotation_id: "", status: "aktif", storage_location: "", notes: "", ...initial,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isK = f.kind === "kontrak";
  const save = async () => {
    if (f.name.trim().length < 2) return toast.error("Nama dokumen wajib diisi.");
    const body = {};
    ["kind", "name", "number", "category", "issue_date", "expiry_date", "partner_id", "quotation_id", "status", "storage_location", "notes"].forEach((k) => { body[k] = f[k] === "" ? null : f[k]; });
    try {
      if (initial?.id) await api.put(`/documents/${initial.id}`, body);
      else await api.post("/documents", body);
      toast.success("Data tersimpan.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="document-dialog">
        <DialogHeader><DialogTitle>{initial?.id ? "Perbarui Metadata" : isK ? "Tambah Kontrak" : "Tambah Dokumen"}</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jenis"><Select value={f.kind} onChange={set("kind")} data-testid="document-kind-select"><option value="dokumen">Dokumen</option><option value="kontrak">Kontrak / Perjanjian</option></Select></Field>
          <Field label="Kategori"><Select value={f.category} onChange={set("category")} data-testid="document-category-select">{settings.document_categories.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Nama *" htmlFor="d-name" className="sm:col-span-2"><Input id="d-name" value={f.name} onChange={set("name")} data-testid="document-name-input" /></Field>
          <Field label="Nomor" htmlFor="d-num"><Input id="d-num" value={f.number || ""} onChange={set("number")} data-testid="document-number-input" /></Field>
          <Field label="Status"><Select value={f.status} onChange={set("status")} data-testid="document-status-select"><option value="aktif">Aktif</option><option value="arsip">Arsip</option></Select></Field>
          <Field label={isK ? "Tanggal mulai" : "Tanggal terbit"} htmlFor="d-issue"><Input id="d-issue" type="date" value={f.issue_date || ""} onChange={set("issue_date")} data-testid="document-issue-date-input" /></Field>
          <Field label={isK ? "Tanggal berakhir" : "Tanggal kedaluwarsa"} htmlFor="d-exp" hint="Kosongkan jika tidak ada batas."><Input id="d-exp" type="date" value={f.expiry_date || ""} onChange={set("expiry_date")} data-testid="document-expiry-date-input" /></Field>
          <Field label="Pihak terkait (mitra)"><Select value={f.partner_id || ""} onChange={set("partner_id")} data-testid="document-partner-select"><option value="">— Tidak ada —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Penawaran terkait"><Select value={f.quotation_id || ""} onChange={set("quotation_id")} data-testid="document-quotation-select"><option value="">— Tidak ada —</option>{(quotes || []).map((q) => <option key={q.id} value={q.id}>{q.number}</option>)}</Select></Field>
          <Field label="Lokasi penyimpanan fisik" htmlFor="d-loc" className="sm:col-span-2"><Input id="d-loc" value={f.storage_location || ""} onChange={set("storage_location")} placeholder="mis. Lemari arsip A, map 3" data-testid="document-storage-input" /></Field>
          <Field label="Catatan" htmlFor="d-notes" className="sm:col-span-2"><Textarea id="d-notes" value={f.notes || ""} onChange={set("notes")} data-testid="document-notes-input" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} data-testid="document-cancel-button">Batal</Button>
          <Button onClick={save} data-testid="document-save-button">Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocSheet({ id, onClose, onChanged }) {
  const { data: d, reload } = useFetch(id ? `/documents/${id}` : null);
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast.error("Ukuran file maksimal 10 MB.");
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      await api.post(`/documents/${id}/files`, fd);
      toast.success("File diunggah.");
      reload();
      onChanged();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  const open = async (f) => {
    try {
      const { data } = await api.get(`/files/${f.id}`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      toast.error("Gagal membuka file.");
    }
  };
  const remove = async (f) => {
    if (!window.confirm(`Hapus file ${f.original_filename}?`)) return;
    await api.delete(`/files/${f.id}`);
    reload();
    onChanged();
  };
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-border bg-[#0F172A] sm:max-w-lg" data-testid="document-detail-sheet">
        {d && (
          <>
            <SheetHeader><SheetTitle className="font-display text-xl">{d.name}</SheetTitle></SheetHeader>
            <div className="mt-2 flex gap-2"><Badge value={d.validity} /><Badge label={d.kind === "kontrak" ? "Kontrak" : "Dokumen"} tone="cyan" /></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Nomor</dt><dd>{d.number || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Kategori</dt><dd>{d.category}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Terbit / mulai</dt><dd>{fmtDate(d.issue_date)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Kedaluwarsa / berakhir</dt><dd>{fmtDate(d.expiry_date)}{d.days_left !== null && <span className="text-xs text-muted-foreground"> ({d.days_left} hari)</span>}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Pihak terkait</dt><dd>{d.partner_name || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Penawaran terkait</dt><dd>{d.quotation_number || "—"}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted-foreground">Lokasi penyimpanan</dt><dd>{d.storage_location || "—"}</dd></div>
              {d.notes && <div className="col-span-2"><dt className="text-xs text-muted-foreground">Catatan</dt><dd>{d.notes}</dd></div>}
            </dl>
            <div className="mt-6 flex items-center justify-between">
              <h3 className="text-sm font-semibold">File ({d.files.length})</h3>
              <input ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={upload} data-testid="document-file-input" />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current.click()} data-testid="document-upload-button"><Upload className="mr-1 h-4 w-4" />{busy ? "Mengunggah…" : "Unggah File"}</Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">PDF/JPG/PNG/WEBP, maks. 10 MB. File disimpan terlindungi dan hanya bisa dibuka setelah login.</p>
            <ul className="mt-3 divide-y divide-border">
              {d.files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm" data-testid={`document-file-${f.id}`}>
                  <span className="min-w-0 truncate">{f.original_filename}<span className="block text-xs text-muted-foreground">{f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(0)} KB`} · {f.uploaded_by_name}</span></span>
                  <span className="flex shrink-0">
                    <Button size="icon" variant="ghost" onClick={() => open(f)} data-testid={`document-file-open-${f.id}`}><FileDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(f)} data-testid={`document-file-delete-${f.id}`}><Trash2 className="h-4 w-4" /></Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Documents() {
  const settings = useSettings();
  const partners = usePartners();
  const [kind, setKind] = useState("");
  const [flt, setFlt] = useState({ q: "", category: "", state: "" });
  const qs = new URLSearchParams({ ...flt, kind }).toString();
  const { data, reload } = useFetch(`/documents?${qs}`);
  const [dlg, setDlg] = useState(null);
  const [detail, setDetail] = useState(null);
  const set = (k) => (e) => setFlt({ ...flt, [k]: e.target.value });
  if (!settings) return null;
  return (
    <div data-testid="documents-page">
      <PageHeader title="Dokumen & Kontrak" subtitle="Pusat dokumen perusahaan, kontrak, dan perjanjian beserta masa berlakunya."
        actions={<Button onClick={() => setDlg({})} data-testid="document-add-button"><Plus className="mr-1 h-4 w-4" />Tambah</Button>} />
      <Tabs value={kind || "all"} onValueChange={(v) => setKind(v === "all" ? "" : v)} className="mb-4">
        <TabsList>
          <TabsTrigger value="all" data-testid="documents-tab-all">Semua</TabsTrigger>
          <TabsTrigger value="dokumen" data-testid="documents-tab-dokumen">Dokumen</TabsTrigger>
          <TabsTrigger value="kontrak" data-testid="documents-tab-kontrak">Kontrak</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Cari nama/nomor…" value={flt.q} onChange={set("q")} data-testid="document-search-input" />
        </div>
        <Select value={flt.category} onChange={set("category")} data-testid="document-category-filter"><option value="">Semua kategori</option>{settings.document_categories.map((c) => <option key={c}>{c}</option>)}</Select>
        <Select value={flt.state} onChange={set("state")} data-testid="document-state-filter"><option value="">Semua status</option>{STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </div>
      <Table head={["Nama", "Jenis / Kategori", "Pihak", "Kedaluwarsa", "File", "Status", ""]} testId="documents-table">
        {(data || []).map((d) => (
          <tr key={d.id} className="cursor-pointer hover:bg-white/5" onClick={() => setDetail(d.id)} data-testid={`document-row-${d.id}`}>
            <Td className="font-medium">{d.name}<div className="font-mono text-xs text-muted-foreground">{d.number}</div></Td>
            <Td>{d.kind === "kontrak" ? "Kontrak" : "Dokumen"}<div className="text-xs text-muted-foreground">{d.category}</div></Td>
            <Td>{d.partner_name || "—"}</Td>
            <Td>{fmtDate(d.expiry_date)}{d.days_left !== null && <div className="text-xs text-muted-foreground">{d.days_left < 0 ? `${-d.days_left} hari lalu` : `${d.days_left} hari lagi`}</div>}</Td>
            <Td className="font-mono">{d.file_count}</Td>
            <Td><Badge value={d.validity} /></Td>
            <Td className="text-right"><Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setDlg(d); }} data-testid={`document-edit-${d.id}`}><Pencil className="h-4 w-4" /></Button></Td>
          </tr>
        ))}
      </Table>
      {data && data.length === 0 && <Empty text="Belum ada dokumen." />}
      {dlg && <DocDialog initial={dlg.id ? dlg : null} kind={dlg.kind || kind || "dokumen"} settings={settings} partners={partners} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); reload(); }} />}
      <DocSheet id={detail} onClose={() => setDetail(null)} onChanged={reload} />
    </div>
  );
}
