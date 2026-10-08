import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShoppingCart, Eye, Pencil, Check, X, Trash2, Phone, MapPin, User, UserCheck, UserPlus, Plus, Save, Globe,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { SearchBar } from '@/components/ui/SearchBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import {
  useWebsiteStore, ORDER_STATUS_LABEL, type WebsiteOrder, type WebsiteOrderItem, type WebsiteOrderStatus,
} from '@/store/websiteStore';
import { useClientStore } from '@/store/clientStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { siteUrl } from '@/lib/siteUrl';

const statusVariant: Record<WebsiteOrderStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning', accepted: 'success', cancelled: 'danger',
};

const digits = (p: string) => p.replace(/\D/g, '').slice(-9);

/** Client existant correspondant à la commande (affecté, détecté, ou même téléphone). */
function useMatchedClient(o: WebsiteOrder | null) {
  const clients = useClientStore((s) => s.clients);
  return useMemo(() => {
    if (!o) return undefined;
    const id = o.clientId || o.detectedClientId;
    if (id) return clients.find((c) => c.id === id);
    const d = digits(o.clientPhone);
    return d.length >= 8 ? clients.find((c) => digits(c.phone || '') === d) : undefined;
  }, [o, clients]);
}

function OrderCard({ o, index, onView, onEdit, onAccept, onCancel, onDelete }: {
  o: WebsiteOrder; index: number;
  onView: () => void; onEdit: () => void; onAccept: () => void; onCancel: () => void; onDelete: () => void;
}) {
  const { can } = usePermissions();
  const matched = useMatchedClient(o);
  const pending = o.status === 'pending';
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className="rounded-xl border border-gold/15 bg-gradient-card shadow-card p-4 flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-bold text-gold">{o.reference}</p>
          <p className="text-[11px] text-text-muted">{formatDateTime(o.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
          <ActionMenu items={[
            { label: 'Voir les détails', icon: <Eye size={15} />, onClick: onView },
            { label: 'Modifier', icon: <Pencil size={15} />, onClick: onEdit, hidden: !pending || !can('website', 'edit') },
            { label: 'Accepter', icon: <Check size={15} />, onClick: onAccept, hidden: !pending || !can('website', 'edit') },
            { label: 'Annuler', icon: <X size={15} />, onClick: onCancel, hidden: !pending || !can('website', 'edit') },
            { label: 'Supprimer', icon: <Trash2 size={15} />, onClick: onDelete, danger: true, hidden: !can('website', 'delete') },
          ]} />
        </div>
      </div>

      <div className="rounded-lg bg-vanilla/40 border border-gold/10 p-3 space-y-1 text-sm">
        <p className="font-semibold text-text-primary flex items-center gap-2"><User size={14} className="text-gold" /> {o.clientName}</p>
        {o.clientPhone && <p className="text-text-secondary flex items-center gap-2"><Phone size={13} /> {o.clientPhone}</p>}
        {o.clientAddress && <p className="text-text-secondary flex items-center gap-2"><MapPin size={13} /> {o.clientAddress}</p>}
        <div className="pt-1">
          {o.isAccount ? <Badge variant="info"><Globe size={11} /> Compte client</Badge>
            : matched ? <Badge variant="success"><UserCheck size={11} /> Client existant : {matched.name}</Badge>
            : <Badge variant="neutral"><UserPlus size={11} /> Nouveau client</Badge>}
        </div>
      </div>

      <ul className="text-sm divide-y divide-gold/10">
        {o.items.map((i) => (
          <li key={i.id ?? i.productName} className="flex justify-between gap-2 py-1.5">
            <span className="text-text-primary truncate">{i.productName}</span>
            <span className="text-text-secondary whitespace-nowrap">{i.quantity}{i.sellUnit ? ` ${i.sellUnit}` : ''} × {formatCurrency(i.unitPrice)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex items-center justify-between pt-2 border-t border-gold/10">
        <span className="text-xs uppercase tracking-wider text-text-muted">Total</span>
        <span className="text-lg font-bold text-gold">{formatCurrency(o.totalAmount)}</span>
      </div>
      {pending && can('website', 'edit') && (
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="mint" onClick={onAccept}><Check size={14} /> Accepter</Button>
          <Button size="sm" variant="secondary" onClick={onCancel}><X size={14} /> Annuler</Button>
        </div>
      )}
    </motion.div>
  );
}

function OrderDetails({ o, onClose }: { o: WebsiteOrder; onClose: () => void }) {
  const matched = useMatchedClient(o);
  const row = (label: string, value?: string) => value ? (
    <div className="rounded-lg bg-vanilla/40 border border-gold/10 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="text-sm text-text-primary whitespace-pre-line break-words">{value}</p>
    </div>
  ) : null;
  return (
    <Modal open onClose={onClose} title={`Commande ${o.reference}`} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={statusVariant[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
          {o.isAccount && <Badge variant="info">Passée depuis un compte client</Badge>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {row('Date', formatDateTime(o.createdAt))}
          {row('Client', o.clientName)}
          {row('Téléphone', o.clientPhone)}
          {row('Adresse', o.clientAddress)}
          {row('Client dans la base', matched ? `${matched.name} (${matched.phone || '—'})` : 'Non trouvé — sera créé à l’acceptation')}
          {row('R.C', o.rc)}{row('NIF', o.nif)}{row('NIS', o.nis)}{row('Article', o.article)}
          {row('Note client', o.clientNote)}
          {row('Message de la commande', o.notes)}
          {o.acceptedAt && row('Acceptée le', `${formatDateTime(o.acceptedAt)}${o.handledBy ? ` par ${o.handledBy}` : ''}`)}
          {o.cancelledAt && row('Annulée le', `${formatDateTime(o.cancelledAt)}${o.handledBy ? ` par ${o.handledBy}` : ''}`)}
          {row("Motif d'annulation", o.cancelReason)}
        </div>
        <div className="overflow-x-auto rounded-lg border border-gold/15">
          <table className="w-full text-sm">
            <thead className="bg-vanilla/60 text-text-secondary text-xs uppercase">
              <tr><th className="text-left p-2">Produit</th><th className="text-right p-2">Qté</th><th className="text-right p-2">P.U</th><th className="text-right p-2">Total</th></tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.id ?? i.productName} className="border-t border-gold/10">
                  <td className="p-2 text-text-primary">{i.productName}</td>
                  <td className="p-2 text-right">{i.quantity}{i.sellUnit ? ` ${i.sellUnit}` : ''}</td>
                  <td className="p-2 text-right">{formatCurrency(i.unitPrice)}</td>
                  <td className="p-2 text-right font-semibold">{formatCurrency(i.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-gold/20 bg-vanilla/40">
              <td colSpan={3} className="p-2 text-right font-semibold">Total</td>
              <td className="p-2 text-right font-bold text-gold">{formatCurrency(o.totalAmount)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>
    </Modal>
  );
}

function OrderEditModal({ o, onClose }: { o: WebsiteOrder; onClose: () => void }) {
  const updateOrder = useWebsiteStore((s) => s.updateOrder);
  const clients = useClientStore((s) => s.clients);
  const fiches = useFicheTechnicStore((s) => s.ficheTechnics);
  const [form, setForm] = useState({
    clientId: o.clientId ?? '', clientName: o.clientName, clientPhone: o.clientPhone, clientAddress: o.clientAddress,
    clientNote: o.clientNote, rc: o.rc, nif: o.nif, nis: o.nis, article: o.article, notes: o.notes,
  });
  const [items, setItems] = useState<WebsiteOrderItem[]>(o.items.map((i) => ({ ...i })));
  const [busy, setBusy] = useState(false);

  const setItem = (idx: number, patch: Partial<WebsiteOrderItem>) =>
    setItems(items.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, ...patch };
      next.totalPrice = Math.round(next.quantity * next.unitPrice * 100) / 100;
      return next;
    }));
  const pickProduct = (idx: number, ficheId: string) => {
    const f = fiches.find((x) => x.id === ficheId);
    if (!f) return;
    setItem(idx, {
      ficheTechnicId: f.id, productName: f.webName || f.name,
      unitPrice: f.webPrice ?? f.unitPrice, sellUnit: f.sellUnit || f.productUnit,
    });
  };
  const chooseClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    setForm(c ? { ...form, clientId: c.id, clientName: c.name, clientPhone: c.phone, clientAddress: c.address || form.clientAddress }
      : { ...form, clientId: '' });
  };
  const total = items.reduce((a, i) => a + i.totalPrice, 0);

  const submit = async () => {
    if (!form.clientName.trim()) { toast.error('Nom du client requis'); return; }
    const valid = items.filter((i) => i.productName && i.quantity > 0);
    if (valid.length === 0) { toast.error('Ajoutez au moins un produit'); return; }
    setBusy(true);
    try {
      await updateOrder(o.id, { ...form, clientId: form.clientId || null, items: valid });
      toast.success('Commande modifiée');
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Modifier ${o.reference}`} size="lg"
      footer={<div className="flex items-center justify-between gap-2">
        <span className="font-bold text-gold">Total : {formatCurrency(total)}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={busy}><Save size={15} /> Enregistrer</Button>
        </div>
      </div>}
    >
      <div className="space-y-4">
        <Select label="Affecter à un client existant" value={form.clientId} onChange={(e) => chooseClient(e.target.value)}
          options={[{ value: '', label: '— Détection automatique / nouveau client —' },
            ...clients.map((c) => ({ value: c.id, label: `${c.name}${c.phone ? ` — ${c.phone}` : ''}` }))]} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Nom *" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
          <Input label="Téléphone" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} />
          <Input label="Adresse" value={form.clientAddress} onChange={(e) => setForm({ ...form, clientAddress: e.target.value })} />
          <Input label="R.C" value={form.rc} onChange={(e) => setForm({ ...form, rc: e.target.value })} />
          <Input label="NIF" value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} />
          <Input label="NIS" value={form.nis} onChange={(e) => setForm({ ...form, nis: e.target.value })} />
          <Input label="Article" value={form.article} onChange={(e) => setForm({ ...form, article: e.target.value })} />
          <Input label="Note client" value={form.clientNote} onChange={(e) => setForm({ ...form, clientNote: e.target.value })} />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">Produits</p>
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-12 sm:col-span-5">
                <Select value={it.ficheTechnicId ?? ''} onChange={(e) => pickProduct(idx, e.target.value)}
                  options={[{ value: '', label: it.productName || 'Choisir…' }, ...fiches.map((f) => ({ value: f.id, label: f.webName || f.name }))]} />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <Input type="number" min={0} step="any" value={String(it.quantity)} onChange={(e) => setItem(idx, { quantity: Number(e.target.value) || 0 })} />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <Input type="number" min={0} step="0.01" value={String(it.unitPrice)} onChange={(e) => setItem(idx, { unitPrice: Number(e.target.value) || 0 })} />
              </div>
              <div className="col-span-3 sm:col-span-2 text-right text-sm font-semibold pb-2.5">{formatCurrency(it.totalPrice)}</div>
              <div className="col-span-1 pb-1">
                <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== idx))} aria-label="Retirer"><Trash2 size={15} /></Button>
              </div>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setItems([...items, { productName: '', quantity: 1, unitPrice: 0, totalPrice: 0 }])}>
            <Plus size={14} /> Ajouter un produit
          </Button>
        </div>
        <Textarea label="Message de la commande" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
    </Modal>
  );
}

function AcceptModal({ o, onClose }: { o: WebsiteOrder; onClose: () => void }) {
  const acceptOrder = useWebsiteStore((s) => s.acceptOrder);
  const clients = useClientStore((s) => s.clients);
  const matched = useMatchedClient(o);
  const [clientId, setClientId] = useState(matched?.id ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await acceptOrder(o.id, clientId || null);
      toast.success(r.clientCreated ? 'Commande acceptée — nouveau client créé' : 'Commande acceptée et ajoutée aux Commandes');
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Accepter ${o.reference}`} size="sm"
      footer={<div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Retour</Button>
        <Button variant="mint" onClick={submit} disabled={busy}><Check size={15} /> Accepter</Button>
      </div>}
    >
      <div className="space-y-3 text-sm">
        <p className="text-text-secondary">
          La commande passe dans l'écran <strong>Commandes</strong> et ses quantités s'ajoutent au total commandé de chaque produit.
        </p>
        <Select label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}
          options={[{ value: '', label: `➕ Créer « ${o.clientName} » automatiquement` },
            ...clients.map((c) => ({ value: c.id, label: `${c.name}${c.phone ? ` — ${c.phone}` : ''}` }))]} />
        {matched && <p className="text-xs text-pistachio">Client détecté par le téléphone : {matched.name}</p>}
        <p className="font-semibold text-text-primary">Total : {formatCurrency(o.totalAmount)}</p>
      </div>
    </Modal>
  );
}

function CancelModal({ o, onClose }: { o: WebsiteOrder; onClose: () => void }) {
  const cancelOrder = useWebsiteStore((s) => s.cancelOrder);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Annuler ${o.reference}`} size="sm"
      footer={<div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Retour</Button>
        <Button variant="danger" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await cancelOrder(o.id, reason.trim()); toast.success('Commande annulée'); onClose(); }
          catch (e) { toast.error((e as Error).message); }
          finally { setBusy(false); }
        }}><X size={15} /> Annuler la commande</Button>
      </div>}
    >
      <Textarea label="Motif (facultatif)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="mt-2 text-xs text-text-muted">La commande reste visible dans l'historique du client.</p>
    </Modal>
  );
}

export default function WebsiteOrdersPage() {
  const orders = useWebsiteStore((s) => s.orders);
  const deleteOrder = useWebsiteStore((s) => s.deleteOrder);
  const loadOrders = useWebsiteStore((s) => s.loadOrders);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | WebsiteOrderStatus>('pending');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewing, setViewing] = useState<WebsiteOrder | null>(null);
  const [editing, setEditing] = useState<WebsiteOrder | null>(null);
  const [accepting, setAccepting] = useState<WebsiteOrder | null>(null);
  const [cancelling, setCancelling] = useState<WebsiteOrder | null>(null);
  const [deleting, setDeleting] = useState<WebsiteOrder | null>(null);

  const counts = useMemo(() => ({
    pending: orders.filter((o) => o.status === 'pending').length,
    accepted: orders.filter((o) => o.status === 'accepted').length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
  }), [orders]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (status && o.status !== status) return false;
      const day = o.createdAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return !q || `${o.reference} ${o.clientName} ${o.clientPhone} ${o.clientAddress} ${o.items.map((i) => i.productName).join(' ')}`
        .toLowerCase().includes(q);
    });
  }, [orders, query, status, from, to]);

  return (
    <div>
      <PageHeader
        title="Commandes du site"
        subtitle="Commandes passées par les clients sur le site web"
        icon={<ShoppingCart size={22} />}
        actions={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => { void loadOrders(); }}>Actualiser</Button>
          <Button variant="secondary" onClick={() => window.open(siteUrl(), '_blank')}><Globe size={15} /> Ouvrir le site</Button>
        </div>}
      />
      <div className="flex flex-wrap gap-2 mb-4">
        {([['pending', 'En attente'], ['accepted', 'Acceptées'], ['cancelled', 'Annulées'], ['', 'Toutes']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setStatus(k)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${status === k ? 'bg-gradient-button text-white border-transparent shadow-gold' : 'border-gold/20 text-text-secondary hover:text-gold'}`}>
            {label}{k ? ` (${counts[k]})` : ` (${orders.length})`}
          </button>
        ))}
      </div>
      <div className="flex flex-col md:flex-row gap-3 mb-5">
        <SearchBar value={query} onChange={setQuery} placeholder="Client, téléphone, référence, produit…" className="md:max-w-md" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="md:w-44" aria-label="Du" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="md:w-44" aria-label="Au" />
      </div>
      {list.length === 0 ? (
        <EmptyState message="Aucune commande du site" icon={<ShoppingCart size={30} />} />
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {list.map((o, i) => (
            <OrderCard key={o.id} o={o} index={i}
              onView={() => setViewing(o)} onEdit={() => setEditing(o)} onAccept={() => setAccepting(o)}
              onCancel={() => setCancelling(o)} onDelete={() => setDeleting(o)} />
          ))}
        </div>
      )}
      {viewing && <OrderDetails o={viewing} onClose={() => setViewing(null)} />}
      {editing && <OrderEditModal o={editing} onClose={() => setEditing(null)} />}
      {accepting && <AcceptModal o={accepting} onClose={() => setAccepting(null)} />}
      {cancelling && <CancelModal o={cancelling} onClose={() => setCancelling(null)} />}
      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)}
        title={`Supprimer ${deleting?.reference ?? ''} ?`}
        message={deleting?.status === 'accepted' ? 'La commande créée dans l’écran Commandes est conservée.' : undefined}
        onConfirm={async () => {
          if (!deleting) return;
          try { await deleteOrder(deleting.id); toast.success('Commande supprimée'); } catch (e) { toast.error((e as Error).message); }
          setDeleting(null);
        }}
      />
    </div>
  );
}
