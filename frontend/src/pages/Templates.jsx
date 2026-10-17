import { useRef, useState } from "react";
import { Upload, Download, Archive, ArchiveRestore, Search, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, fmtDate, downloadFile } from "@/lib/api";
import { PageHeader, Card, Field, Select, Badge, Empty, useFetch } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

function UploadDialog({ categories, onClose, onSaved }) {
  const [f, setF] = useState({ name: "", category: categories[0], notes: "" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const save = async () => {
    if (!file) return toast.error("Pilih file template.");
    if (f.name.trim().length < 2) return toast.error("Nama template wajib diisi.");
    if (file.size > 15 * 1024 * 1024) return toast.error("Ukuran file maksimal 15 MB.");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", f.name);
    fd.append("category", f.category);
    if (f.notes) fd.append("notes", f.notes);
    setBusy(true);
    try {
      await api.post("/templates", fd);
      toast.success("Template diunggah.");
      onSaved();
    } catch (e) {
      if (e?.response?.status !== 403) toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="template-upload-dialog">
        <DialogHeader><DialogTitle>Unggah Template Resmi</DialogTitle></DialogHeader>
        <Field label="Nama template *" htmlFor="tp-name"><Input id="tp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. Kop Surat Resmi 2026" data-testid="template-name-input" /></Field>
        <Field label="Kategori"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} data-testid="template-category-select">{categories.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Catatan" htmlFor="tp-notes"><Textarea id="tp-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="template-notes-input" /></Field>
        <input ref={ref} type="file" accept=".docx,.doc,.pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; setFile(x || null); if (x && !f.name) setF({ ...f, name: x.name.replace(/\.[^.]+$/, "") }); }} data-testid="template-file-input" />
        <Button variant="outline" onClick={() => ref.current.click()} data-testid="template-choose-file-button"><Upload className="mr-1 h-4 w-4" />{file ? file.name : "Pilih file (DOCX, DOC, PDF, JPG, PNG · maks. 15 MB)"}</Button>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={save} disabled={busy} data-testid="template-save-button">{busy ? "Mengunggah…" : "Unggah"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TemplateCard = ({ t, isDirector, onArchive }) => (
  <Card className="flex flex-col gap-3" data-testid={`template-card-${t.id}`}>
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10"><FileText className="h-5 w-5 text-cyan-300" /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{t.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{t.original_filename} · {size(t.size)}</p>
      </div>
      {t.is_archived && <Badge value="arsip" />}
    </div>
    {t.notes && <p className="text-sm text-slate-300">{t.notes}</p>}
    <p className="text-xs text-muted-foreground">Diunggah {t.uploaded_by_name} · {fmtDate(t.created_at)}</p>
    <div className="mt-auto flex gap-2">
      <Button size="sm" onClick={() => downloadFile(`/templates/${t.id}/file`).catch(() => toast.error("Gagal mengunduh file."))} data-testid={`template-download-${t.id}`}><Download className="mr-1 h-4 w-4" />Unduh</Button>
      {isDirector && (
        <Button size="sm" variant="ghost" onClick={() => onArchive(t)} data-testid={`template-archive-${t.id}`}>
          {t.is_archived ? <><ArchiveRestore className="mr-1 h-4 w-4" />Pulihkan</> : <><Archive className="mr-1 h-4 w-4" />Arsipkan</>}
        </Button>
      )}
    </div>
  </Card>
);

export default function Templates() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [archived, setArchived] = useState(false);
  const { data, reload } = useFetch(`/templates?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&include_archived=${archived}`);
  const [dlg, setDlg] = useState(false);
  const isDirector = can("director");
  const openUpload = () => {
    if (!isDirector) { api.post("/access/check", { feature: "director" }).catch(() => {}); return; }
    setDlg(true);
  };
  const archive = async (t) => {
    try {
      await api.post(`/templates/${t.id}/archive`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const cats = data?.categories || [];
  const grouped = cats.map((c) => [c, (data?.items || []).filter((t) => t.category === c)]).filter(([, l]) => l.length);
  return (
    <div data-testid="templates-page">
      <PageHeader title="Template Dokumen" subtitle="Draf resmi perusahaan (kop surat, penawaran, kontrak kerja sama, kontrak tripartit) sebagai acuan dasar. Diunggah oleh Direktur."
        actions={<Button onClick={openUpload} data-testid="template-upload-button"><Upload className="mr-1 h-4 w-4" />Unggah Template</Button>} />
      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Cari template…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="template-search-input" />
        </div>
        <Select className="sm:w-56" value={category} onChange={(e) => setCategory(e.target.value)} data-testid="template-category-filter"><option value="">Semua kategori</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
        {isDirector && <Button variant="outline" onClick={() => setArchived(!archived)} data-testid="template-show-archived-button">{archived ? "Sembunyikan arsip" : "Tampilkan arsip"}</Button>}
      </div>
      {data && grouped.length === 0 && <Empty text="Belum ada template. Direktur dapat mengunggah draf resmi perusahaan di sini." testId="templates-empty" />}
      {grouped.map(([c, list]) => (
        <section key={c} className="mb-6">
          <h2 className="mb-3 font-display text-base font-semibold text-cyan-200">{c}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {list.map((t) => <TemplateCard key={t.id} t={t} isDirector={isDirector} onArchive={archive} />)}
          </div>
        </section>
      ))}
      {dlg && <UploadDialog categories={cats} onClose={() => setDlg(false)} onSaved={() => { setDlg(false); reload(); }} />}
    </div>
  );
}
