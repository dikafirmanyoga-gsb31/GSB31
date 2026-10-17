import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Printer, Pencil, Send, CheckCircle2, XCircle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg, fmtDate, fmtDateTime, fmtIDR, fmtNum } from "@/lib/api";
import { PageHeader, Card, Badge, STATUS, useFetch } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const PrintLetter = ({ q, company }) => (
  <div className="print-area bg-white p-2 text-[12px] leading-relaxed text-[#0F172A]" data-testid="quotation-print-area">
    <div className="flex items-end justify-between border-b-2 border-[#0284C7] pb-3">
      <div>
        <p className="text-xl font-extrabold tracking-wide">{company.name}</p>
        <p>{company.address}</p>
        <p>{[company.phone, company.email, company.website].filter(Boolean).join(" · ")}</p>
      </div>
      <p className="text-2xl font-extrabold text-[#0284C7]">GSB31</p>
    </div>
    <div className="mt-5 flex justify-between">
      <div>
        <p>Nomor: <b>{q.number}</b></p>
        <p>Perihal: {q.subject || "Surat Penawaran"}</p>
      </div>
      <p>{fmtDate(q.date)}</p>
    </div>
    <div className="mt-4">
      <p>Kepada Yth.</p>
      <p className="font-bold">{q.partner?.name}</p>
      {q.partner?.contact_person && <p>Up. {q.partner.contact_person}</p>}
      <p>{q.partner?.address}</p>
    </div>
    <p className="mt-4">Dengan hormat, bersama ini kami sampaikan penawaran sebagai berikut:</p>
    <table className="mt-3 w-full border-collapse">
      <thead><tr className="bg-[#F1F5F9]">{["No", "Uraian", "Kuantitas", "Harga Satuan", "Jumlah"].map((h) => <th key={h} className="border border-[#CBD5E1] px-2 py-1 text-left">{h}</th>)}</tr></thead>
      <tbody>
        {q.items.map((it, i) => (
          <tr key={i}>
            <td className="border border-[#CBD5E1] px-2 py-1">{i + 1}</td>
            <td className="border border-[#CBD5E1] px-2 py-1">{it.description}</td>
            <td className="border border-[#CBD5E1] px-2 py-1">{fmtNum(it.quantity)} {it.unit}</td>
            <td className="border border-[#CBD5E1] px-2 py-1">{fmtIDR(it.unit_price)}</td>
            <td className="border border-[#CBD5E1] px-2 py-1 text-right">{fmtIDR(it.amount)}</td>
          </tr>
        ))}
        <tr><td colSpan={4} className="border border-[#CBD5E1] px-2 py-1 text-right">Subtotal</td><td className="border border-[#CBD5E1] px-2 py-1 text-right">{fmtIDR(q.subtotal)}</td></tr>
        {q.tax_percent > 0 && <tr><td colSpan={4} className="border border-[#CBD5E1] px-2 py-1 text-right">PPN {q.tax_percent}%</td><td className="border border-[#CBD5E1] px-2 py-1 text-right">{fmtIDR(q.tax_amount)}</td></tr>}
        <tr className="font-bold"><td colSpan={4} className="border border-[#CBD5E1] px-2 py-1 text-right">Total</td><td className="border border-[#CBD5E1] px-2 py-1 text-right">{fmtIDR(q.total)}</td></tr>
      </tbody>
    </table>
    <p className="mt-3">Penawaran ini berlaku sampai dengan <b>{fmtDate(q.valid_until)}</b>.</p>
    {q.terms && <div className="mt-3"><p className="font-bold">Syarat & Ketentuan:</p><p className="whitespace-pre-line">{q.terms}</p></div>}
    <p className="mt-4">Demikian penawaran ini kami sampaikan. Atas perhatian dan kerja samanya, kami ucapkan terima kasih.</p>
    <div className="mt-8 w-56">
      <p>Hormat kami,</p>
      <p>{company.name}</p>
      <div className="h-20" />
      <p className="font-bold underline">{company.director}</p>
      <p>Direktur</p>
    </div>
  </div>
);

