import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { fmtDate, fmtIDR } from "@/lib/api";
import { PageHeader, Select, Table, Td, Badge, Empty, useFetch, STATUS } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Quotations() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data } = useFetch(`/quotations?q=${encodeURIComponent(q)}&status=${status}`);
  const navigate = useNavigate();
  return (
    <div data-testid="quotations-page">
      <PageHeader title="Surat Penawaran" subtitle="Susun, ajukan, dan lacak status penawaran bisnis."
        actions={<Button asChild data-testid="quotation-create-button"><Link to="/penawaran/baru"><Plus className="mr-1 h-4 w-4" />Buat Penawaran</Link></Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Cari nomor atau perihal…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="quotation-search-input" />
        </div>
        <Select className="sm:w-56" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="quotation-status-filter">
          <option value="">Semua status</option>
          {["draft", "pending", "approved", "sent", "rejected", "expired"].map((s) => <option key={s} value={s}>{STATUS[s][0]}</option>)}
        </Select>
      </div>
      <Table head={["Nomor", "Tanggal", "Pelanggan", "Berlaku s/d", "Total", "Status"]} testId="quotations-table">
        {(data || []).map((x) => (
          <tr key={x.id} className="cursor-pointer hover:bg-white/5" onClick={() => navigate(`/penawaran/${x.id}`)} data-testid={`quotation-row-${x.id}`}>
            <Td className="font-mono text-cyan-300">{x.number}</Td>
            <Td>{fmtDate(x.date)}</Td>
            <Td>{x.partner_name || "—"}</Td>
            <Td>{fmtDate(x.valid_until)}</Td>
            <Td className="font-mono">{fmtIDR(x.total)}</Td>
            <Td><Badge value={x.effective_status} /></Td>
          </tr>
        ))}
      </Table>
      {data && data.length === 0 && <Empty text="Belum ada penawaran." />}
    </div>
  );
}
