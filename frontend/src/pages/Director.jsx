import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, KeyRound, Power, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg, fmtDateTime, fmtIDR, fmtNum } from "@/lib/api";
import { PageHeader, Card, StatCard, Field, Select, Table, Td, Badge, Empty, useFetch } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const ROLE_OPTS = [["opfin", "Operasional + Keuangan (Role B)"], ["ops", "Operasional (Role C)"]];

function Summary() {
  const { data: s } = useFetch("/director/summary");
  if (!s) return null;
  return (
    <div className="space-y-4" data-testid="director-summary">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Pemasukan ${s.year}`} value={fmtIDR(s.finance_year.income)} testId="director-income-year" />
        <StatCard label={`Pengeluaran ${s.year}`} value={fmtIDR(s.finance_year.expense)} testId="director-expense-year" />
        <StatCard label={`Selisih ${s.year}`} value={fmtIDR(s.finance_year.net)} hint={`Bulan ini: ${fmtIDR(s.finance_month.net)}`} testId="director-net-year" />
        <StatCard label="Akun pengguna" value={`${s.users.total} / ${s.users.max_total}`} hint={`Role C: ${s.users.by_role.ops} / ${s.users.max_ops}`} testId="director-users-quota" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card data-testid="director-pending">
          <h2 className="mb-3 font-display font-semibold">Menunggu Persetujuan ({s.pending_approvals.length})</h2>
          {s.pending_approvals.length === 0 ? <Empty text="Tidak ada penawaran menunggu." /> : s.pending_approvals.map((q) => (
            <Link key={q.id} to={`/penawaran/${q.id}`} className="flex justify-between py-1.5 text-sm hover:text-cyan-300" data-testid={`director-pending-${q.id}`}>
              <span>{q.number}<span className="block text-xs text-muted-foreground">{q.partner_name}</span></span><span className="font-mono">{fmtIDR(q.total)}</span>
            </Link>
          ))}
        </Card>
        <Card>
          <h2 className="mb-3 font-display font-semibold">Pelanggan Teratas {s.year}</h2>
          {s.top_customers.length === 0 ? <Empty text="Belum ada pemasukan per pelanggan." /> : s.top_customers.map((c) => (
            <p key={c.partner_id} className="flex justify-between py-1 text-sm"><span>{c.name}</span><span className="font-mono">{fmtIDR(c.amount)}</span></p>
          ))}
        </Card>
        <Card>
          <h2 className="mb-3 font-display font-semibold">Kopra {s.year}</h2>
          {s.kopra_year.length === 0 ? <Empty text="Belum ada kegiatan." /> : s.kopra_year.map((k) => (
            <p key={k.activity_type + k.unit} className="flex justify-between py-1 text-sm"><span>{k.activity_type}</span><span className="text-right font-mono">{fmtNum(k.quantity)} {k.unit}<span className="block text-xs text-muted-foreground">{fmtIDR(k.value)}</span></span></p>
          ))}
        </Card>
      </div>
      <Card>
        <h2 className="mb-3 font-display font-semibold">Rincian Kategori Keuangan {s.year}</h2>
        {s.finance_year.by_category.length === 0 ? <Empty text="Belum ada transaksi." /> : s.finance_year.by_category.map((c) => (
          <p key={c.type + c.category} className="flex justify-between py-1 text-sm"><span className="flex items-center gap-2"><Badge value={c.type} />{c.category}</span><span className="font-mono">{fmtIDR(c.amount)}</span></p>
        ))}
      </Card>
    </div>
  );
}

function UserDialog({ initial, onClose, onSaved }) {
  const [f, setF] = useState(initial || { name: "", username: "", email: "", role: "ops", password: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    try {
      if (initial) await api.patch(`/users/${initial.id}`, { name: f.name, email: f.email || "", ...(initial.role !== "director" ? { role: f.role } : {}) });
      else await api.post("/users", { ...f, email: f.email || null });
      toast.success(initial ? "Akun diperbarui." : "Akun anggota dibuat. Pengguna wajib mengganti password saat login pertama.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="user-dialog">
        <DialogHeader><DialogTitle>{initial ? "Ubah Akun" : "Buat Akun Anggota"}</DialogTitle></DialogHeader>
        <Field label="Nama lengkap *" htmlFor="u-name"><Input id="u-name" value={f.name} onChange={set("name")} data-testid="user-name-input" /></Field>
        {!initial && <Field label="Username *" htmlFor="u-username" hint="Huruf kecil, angka, titik, garis bawah, strip."><Input id="u-username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} data-testid="user-username-input" /></Field>}
        <Field label="Email (opsional)" htmlFor="u-email"><Input id="u-email" value={f.email || ""} onChange={set("email")} data-testid="user-email-input" /></Field>
        {initial?.role !== "director" && <Field label="Peran"><Select value={f.role} onChange={set("role")} data-testid="user-role-select">{ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>}
        {!initial && <Field label="Password sementara *" htmlFor="u-pass" hint="Min. 8 karakter, huruf dan angka. Wajib diganti saat login pertama."><Input id="u-pass" type="text" value={f.password} onChange={set("password")} data-testid="user-password-input" /></Field>}
        <DialogFooter><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={save} data-testid="user-save-button">Simpan</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ u, onClose }) {
  const [pw, setPw] = useState("");
  const save = async () => {
    try {
      await api.post(`/users/${u.id}/reset-password`, { new_password: pw });
      toast.success("Password direset. Sesi pengguna dihentikan.");
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="reset-password-dialog">
        <DialogHeader><DialogTitle>Reset Password · {u.name}</DialogTitle></DialogHeader>
        <Field label="Password sementara baru" htmlFor="r-pw" hint="Pengguna wajib menggantinya saat login berikutnya."><Input id="r-pw" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="reset-password-input" /></Field>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={save} data-testid="reset-password-save-button">Reset</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Accounts() {
  const { user: me } = useAuth();
  const { data, reload } = useFetch("/users");
  const [dlg, setDlg] = useState(null);
  const [reset, setReset] = useState(null);
  if (!data) return null;
  const full = data.quota.remaining === 0;
  const toggle = async (u) => {
    if (!window.confirm(`${u.is_active ? "Nonaktifkan" : "Aktifkan"} akun ${u.name}?`)) return;
    try {
      await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div data-testid="director-accounts">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300" data-testid="user-quota">
          Kuota akun: <b className="text-cyan-300">{data.quota.total} / {data.quota.max_total}</b> · Role C: {data.quota.by_role.ops} / {data.quota.max_ops} · Akun nonaktif tetap dihitung.
        </p>
        <Button onClick={() => setDlg({})} disabled={full} data-testid="user-create-button"><UserPlus className="mr-1 h-4 w-4" />Buat Akun Anggota</Button>
      </div>
      <Table head={["Nama", "Username / Email", "Peran", "Status", "Login terakhir", ""]} testId="users-table">
        {data.items.map((u) => (
          <tr key={u.id} className="hover:bg-white/5" data-testid={`user-row-${u.username}`}>
            <Td className="font-medium">{u.name}{u.must_change_password && <div className="text-xs text-amber-300">Belum mengganti password awal</div>}</Td>
            <Td className="font-mono text-xs">{u.username}<div className="text-muted-foreground">{u.email || "—"}</div></Td>
            <Td>{u.role_label}</Td>
            <Td><Badge label={u.is_active ? "Aktif" : "Nonaktif"} tone={u.is_active ? "green" : "red"} /></Td>
            <Td className="text-xs">{fmtDateTime(u.last_login_at)}</Td>
            <Td className="whitespace-nowrap text-right">
              <Button size="icon" variant="ghost" onClick={() => setDlg(u)} data-testid={`user-edit-${u.username}`}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => setReset(u)} title="Reset password" data-testid={`user-reset-${u.username}`}><KeyRound className="h-4 w-4" /></Button>
              {u.id !== me.id && u.role !== "director" && <Button size="icon" variant="ghost" onClick={() => toggle(u)} title="Aktif/nonaktif" data-testid={`user-toggle-${u.username}`}><Power className={u.is_active ? "h-4 w-4 text-red-400" : "h-4 w-4 text-emerald-400"} /></Button>}
            </Td>
          </tr>
        ))}
      </Table>
      {dlg && <UserDialog initial={dlg.id ? dlg : null} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); reload(); }} />}
      {reset && <ResetDialog u={reset} onClose={() => { setReset(null); reload(); }} />}
    </div>
  );
}

function Audit() {
  const [f, setF] = useState({ action: "", result: "", date_from: "", date_to: "" });
  const [skip, setSkip] = useState(0);
  const { data } = useFetch(`/audit-logs?${new URLSearchParams({ ...f, skip, limit: 50 })}`);
  const set = (k) => (e) => { setSkip(0); setF({ ...f, [k]: e.target.value }); };
  return (
    <div data-testid="director-audit">
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Select value={f.action} onChange={set("action")} data-testid="audit-action-filter"><option value="">Semua tindakan</option>{(data?.actions || []).map((a) => <option key={a}>{a}</option>)}</Select>
        <Select value={f.result} onChange={set("result")} data-testid="audit-result-filter"><option value="">Semua hasil</option><option value="success">success</option><option value="failed">failed</option><option value="denied">denied</option></Select>
        <Input type="date" value={f.date_from} onChange={set("date_from")} data-testid="audit-from" />
        <Input type="date" value={f.date_to} onChange={set("date_to")} data-testid="audit-to" />
      </div>
      <Table head={["Waktu", "Pelaku", "Tindakan", "Objek", "Hasil", "Detail"]} testId="audit-table">
        {(data?.items || []).map((a) => (
          <tr key={a.id} data-testid="audit-row">
            <Td className="whitespace-nowrap text-xs">{fmtDateTime(a.at)}</Td>
            <Td>{a.user_name || "—"}<div className="font-mono text-xs text-muted-foreground">{a.username}</div></Td>
            <Td className="font-mono text-xs text-cyan-300">{a.action}</Td>
            <Td className="text-xs">{a.object_type || "—"}</Td>
            <Td><Badge label={a.result} tone={a.result === "success" ? "green" : a.result === "denied" ? "amber" : "red"} /></Td>
            <Td className="max-w-xs truncate text-xs text-muted-foreground">{a.detail}</Td>
          </tr>
        ))}
      </Table>
      {data && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{data.total} catatan · audit log tidak dapat diubah atau dihapus</span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - 50))} data-testid="audit-prev">Sebelumnya</Button>
            <Button size="sm" variant="outline" disabled={skip + 50 >= data.total} onClick={() => setSkip(skip + 50)} data-testid="audit-next">Berikutnya</Button>
          </span>
        </div>
      )}
    </div>
  );
}

const LISTS = [["kopra_activity_types", "Jenis kegiatan kopra"], ["kopra_units", "Satuan kopra"], ["document_categories", "Kategori dokumen"], ["income_categories", "Kategori pemasukan"], ["expense_categories", "Kategori pengeluaran"]];

function SettingsTab() {
  const { data, reload } = useFetch("/settings");
  const [f, setF] = useState(null);
  useEffect(() => {
    if (data) {
      setF({ windows: data.reminder_windows.join(", "), opfin: data.quotation_approver_roles.includes("opfin"), ...Object.fromEntries(LISTS.map(([k]) => [k, data[k].join("\n")])) });
    }
  }, [data]);
  if (!f) return null;
  const save = async () => {
    const windows = f.windows.split(",").map((x) => parseInt(x.trim(), 10)).filter((x) => x > 0);
    if (!windows.length) return toast.error("Isi minimal satu periode pengingat.");
    const body = { reminder_windows: windows, quotation_approver_roles: f.opfin ? ["director", "opfin"] : ["director"] };
    LISTS.forEach(([k]) => { body[k] = f[k].split("\n").map((x) => x.trim()).filter(Boolean); });
    try {
      await api.put("/settings", body);
      toast.success("Pengaturan disimpan.");
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Card className="grid gap-5 lg:grid-cols-2" data-testid="director-settings">
      <Field label="Periode pengingat (hari sebelum jatuh tempo, pisahkan koma)" htmlFor="s-win"><Input id="s-win" value={f.windows} onChange={(e) => setF({ ...f, windows: e.target.value })} data-testid="settings-windows-input" /></Field>
      <Field label="Persetujuan final penawaran">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked disabled />Direktur (selalu)</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.opfin} onCheckedChange={(v) => setF({ ...f, opfin: !!v })} data-testid="settings-opfin-approver-checkbox" />Izinkan juga Role B (Putri Anjani, Firdaus Apek)</label>
      </Field>
      {LISTS.map(([k, l]) => (
        <Field key={k} label={`${l} (satu per baris)`} htmlFor={`s-${k}`}>
          <textarea id={`s-${k}`} rows={5} className="w-full rounded-md border border-input bg-background/60 p-2 text-sm" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`settings-${k}-input`} />
        </Field>
      ))}
      <div className="lg:col-span-2"><Button onClick={save} data-testid="settings-save-button">Simpan Pengaturan</Button></div>
    </Card>
  );
}

function EmailTab() {
  const { data, reload } = useFetch("/notifications/email-logs");
  const { data: settings, reload: reloadS } = useFetch("/settings");
  const [busy, setBusy] = useState(false);
  if (!data || !settings) return null;
  const enabled = settings.email_reminders_enabled !== false;
  const toggle = async (v) => {
    await api.put("/settings", { email_reminders_enabled: !!v });
    reloadS();
  };
  const run = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post("/notifications/email-reminders/run");
      const msg = { disabled: "Email pengingat sedang dinonaktifkan.", nothing_due: "Tidak ada dokumen/kontrak baru yang perlu diingatkan." }[r.status];
      toast[r.failed ? "error" : "success"](msg || `${r.items} item · ${r.sent} email terkirim · ${r.failed} gagal`);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const noEmail = data.recipients.filter((r) => r.is_active && !r.email);
  return (
    <div className="space-y-4" data-testid="director-email">
      <Card className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={enabled} onCheckedChange={toggle} data-testid="email-enabled-checkbox" />Kirim email pengingat otomatis setiap hari pukul 08:00 WIB</label>
        <p className="text-xs text-muted-foreground">Email dikirim untuk dokumen & kontrak yang mencapai H-{settings.reminder_windows.join(", H-")} atau sudah lewat. Setiap tingkat hanya dikirim sekali per dokumen. Penerima: semua akun aktif yang memiliki email.</p>
        {noEmail.length > 0 && <p className="text-xs text-amber-300" data-testid="email-missing-warning">Belum punya email (tidak menerima pengingat): {noEmail.map((r) => r.name).join(", ")}. Isi lewat tab Akun Pengguna.</p>}
        <Button onClick={run} disabled={busy} data-testid="email-run-now-button">{busy ? "Mengirim…" : "Kirim Pengingat Sekarang"}</Button>
      </Card>
      <Table head={["Waktu", "Penerima", "Subjek", "Item", "Status", "Pemicu"]} testId="email-logs-table">
        {data.logs.map((l, i) => (
          <tr key={i}>
            <Td className="whitespace-nowrap text-xs">{fmtDateTime(l.at)}</Td>
            <Td>{l.to_name}<div className="font-mono text-xs text-muted-foreground">{l.to_email}</div></Td>
            <Td className="text-xs">{l.subject}</Td>
            <Td className="font-mono">{l.items}</Td>
            <Td><Badge label={l.status === "sent" ? "Terkirim" : "Gagal"} tone={l.status === "sent" ? "green" : "red"} />{l.error && <div className="text-xs text-muted-foreground">{l.error}</div>}</Td>
            <Td className="text-xs">{l.trigger}</Td>
          </tr>
        ))}
      </Table>
      {data.logs.length === 0 && <Empty text="Belum ada email terkirim." />}
    </div>
  );
}

export default function Director({ tab }) {
  const [t, setT] = useState(tab);
  useEffect(() => { setT(tab); }, [tab]);
  return (
    <div data-testid="director-page">
      <PageHeader title="Menu Direktur" subtitle="Khusus Tengku Erens · ringkasan strategis, akun, persetujuan, audit, dan pengaturan." />
      <Tabs value={t} onValueChange={setT}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="ringkasan" data-testid="director-tab-ringkasan">Ringkasan</TabsTrigger>
          <TabsTrigger value="akun" data-testid="director-tab-akun">Akun Pengguna</TabsTrigger>
          <TabsTrigger value="audit" data-testid="director-tab-audit">Audit Log</TabsTrigger>
          <TabsTrigger value="email" data-testid="director-tab-email">Notifikasi Email</TabsTrigger>
          <TabsTrigger value="pengaturan" data-testid="director-tab-pengaturan">Pengaturan</TabsTrigger>
        </TabsList>
        <TabsContent value="ringkasan"><Summary /></TabsContent>
        <TabsContent value="akun"><Accounts /></TabsContent>
        <TabsContent value="audit"><Audit /></TabsContent>
        <TabsContent value="email"><EmailTab /></TabsContent>
        <TabsContent value="pengaturan"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