const Actions = ({ q, act }) => {
  const s = q.status;
  const expired = q.effective_status === "expired";
  return (
    <div className="flex flex-wrap gap-2">
      {(s === "draft" || s === "rejected") && <Button variant="outline" asChild data-testid="quotation-edit-button"><Link to={`/penawaran/${q.id}/edit`}><Pencil className="mr-1 h-4 w-4" />Edit</Link></Button>}
      {s === "draft" && <Button onClick={() => act("pending")} data-testid="quotation-submit-button"><Send className="mr-1 h-4 w-4" />Ajukan Persetujuan</Button>}
      {s === "pending" && !expired && q.can_approve && <Button className="bg-emerald-500 text-white hover:bg-emerald-600" onClick={() => act("approved")} data-testid="quotation-approve-button"><CheckCircle2 className="mr-1 h-4 w-4" />Setujui</Button>}
      {s === "pending" && q.can_approve && <Button variant="destructive" onClick={() => act("rejected")} data-testid="quotation-reject-button"><XCircle className="mr-1 h-4 w-4" />Tolak</Button>}
      {s === "pending" && <Button variant="ghost" onClick={() => act("draft")} data-testid="quotation-withdraw-button"><Undo2 className="mr-1 h-4 w-4" />Tarik ke Draft</Button>}
      {s === "rejected" && <Button variant="ghost" onClick={() => act("draft")} data-testid="quotation-redraft-button"><Undo2 className="mr-1 h-4 w-4" />Kembalikan ke Draft</Button>}
      {s === "approved" && !expired && <Button onClick={() => act("sent")} data-testid="quotation-mark-sent-button"><Send className="mr-1 h-4 w-4" />Tandai Dikirim</Button>}
      <Button variant="outline" onClick={() => window.print()} data-testid="quotation-print-button"><Printer className="mr-1 h-4 w-4" />Cetak / Simpan PDF</Button>
    </div>
  );
};

export default function QuotationDetail() {
  const { id } = useParams();
  const { data: q, reload } = useFetch(`/quotations/${id}`);
  const { data: company } = useFetch("/company");
  const [note, setNote] = useState("");
  if (!q || !company) return null;
  const act = async (status) => {
    try {
      await api.post(`/quotations/${id}/status`, { status, note: note || null });
      toast.success(`Status diubah menjadi ${STATUS[status][0]}.`);
      setNote("");
      reload();
    } catch (e) {
      if (e?.response?.status !== 403) toast.error(errMsg(e));
    }
  };
  return (
    <div className="max-w-5xl" data-testid="quotation-detail-page">
      <PageHeader title={q.number} subtitle={`${q.partner?.name || ""} · ${q.subject || ""}`} actions={<Badge value={q.effective_status} testId="quotation-status-badge" />} />
      <Card className="mb-4">
        <Actions q={q} act={act} />
        {["draft", "pending", "rejected"].includes(q.status) && (
          <Textarea className="mt-3" rows={2} placeholder="Catatan perubahan status (opsional)" value={note} onChange={(e) => setNote(e.target.value)} data-testid="quotation-status-note-input" />
        )}
        {q.status === "pending" && !q.can_approve && <p className="mt-2 text-xs text-amber-300">Persetujuan final dilakukan oleh Direktur.</p>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-muted-foreground">Tanggal</p><p>{fmtDate(q.date)}</p></div>
            <div><p className="text-xs text-muted-foreground">Berlaku s/d</p><p>{fmtDate(q.valid_until)}</p></div>
            <div><p className="text-xs text-muted-foreground">Dibuat oleh</p><p>{q.created_by_name}</p></div>
            <div><p className="text-xs text-muted-foreground">Keputusan</p><p>{q.decided_by_name || "—"}</p></div>
          </div>
          <table className="mt-5 w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-2">Uraian</th><th>Kuantitas</th><th>Harga</th><th className="text-right">Jumlah</th></tr></thead>
            <tbody className="divide-y divide-border">
              {q.items.map((it, i) => (
                <tr key={i}><td className="py-2">{it.description}</td><td className="font-mono">{fmtNum(it.quantity)} {it.unit}</td><td className="font-mono">{fmtIDR(it.unit_price)}</td><td className="text-right font-mono">{fmtIDR(it.amount)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <p className="flex justify-between"><span>Subtotal</span><span className="font-mono">{fmtIDR(q.subtotal)}</span></p>
            <p className="flex justify-between"><span>PPN {q.tax_percent}%</span><span className="font-mono">{fmtIDR(q.tax_amount)}</span></p>
            <p className="flex justify-between border-t border-border pt-1 font-semibold"><span>Total</span><span className="font-mono text-cyan-300" data-testid="quotation-detail-total">{fmtIDR(q.total)}</span></p>
          </div>
          {q.terms && <div className="mt-4 text-sm"><p className="text-xs text-muted-foreground">Syarat & ketentuan</p><p className="whitespace-pre-line">{q.terms}</p></div>}
          {q.documents?.length > 0 && <div className="mt-4 text-sm"><p className="text-xs text-muted-foreground">Kontrak/dokumen terkait</p>{q.documents.map((d) => <p key={d.id}>{d.name} ({d.kind})</p>)}</div>}
        </Card>
        <Card data-testid="quotation-history">
          <h2 className="mb-3 font-display font-semibold">Riwayat Status</h2>
          <ol className="space-y-3 border-l border-border pl-4">
            {[...q.history].reverse().map((h, i) => (
              <li key={i} className="text-sm">
                <Badge value={h.status} />
                <p className="mt-1 text-xs text-muted-foreground">{h.by_name} · {fmtDateTime(h.at)}</p>
                {h.note && <p className="text-xs text-slate-300">{h.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <PrintLetter q={q} company={company} />
    </div>
  );
}
