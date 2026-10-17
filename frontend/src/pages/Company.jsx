import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api, errMsg } from "@/lib/api";
import { PageHeader, Card, Field, useFetch } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const FIELDS = [
  ["name", "Nama perusahaan"], ["director", "Direktur"], ["address", "Alamat"], ["phone", "Telepon"],
  ["email", "Email"], ["npwp", "NPWP"], ["website", "Website"],
];

export default function Company() {
  const { can } = useAuth();
  const { data, reload } = useFetch("/company");
  const [f, setF] = useState(null);
  const [edit, setEdit] = useState(false);
  useEffect(() => { if (data) { setF(data); } }, [data]);
  if (!f) return null;

  const save = async () => {
    try {
      await api.put("/settings", { company: f });
      toast.success("Data perusahaan disimpan.");
      setEdit(false);
      reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="max-w-3xl" data-testid="company-page">
      <PageHeader title="Data Perusahaan" subtitle="Profil resmi yang digunakan pada surat penawaran."
        actions={can("director") && !edit && <Button onClick={() => setEdit(true)} data-testid="company-edit-button">Ubah Data</Button>} />
      <Card className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map(([k, l]) => (
          <Field key={k} label={l} htmlFor={`company-${k}`} className={k === "address" ? "sm:col-span-2" : ""}>
            {edit ? (
              <Input id={`company-${k}`} value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`company-${k}-input`} />
            ) : (
              <p className="text-sm" data-testid={`company-${k}-value`}>{f[k] || <span className="text-muted-foreground">Belum diisi</span>}</p>
            )}
          </Field>
        ))}
        {edit && (
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={save} data-testid="company-save-button">Simpan</Button>
            <Button variant="ghost" onClick={() => { setF(data); setEdit(false); }} data-testid="company-cancel-button">Batal</Button>
          </div>
        )}
      </Card>
      {!can("director") && <p className="mt-3 text-xs text-muted-foreground">Perubahan data perusahaan dilakukan oleh Direktur.</p>}
    </div>
  );
}
