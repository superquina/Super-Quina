"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Cashier = {
  id: string;
  username: string;
  fullName: string | null;
  whatsapp: string | null;
  city: string | null;
  address: string | null;
  referencePoint: string | null;
  suppliesMaterial: boolean;
  commissionRateBasisPoints: number;
  commissionPercent: number;
  status: "ACTIVE" | "BLOCKED" | "PENDING";
  mustChangePassword: boolean;
  createdAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number; hasPreviousPage: boolean; hasNextPage: boolean };

type FormState = {
  fullName: string;
  username: string;
  password: string;
  whatsapp: string;
  city: string;
  address: string;
  referencePoint: string;
  suppliesMaterial: boolean;
  status: "ACTIVE" | "BLOCKED";
};

const emptyForm: FormState = {
  fullName: "", username: "", password: "", whatsapp: "", city: "", address: "", referencePoint: "", suppliesMaterial: false, status: "ACTIVE",
};

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function AdminCashierManager({ mode }: { mode: "create" | "manage" }) {
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadController = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/cashiers?page=" + page + "&limit=50&q=" + encodeURIComponent(searchTerm.trim()), { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os cambistas.");
      if (!controller.signal.aborted) { setCashiers(body.cashiers as Cashier[]); setPagination(body.pagination as Pagination); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao carregar os cambistas.");
    } finally {
      if (loadController.current === controller) { loadController.current = null; setLoading(false); }
    }
  }, [page, searchTerm]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(timer); loadController.current?.abort(); };
  }, [load]);

  function beginEdit(cashier: Cashier) {
    setEditingId(cashier.id);
    setForm({
      fullName: cashier.fullName ?? "",
      username: cashier.username,
      password: "",
      whatsapp: cashier.whatsapp ?? "",
      city: cashier.city ?? "",
      address: cashier.address ?? "",
      referencePoint: cashier.referencePoint ?? "",
      suppliesMaterial: cashier.suppliesMaterial,
      status: cashier.status === "BLOCKED" ? "BLOCKED" : "ACTIVE",
    });
    setError(""); setNotice("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice("");
    if (!editingId && form.password.length < 6) {
      setError("A senha inicial precisa ter pelo menos 6 caracteres."); return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        fullName: form.fullName, username: form.username, whatsapp: form.whatsapp,
        city: form.city, address: form.address, referencePoint: form.referencePoint,
        suppliesMaterial: form.suppliesMaterial,
      };
      // The create API uses a strict schema and intentionally does not accept
      // status: new cashiers are created ACTIVE on the server. Status is only
      // editable through the PATCH endpoint.
      if (editingId) payload.status = form.status;
      if (!editingId || form.password) payload.password = form.password;
      const response = await fetch(editingId ? "/api/admin/cashiers/" + encodeURIComponent(editingId) : "/api/admin/cashiers", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível salvar o cambista.");
      setNotice(editingId ? "Cadastro do cambista atualizado." : "Cambista cadastrado. Ele deverá trocar a senha no primeiro acesso.");
      resetForm();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao salvar o cambista.");
    } finally { setBusy(false); }
  }

  return <section className="feature-card" aria-labelledby="admin-cashiers-heading">
    <span className="feature-label">Equipe de vendas</span>
    <h2 id="admin-cashiers-heading">{mode === "create" ? "Cadastro de cambista" : "Gestão de cambistas"}</h2>
    {mode === "create" && <p>Cadastre cada vendedor com sua própria comissão. Alterar a porcentagem não muda comissões já registradas em vendas anteriores.</p>}
    {mode === "manage" && editingId && <p>Edite os dados do cambista selecionado. Para apurações, abra o financeiro e histórico.</p>}
    {(mode === "create" || (mode === "manage" && Boolean(editingId))) && <form className="admin-round-create" onSubmit={submit}>
      <h3>{editingId ? "Editar cambista" : "Cadastrar novo cambista"}</h3>
      <label>Nome completo
        <input autoComplete="name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} minLength={3} maxLength={120} required />
      </label>
      <label>Nome de usuário
        <input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} minLength={3} maxLength={24} pattern="[A-Za-z0-9_.-]+" required />
      </label>
      <label>{editingId ? "Nova senha (opcional)" : "Senha inicial"}
        <input autoComplete="new-password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={editingId && !form.password ? undefined : 6} maxLength={1024} required={!editingId} placeholder={editingId ? "Deixe vazio para manter a senha" : "Mínimo de 6 caracteres"} />
      </label>
      <label>WhatsApp
        <input autoComplete="tel" type="tel" value={form.whatsapp} onChange={(event) => setForm({ ...form, whatsapp: event.target.value })} minLength={10} maxLength={24} required />
      </label>
      <label>Cidade
        <input autoComplete="address-level2" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} maxLength={120} />
      </label>
      <label>Endereço
        <input autoComplete="street-address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} maxLength={200} />
      </label>
      <label>Ponto de referência
        <input value={form.referencePoint} onChange={(event) => setForm({ ...form, referencePoint: event.target.value })} maxLength={200} placeholder="Ex.: próximo à praça, ao lado da farmácia" />
      </label>
      <fieldset>
        <legend>Fornecimento de material</legend>
        <label><input type="checkbox" checked={form.suppliesMaterial} onChange={(event) => setForm({ ...form, suppliesMaterial: event.target.checked })} /> Forneço material</label>
        <p>Comissão automática: {form.suppliesMaterial ? "10% (com fornecimento de material)" : "20% (sem fornecimento de material)"}</p>
      </fieldset>
      {editingId && <label>Status da conta
        <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as FormState["status"] })}>
          <option value="ACTIVE">Ativa</option>
          <option value="BLOCKED">Bloqueada</option>
        </select>
      </label>}
      <div className="round-actions">
        <button type="submit" disabled={busy}>{busy ? "Salvando…" : editingId ? "Salvar alterações" : "Cadastrar cambista"}</button>
        {editingId && <button type="button" className="secondary-button" disabled={busy} onClick={resetForm}>Cancelar edição</button>}
      </div>
    </form>}
    <div className="form-feedback-slot" aria-live="polite">
      {error && <p role="alert" className="note-inline form-feedback-error" aria-live="assertive">{error}</p>}
      {notice && <p role="status" className="note-inline form-feedback-success" aria-live="polite">{notice}</p>}
    </div>
    {mode === "manage" && <><h3>Cambistas cadastrados</h3>
    <label htmlFor="admin-cashier-search">Pesquisar cambista</label>
    <input id="admin-cashier-search" type="search" value={searchTerm} onChange={(event) => { setPage(1); setSearchTerm(event.target.value); }} placeholder="Nome, usuário ou WhatsApp" />
    {!loading && pagination && pagination.total > 0 && <p aria-live="polite">Exibindo {((page - 1) * pagination.limit) + 1}–{Math.min(page * pagination.limit, pagination.total)} de {pagination.total} cambistas.</p>}
    {!loading && cashiers.length > 0 && <div className="admin-cashier-directory"><label htmlFor="admin-cashier-select">Abrir financeiro e histórico do cambista</label><select id="admin-cashier-select" className="admin-cashier-select" defaultValue="" onChange={(event) => { if (event.target.value) window.location.href = "/admin/cashiers/" + encodeURIComponent(event.target.value); }}><option value="" disabled>Selecione um cambista</option>{cashiers.map((cashier) => <option key={cashier.id} value={cashier.id}>{cashier.fullName || cashier.username} · {cashier.username}</option>)}</select></div>}
    {loading ? <p>Carregando cambistas…</p> : cashiers.length === 0 ? <p>Nenhum cambista cadastrado.</p> : <div className="admin-round-list">
      {cashiers.map((cashier) => <article className="round-option" key={cashier.id}>
        <div>
          <a className="admin-cashier-name-link" href={"/admin/cashiers/" + encodeURIComponent(cashier.id)}><strong>{cashier.fullName || cashier.username}</strong> — Ver financeiro e histórico</a>
          <p>Usuário: {cashier.username} · WhatsApp: {cashier.whatsapp || "Não informado"}</p>
          <p>Cidade: {cashier.city || "Não informada"} · Endereço: {cashier.address || "Não informado"}</p>
          <p>Ponto de referência: {cashier.referencePoint || "Não informado"}</p>
          <p>Fornece material: {cashier.suppliesMaterial ? "Sim" : "Não"} · Comissão automática: <strong>{cashier.commissionPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</strong> · Status: {cashier.status === "ACTIVE" ? "Ativo" : cashier.status === "BLOCKED" ? "Bloqueado" : "Pendente"}</p>
          <p>Cadastro: {new Date(cashier.createdAt).toLocaleDateString("pt-BR")}{cashier.mustChangePassword ? " · Troca de senha no primeiro acesso" : ""}</p>
        </div>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => beginEdit(cashier)}>Editar cadastro</button>
      </article>)}
    </div>}
    {!loading && pagination && pagination.totalPages > 1 && <nav className="round-actions" aria-label="Paginação de cambistas">
      <button type="button" className="secondary-button" disabled={!pagination.hasPreviousPage || busy} onClick={() => setPage((current) => Math.max(1, current - 1))}>Página anterior</button>
      <span aria-live="polite">Página {pagination.page} de {pagination.totalPages}</span>
      <button type="button" className="secondary-button" disabled={!pagination.hasNextPage || busy} onClick={() => setPage((current) => current + 1)}>Próxima página</button>
    </nav>}</>}
  </section>;
}
