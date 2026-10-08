import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, UserRound, FileText, Receipt, Percent, Truck, MapPin, User, Hash } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { useClientStore } from '@/store/clientStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useFreeInvoiceStore, type FreeInvoiceInput } from '@/store/freeInvoiceStore';
import { formatCurrency, todayISO, DEFAULT_TVA_RATE } from '@/lib/utils';
import type { FreeInvoice, FreeInvoiceDocType } from '@/types';

interface Props {
  open: boolean;
  editing?: FreeInvoice | null;
  onClose: () => void;
  onSaved: (invoice: FreeInvoice) => void;
}

interface LineDraft {
  key: string;
  ficheTechnicId?: string;
  productName: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export const FREE_DOC_TYPES: { value: FreeInvoiceDocType; label: string }[] = [
  { value: 'facture', label: 'Facture' },
  { value: 'proforma', label: 'Facture proforma' },
  { value: 'bon_livraison', label: 'Bon de livraison' },
];

const PAYMENT_MODES = ['Espèces', 'Chèque bancaire', 'Virement bancaire', 'À terme'];

const newKey = () => `l-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * FACTURE NON COMPTABILISÉE — saisie identique à une facture de vente ou à un
 * bon de livraison (client, produits, quantités, prix, TVA, versement), mais
 * le document n'est qu'IMPRIMÉ : rien n'est déduit du stock, rien n'entre en
 * caisse, rien ne s'ajoute à la dette du client ni aux rapports.
 */
export function FreeInvoiceForm({ open, editing, onClose, onSaved }: Props) {
  const clients = useClientStore((s) => s.clients);
  const fiches = useFicheTechnicStore((s) => s.ficheTechnics);
  const saveInvoice = useFreeInvoiceStore((s) => s.save);

  const [docType, setDocType] = useState<FreeInvoiceDocType>('facture');
  const [clientId, setClientId] = useState<string | undefined>();
  const [clientSearch, setClientSearch] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientRc, setClientRc] = useState('');
  const [clientNif, setClientNif] = useState('');
  const [clientNis, setClientNis] = useState('');
  const [clientArticle, setClientArticle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [location, setLocation] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPlate, setDriverPlate] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [reduction, setReduction] = useState(0);
  const [tvaEnabled, setTvaEnabled] = useState(false);
  const [tvaRate, setTvaRate] = useState(DEFAULT_TVA_RATE);
  const [paidAmount, setPaidAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState('Espèces');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const e = editing;
    setDocType(e?.docType ?? 'facture');
    setClientId(e?.clientId);
    setClientSearch('');
    setClientName(e?.clientName ?? '');
    setClientPhone(e?.clientPhone ?? '');
    setClientAddress(e?.clientAddress ?? '');
    setClientRc(e?.clientRc ?? '');
    setClientNif(e?.clientNif ?? '');
    setClientNis(e?.clientNis ?? '');
    setClientArticle(e?.clientArticle ?? '');
    setDate(e?.date ?? todayISO());
    setLocation(e?.location ?? '');
    setDriverName(e?.driverName ?? '');
    setDriverPlate(e?.driverPlate ?? '');
    setProductSearch('');
    setLines(
      (e?.lines ?? []).map((l) => ({
        key: newKey(),
        ficheTechnicId: l.ficheTechnicId,
        productName: l.productName,
        description: l.description ?? '',
        quantity: l.quantity,
        unit: l.unit ?? '',
        unitPrice: l.unitPrice,
      }))
    );
    setReduction(e?.reduction ?? 0);
    setTvaEnabled(e?.tvaEnabled ?? false);
    setTvaRate(e?.tvaRate || DEFAULT_TVA_RATE);
    setPaidAmount(e?.paidAmount ?? 0);
    setPaymentMode(e?.paymentMode ?? 'Espèces');
    setNotes(e?.notes ?? '');
    setSaving(false);
  }, [open, editing]);

  const clientResults = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return [];
    return clients
      .filter((c) => c.name.toLowerCase().includes(term) || (c.phone || '').includes(term))
      .slice(0, 8);
  }, [clients, clientSearch]);

  const pickClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setClientId(c.id);
    setClientName(c.name);
    setClientPhone(c.phone ?? '');
    setClientAddress(c.address ?? '');
    setClientRc(c.rc ?? '');
    setClientNif(c.nif ?? '');
    setClientNis(c.nis ?? '');
    setClientArticle(c.article ?? '');
    setClientSearch('');
  };

  const productResults = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return [];
    return fiches.filter((f) => f.name.toLowerCase().includes(term)).slice(0, 8);
  }, [fiches, productSearch]);

  const addFiche = (id: string) => {
    const f = fiches.find((x) => x.id === id);
    if (!f) return;
    setLines((ls) => [...ls, {
      key: newKey(), ficheTechnicId: f.id, productName: f.name, description: f.description ?? '',
      quantity: 1, unit: f.sellByUnit ? (f.sellUnit ?? '') : '', unitPrice: f.unitPrice || 0,
    }]);
    setProductSearch('');
  };

  const addFreeLine = () =>
    setLines((ls) => [...ls, { key: newKey(), productName: '', description: '', quantity: 1, unit: '', unitPrice: 0 }]);

  const patchLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const totals = useMemo(() => {
    const ht = Math.round(lines.reduce((s, l) => s + (l.quantity || 0) * (l.unitPrice || 0), 0) * 100) / 100;
    const base = Math.max(0, ht - (reduction || 0));
    const tva = tvaEnabled ? Math.round(base * tvaRate) / 100 : 0;
    const final = Math.round((base + tva) * 100) / 100;
    const paid = Math.min(Math.max(0, paidAmount || 0), final);
    return { ht, base, tva, final, paid, rest: Math.max(0, final - paid) };
  }, [lines, reduction, tvaEnabled, tvaRate, paidAmount]);

  const handleSave = async () => {
    if (!clientName.trim()) { toast.error('Saisissez le nom du client'); return; }
    const valid = lines.filter((l) => l.productName.trim() && l.quantity > 0);
    if (valid.length === 0) { toast.error('Ajoutez au moins un produit avec une quantité'); return; }
    const input: FreeInvoiceInput = {
      docType,
      clientId,
      clientName: clientName.trim(),
      clientPhone: clientPhone.trim(),
      clientAddress: clientAddress.trim(),
      clientRc: clientRc.trim(),
      clientNif: clientNif.trim(),
      clientNis: clientNis.trim(),
      clientArticle: clientArticle.trim(),
      date,
      location: location.trim(),
      driverName: driverName.trim(),
      driverPlate: driverPlate.trim(),
      tvaEnabled,
      tvaRate,
      reduction: Math.max(0, reduction || 0),
      paidAmount: totals.paid,
      paymentMode,
      notes: notes.trim(),
      lines: valid.map((l) => ({
        ficheTechnicId: l.ficheTechnicId,
        productName: l.productName.trim(),
        description: l.description.trim(),
        quantity: l.quantity,
        unit: l.unit.trim() || undefined,
        unitPrice: l.unitPrice,
        totalPrice: Math.round(l.quantity * l.unitPrice * 100) / 100,
      })),
    };
    setSaving(true);
    try {
      const saved = await saveInvoice(editing?.id ?? null, input);
      if (saved) {
        toast.success(editing ? `Document ${saved.reference} modifié` : `Document ${saved.reference} créé`);
        onSaved(saved);
      }
    } catch {
      /* message déjà affiché */
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'h-9 w-full min-w-0 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-sm font-semibold text-text-primary focus:border-gold focus:outline-none';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Modifier ${editing.reference}` : 'Nouvelle facture non comptabilisée'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="gold" onClick={handleSave} disabled={saving}>
            <FileText size={16} /> {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer le document'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="rounded-xl border border-gold/25 bg-gold/5 px-3 py-2 text-xs font-semibold text-gold-dark">
          Document destiné à l'impression seulement : il ne modifie ni le stock, ni la caisse, ni la dette du
          client, ni les rapports.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Type de document"
            value={docType}
            onChange={(e) => setDocType(e.target.value as FreeInvoiceDocType)}
            options={FREE_DOC_TYPES}
          />
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select
            label="Mode de règlement"
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value)}
            options={PAYMENT_MODES.map((m) => ({ value: m, label: m }))}
          />
        </div>

        {/* ---------------------------------------------------------- client */}
        <section className="space-y-3 rounded-2xl border border-gold/15 bg-vanilla/20 p-4">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-dark">
            <UserRound size={14} /> Client
          </h4>
          <div className="relative">
            <Input
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Rechercher un client existant (nom ou téléphone) — ou saisir les champs ci-dessous"
              icon={<Search size={16} />}
            />
            {clientResults.length > 0 && (
              <div className="mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-lg">
                {clientResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickClient(c.id)}
                    className="flex w-full items-center justify-between border-b border-gold/5 px-4 py-2 text-left text-sm last:border-0 hover:bg-gold/10"
                  >
                    <span className="font-semibold text-text-primary">{c.name}</span>
                    <span className="text-xs text-text-muted">{c.phone || '—'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Nom / raison sociale *" value={clientName} onChange={(e) => { setClientName(e.target.value); setClientId(undefined); }} />
            <Input label="Téléphone" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
            <Input label="Adresse" value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
            <Input label="R.C" value={clientRc} onChange={(e) => setClientRc(e.target.value)} />
            <Input label="NIF" value={clientNif} onChange={(e) => setClientNif(e.target.value)} />
            <Input label="NIS" value={clientNis} onChange={(e) => setClientNis(e.target.value)} />
            <Input label="N° article" value={clientArticle} onChange={(e) => setClientArticle(e.target.value)} />
          </div>
        </section>

        {docType === 'bon_livraison' && (
          <section className="space-y-3 rounded-2xl border border-gold/15 bg-vanilla/20 p-4">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-dark">
              <Truck size={14} /> Livraison
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input label="Lieu de livraison" value={location} onChange={(e) => setLocation(e.target.value)} icon={<MapPin size={15} />} />
              <Input label="Chauffeur" value={driverName} onChange={(e) => setDriverName(e.target.value)} icon={<User size={15} />} />
              <Input label="Matricule" value={driverPlate} onChange={(e) => setDriverPlate(e.target.value)} icon={<Hash size={15} />} />
            </div>
          </section>
        )}

        {/* -------------------------------------------------------- produits */}
        <section className="space-y-3 rounded-2xl border border-gold/15 bg-vanilla/20 p-4">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-dark">
            <Receipt size={14} /> Produits
          </h4>
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Ajouter un produit (fiche technique)…"
                icon={<Search size={16} />}
              />
              {productResults.length > 0 && (
                <div className="mt-1 w-full max-h-64 overflow-y-auto rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-lg">
                  {productResults.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => addFiche(f.id)}
                      className="flex w-full items-center justify-between border-b border-gold/5 px-4 py-2 text-left text-sm last:border-0 hover:bg-gold/10"
                    >
                      <span className="font-semibold text-text-primary">{f.name}</span>
                      <span className="text-xs text-gold-dark">{formatCurrency(f.unitPrice)}{f.sellByUnit && f.sellUnit ? ` / ${f.sellUnit}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button variant="secondary" onClick={addFreeLine}><Plus size={15} /> Ligne libre</Button>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gold/20 px-4 py-5 text-center text-sm text-text-muted">
              Aucun produit — ajoutez une fiche technique ou une ligne libre.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gold/15">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-vanilla/60 text-text-secondary">
                  <tr>
                    <th className="px-2 py-2 text-left">Désignation</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="w-24 px-2 py-2 text-center">Quantité</th>
                    <th className="w-20 px-2 py-2 text-center">Unité</th>
                    <th className="w-32 px-2 py-2 text-right">Prix U</th>
                    <th className="w-32 px-2 py-2 text-right">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key} className="border-t border-gold/10">
                      <td className="px-2 py-1.5"><input className={inputCls} value={l.productName} onChange={(e) => patchLine(l.key, { productName: e.target.value })} placeholder="Produit" /></td>
                      <td className="px-2 py-1.5"><input className={inputCls} value={l.description} onChange={(e) => patchLine(l.key, { description: e.target.value })} placeholder="Facultatif" /></td>
                      <td className="px-2 py-1.5"><input className={`${inputCls} text-center tabular`} type="number" step="any" min={0} value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: Math.max(0, Number(e.target.value)) })} /></td>
                      <td className="px-2 py-1.5"><input className={`${inputCls} text-center`} value={l.unit} onChange={(e) => patchLine(l.key, { unit: e.target.value })} placeholder="/" /></td>
                      <td className="px-2 py-1.5"><input className={`${inputCls} text-right tabular`} type="number" step="any" min={0} value={l.unitPrice} onChange={(e) => patchLine(l.key, { unitPrice: Math.max(0, Number(e.target.value)) })} /></td>
                      <td className="px-2 py-1.5 text-right tabular font-bold text-gold-dark">{formatCurrency((l.quantity || 0) * (l.unitPrice || 0))}</td>
                      <td className="px-2 py-1.5 text-center">
                        <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1 text-rose-deep hover:bg-rose-deep/10">
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------- totaux */}
        <section className="space-y-3 rounded-2xl border-2 border-gold/30 bg-gold/5 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Réduction" type="number" step="any" min={0} value={reduction} onChange={(e) => setReduction(Math.max(0, Number(e.target.value)))} />
            <div>
              <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-secondary">
                <input type="checkbox" checked={tvaEnabled} onChange={(e) => setTvaEnabled(e.target.checked)} className="h-4 w-4 accent-[#B91C1C]" />
                <Percent size={13} /> TVA
              </label>
              <Input type="number" step="any" min={0} max={100} value={tvaRate} disabled={!tvaEnabled} onChange={(e) => setTvaRate(Math.max(0, Number(e.target.value)))} />
            </div>
            <div>
              <Input label="Versement (affiché)" type="number" step="any" min={0} value={paidAmount} onChange={(e) => setPaidAmount(Math.max(0, Number(e.target.value)))} />
              <button type="button" onClick={() => setPaidAmount(totals.final)} className="mt-1 text-[11px] font-semibold text-gold-dark hover:underline">
                Réglée intégralement
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Money label="Total H.T" value={formatCurrency(totals.ht)} />
            <Money label="Réduction" value={formatCurrency(reduction || 0)} />
            <Money label={tvaEnabled ? `TVA ${tvaRate} %` : 'TVA'} value={formatCurrency(totals.tva)} />
            <Money label="Net à payer" value={formatCurrency(totals.final)} tone="text-gold-dark" />
            <Money label="Reste" value={formatCurrency(totals.rest)} tone={totals.rest > 0.004 ? 'text-rose-deep' : 'text-pistachio'} />
          </div>
        </section>

        <Textarea label="Observations (imprimées)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </Modal>
  );
}

function Money({ label, value, tone = 'text-text-primary' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2 text-center">
      <p className="text-[10px] uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${tone}`}>{value}</p>
    </div>
  );
}
