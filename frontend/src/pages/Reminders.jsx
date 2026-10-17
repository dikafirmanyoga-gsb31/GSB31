import { useState } from "react";
import { Plus, CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fmtDate, fmtDateTime, todayISO } from "@/lib/api";
import { PageHeader, Field, Select, Table, Td, Badge, Empty, useFetch, useSettings } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const SRC = { dokumen: "Dokumen", kontrak: "Kontrak", penawaran: "Penawaran", tugas: "Tugas" };

function TaskDialog({ onClose, onSaved }) {
  const [f, setF] = useState({ title: "", due_date: todayISO(), notes: "" });
  const save = async () => {
    if (f.title.trim().length < 2) return toast.error("Judul tugas wajib diisi.");
    try {
      await api.post("/reminders", f);
      toast.success("Tugas ditambahkan.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="task-dialog">
        <DialogHeader><DialogTitle>Tambah Tugas / Kewajiban</DialogTitle></DialogHeader>
        <Field label="Judul *" htmlFor="t-title"><Input id="t-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="task-title-input" /></Field>
        <Field label="Jatuh tempo *" htmlFor="t-due"><Input id="t-due" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} data-testid="task-due-input" /></Field>
        <Field label="Catatan" htmlFor="t-notes"><Textarea id="t-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="task-notes-input" /></Field>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={save} data-testid="task-save-button">Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DoneDialog({ r, onClose, onSaved }) {
  const [note, setNote] = useState("");
  const save = async () => {
    try {
      await api.patch(`/reminders/${r.id}`, { status: "done", follow_up_note: note || null });
      toast.success("Pengingat ditandai sudah ditindaklanjuti.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="reminder-done-dialog">
        <DialogHeader><DialogTitle>Tindak Lanjut</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-300">{r.title}</p>
        <Field label="Catatan tindak lanjut" htmlFor="r-note"><Textarea id="r-note" value={note} onChange={(e) => setNote(e.target.value)} data-testid="reminder-followup-input" /></Field>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={save} data-testid="reminder-done-save-button">Tandai Selesai</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Reminders() {
  const settings = useSettings();
  const [status, setStatus] = useState("open");
  const { data, reload } = useFetch(`/reminders?status=${status}`);
  const [task, setTask] = useState(false);
  const [done, setDone] = useState(null);
  const reopen = async (r) => {
    await api.patch(`/reminders/${r.id}`, { status: "open" });
    reload();
  };
  return (
    <div data-testid="reminders-page">
      <PageHeader title="Pengingat" subtitle={`Otomatis dari tanggal dokumen, kontrak, dan penawaran · periode H-${(settings?.reminder_windows || []).join(", H-")} · zona waktu Asia/Jakarta`}
        actions={<Button onClick={() => setTask(true)} data-testid="task-add-button"><Plus className="mr-1 h-4 w-4" />Tambah Tugas</Button>} />
      <div className="mb-4 flex gap-2">
        <Select className="sm:w-64" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="reminder-status-filter">
          <option value="open">Belum ditindaklanjuti</option>
          <option value="done">Sudah ditindaklanjuti</option>
          <option value="all">Semua</option>
        </Select>
      </div>
      <Table head={["Pengingat", "Sumber", "Jatuh tempo", "Tingkat", "Status", ""]} testId="reminders-table">
        {(data || []).map((r) => (
          <tr key={r.id} className="hover:bg-white/5" data-testid={`reminder-row-${r.id}`}>
            <Td className="font-medium">{r.title}{r.notes && <div className="text-xs text-muted-foreground">{r.notes}</div>}{r.follow_up_note && <div className="text-xs text-emerald-300">↳ {r.follow_up_note}</div>}</Td>
            <Td>{SRC[r.source_type]}</Td>
            <Td>{fmtDate(r.due_date)}<div className="text-xs text-muted-foreground">{r.days_left < 0 ? `${-r.days_left} hari lalu` : `${r.days_left} hari lagi`}</div></Td>
            <Td><Badge value={r.level} /></Td>
            <Td><Badge value={r.status} />{r.done_by_name && <div className="mt-1 text-xs text-muted-foreground">{r.done_by_name} · {fmtDateTime(r.done_at)}</div>}</Td>
            <Td className="text-right">
              {r.status === "open" ? (
                <Button size="sm" variant="outline" onClick={() => setDone(r)} data-testid={`reminder-done-${r.id}`}><CheckCircle2 className="mr-1 h-4 w-4" />Tindak lanjut</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => reopen(r)} data-testid={`reminder-reopen-${r.id}`}><RotateCcw className="mr-1 h-4 w-4" />Buka lagi</Button>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      {data && data.length === 0 && <Empty text="Tidak ada pengingat." />}
      <p className="mt-3 text-xs text-muted-foreground">Notifikasi saat ini hanya di dalam aplikasi. Email/WhatsApp belum dikonfigurasi.</p>
      {task && <TaskDialog onClose={() => setTask(false)} onSaved={() => { setTask(false); reload(); }} />}
      {done && <DoneDialog r={done} onClose={() => setDone(null)} onSaved={() => { setDone(null); reload(); }} />}
    </div>
  );
}
