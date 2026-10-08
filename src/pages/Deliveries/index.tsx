import { useMemo, useState } from 'react';
import {
  Truck, Plus, Eye, Pencil, Trash2, Printer, RotateCcw, PackageCheck, Wallet, Receipt, Undo2,
  Factory, MapPin, User, Hash, CalendarClock, FileText,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SearchBar } from '@/components/ui/SearchBar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import type { ActionItem } from '@/components/ui/ActionMenu';
import { StatCard } from '@/components/shared/StatCard';
import { PrintTitleDialog, type PrintTitleRequest } from '@/components/shared/PrintTitleDialog';
import { toast } from '@/components/ui/Toast';
import { useCommandStore } from '@/store/commandStore';
import { useClientStore } from '@/store/clientStore';
import { useProductionStore } from '@/store/productionStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDateTime, formatNumber, matchesDateFilter, type DateFilter } from '@/lib/utils';
import { recoveredOnLine } from '@/lib/readyStock';
import { printDeliveryFor, printRecoveryFor } from '@/lib/deliveryDocs';
import type { CommandDelivery, DeliveryRecovery } from '@/types';
import { ClientDeliveryForm } from './ClientDeliveryForm';
import { RecoveryModal } from './RecoveryModal';

type Tab = 'deliveries' | 'recoveries';
type SourceFilter = 'all' | 'livraison' | 'command';
type StatusFilter = 'all' | 'debt' | 'paid' | 'recovered';

const q = (n: number) => formatNumber(Math.round((n || 0) * 1000) / 1000);

/**
 * LIVRAISONS — tous les bons de livraison de l'entreprise.
 *
 * « Nouvelle livraison » part du CLIENT : on choisit ses produits, l'écran
 * rappelle ce qu'il a commandé et pas encore reçu, ainsi que le stock prêt.
 * Chaque bon peut être consulté, imprimé, modifié (tout est recalculé :
 * facture, commande, stock prêt, production, caisse) ou faire l'objet d'une
 * RÉCUPÉRATION (la marchandise revient au stock prêt, l'argent au client).
 */
export default function DeliveriesPage() {
  const { language } = useLanguage();
  const { can } = usePermissions();
  const settings = useSettingsStore((s) => s.settings);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const recoveries = useCommandStore((s) => s.recoveries);
  const deleteDelivery = useCommandStore((s) => s.deleteDelivery);
  const deleteRecovery = useCommandStore((s) => s.deleteRecovery);
  const clients = useClientStore((s) => s.clients);
  const refunds = useClientStore((s) => s.refunds);
  const productions = useProductionStore((s) => s.productions);

  const [tab, setTab] = useState<Tab>('deliveries');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CommandDelivery | null>(null);
  const [viewing, setViewing] = useState<CommandDelivery | null>(null);
  const [recovering, setRecovering] = useState<CommandDelivery | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [cancelRecovery, setCancelRecovery] = useState<DeliveryRecovery | null>(null);
  const [printPrompt, setPrintPrompt] = useState<CommandDelivery[] | null>(null);
  const [recoveryPrompt, setRecoveryPrompt] = useState<DeliveryRecovery | null>(null);
  const [titleRequest, setTitleRequest] = useState<PrintTitleRequest | null>(null);

  const commandOf = (d: CommandDelivery) => commands.find((c) => c.id === d.commandId);
  const clientOf = (d: CommandDelivery) => {
    const cmd = commandOf(d);
    return clients.find((c) => c.id === cmd?.clientId);
  };
  const refundOf = (r: DeliveryRecovery) =>
    r.refundId ? (refunds.find((x) => x.id === r.refundId)?.amount ?? r.refundAmount) : r.refundAmount;

  /* -------------------------------------------------------------- liste */
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...deliveries]
      .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt))
      .filter((d) => {
        const cmd = commands.find((c) => c.id === d.commandId);
        if (source !== 'all' && (d.source ?? 'command') !== source) return false;
        if (status === 'debt' && (d.restAmount ?? 0) <= 0.004) return false;
        if (status === 'paid' && (d.restAmount ?? 0) > 0.004) return false;
        if (status === 'recovered' && !(d.recoveredQuantity && d.recoveredQuantity > 0)) return false;
        if (!matchesDateFilter(d.deliveredAt, dateFilter)) return false;
        if (!term) return true;
        const hay = [
          d.reference, d.saleReference, cmd?.reference, cmd?.clientName, cmd?.clientPhone, cmd?.bonNumber,
          d.location, d.driverName, ...d.items.map((i) => i.productName),
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(term);
      });
  }, [deliveries, commands, search, source, status, dateFilter]);

  const stats = useMemo(() => {
    const qty = rows.reduce((s, d) => s + d.items.reduce((a, i) => a + i.quantity, 0) - (d.recoveredQuantity ?? 0), 0);
    return {
      count: rows.length,
      qty,
      value: rows.reduce((s, d) => s + (d.totalTtc ?? 0), 0),
      rest: rows.reduce((s, d) => s + (d.restAmount ?? 0), 0),
      recovered: rows.reduce((s, d) => s + (d.recoveredQuantity ?? 0), 0),
    };
  }, [rows]);

  const recoveryRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...recoveries]
      .sort((a, b) => b.recoveredAt.localeCompare(a.recoveredAt))
      .filter((r) => {
        if (!matchesDateFilter(r.recoveredAt, dateFilter)) return false;
        if (!term) return true;
        const d = deliveries.find((x) => x.id === r.deliveryId);
        return [r.reference, r.clientName, d?.reference, r.reason, ...r.items.map((i) => i.productName)]
          .filter(Boolean).join(' ').toLowerCase().includes(term);
      });
  }, [recoveries, deliveries, search, dateFilter]);

  /* ---------------------------------------------------------- impression */
  const askPrintDelivery = (d: CommandDelivery) =>
    setTitleRequest({
      defaultTitle: d.isHistorical ? 'ANCIENNE LIVRAISON' : 'BON DE LIVRAISON',
      scope: 'delivery',
      dialogTitle: `Imprimer le bon ${d.reference}`,
      print: ({ title, endText }) => {
        const fresh = useCommandStore.getState().deliveries.find((x) => x.id === d.id) ?? d;
        const cmd = useCommandStore.getState().commands.find((c) => c.id === fresh.commandId);
        const cli = clients.find((c) => c.id === cmd?.clientId);
        printDeliveryFor(fresh, cmd, cli, settings, title, endText, useCommandStore.getState().recoveries);
      },
    });

  const askPrintRecovery = (r: DeliveryRecovery) =>
    setTitleRequest({
      defaultTitle: 'BON DE RÉCUPÉRATION',
      scope: 'delivery',
      dialogTitle: `Imprimer le bon ${r.reference}`,
      print: ({ title, endText }) => {
        const d = deliveries.find((x) => x.id === r.deliveryId);
        const cmd = d ? commandOf(d) : undefined;
        const cli = clients.find((c) => c.id === (r.clientId ?? cmd?.clientId));
        printRecoveryFor(r, d, cmd, cli, refundOf(r), settings, title, endText);
      },
    });

  /* ------------------------------------------------------------ colonnes */
  const columns: DataColumn<CommandDelivery>[] = [
    {
      key: 'ref', label: 'N° BL',
      render: (d) => (
        <span className="flex items-center gap-1.5 font-bold text-gold">
          {d.reference}
          {d.source === 'livraison' && <Badge variant="info" className="px-1.5 py-0 text-[9px]">Livraisons</Badge>}
          {d.isHistorical && <Badge variant="warning" className="px-1.5 py-0 text-[9px]">Ancienne</Badge>}
        </span>
      ),
    },
    { key: 'date', label: 'Date', render: (d) => formatDateTime(d.deliveredAt, language) },
    {
      key: 'client', label: 'Client',
      render: (d) => {
        const cmd = commandOf(d);
        return (
          <div className="min-w-0">
            <p className="font-semibold text-text-primary truncate">{cmd?.clientName ?? '—'}</p>
            <p className="text-[11px] text-text-muted">{cmd?.reference ?? ''}</p>
          </div>
        );
      },
    },
    {
      key: 'products', label: 'Produits', hideOnMobile: true,
      render: (d) => <span className="text-xs">{d.items.map((i) => `${i.productName} (${q(i.quantity)})`).join(' · ')}</span>,
    },
    {
      key: 'qty', label: 'Quantité', align: 'right',
      render: (d) => {
        const total = d.items.reduce((s, i) => s + i.quantity, 0);
        const back = d.recoveredQuantity ?? 0;
        return (
          <span className="tabular">
            {q(total - back)}
            {back > 0 && <span className="ml-1 text-[10px] font-semibold text-caramel">(−{q(back)} récup.)</span>}
          </span>
        );
      },
    },
    { key: 'ttc', label: 'Total TTC', align: 'right', render: (d) => formatCurrency(d.totalTtc ?? 0) },
    { key: 'paid', label: 'Payé', align: 'right', hideOnMobile: true, render: (d) => <span className="text-pistachio">{formatCurrency(d.paidAmount ?? 0)}</span> },
    {
      key: 'rest', label: 'Reste', align: 'right',
      render: (d) => (d.restAmount ?? 0) > 0.004
        ? <span className="font-bold text-rose-deep">{formatCurrency(d.restAmount ?? 0)}</span>
        : <Badge variant="success">Réglé</Badge>,
    },
  ];

  const actions = (d: CommandDelivery): ActionItem[] => [
    { label: 'Voir les détails', icon: <Eye size={15} />, onClick: () => setViewing(d) },
    { label: 'Imprimer le bon de livraison', icon: <Printer size={15} />, onClick: () => askPrintDelivery(d) },
    {
      label: 'Modifier', icon: <Pencil size={15} />,
      hidden: !can('clients', 'edit') || !!d.isHistorical,
      onClick: () => { setEditing(d); setFormOpen(true); },
    },
    {
      label: 'Récupérer la marchandise', icon: <RotateCcw size={15} />,
      hidden: !can('clients', 'edit'),
      disabled: d.items.reduce((s, i) => s + i.quantity, 0) - (d.recoveredQuantity ?? 0) <= 0.0005,
      onClick: () => setRecovering(d),
    },
    {
      label: 'Supprimer', icon: <Trash2 size={15} />, danger: true,
      hidden: !can('clients', 'delete'),
      onClick: () => setDeleteId(d.id),
    },
  ];

  const recoveryColumns: DataColumn<DeliveryRecovery>[] = [
    { key: 'ref', label: 'N°', render: (r) => <span className="font-bold text-gold">{r.reference}</span> },
    { key: 'date', label: 'Date', render: (r) => formatDateTime(r.recoveredAt, language) },
    { key: 'client', label: 'Client', render: (r) => <span className="font-semibold">{r.clientName ?? '—'}</span> },
    {
      key: 'bl', label: 'Bon d\'origine', hideOnMobile: true,
      render: (r) => deliveries.find((d) => d.id === r.deliveryId)?.reference ?? '—',
    },
    {
      key: 'products', label: 'Produits', hideOnMobile: true,
      render: (r) => <span className="text-xs">{r.items.map((i) => `${i.productName} (${q(i.quantity)})`).join(' · ')}</span>,
    },
    { key: 'ttc', label: 'Valeur', align: 'right', render: (r) => formatCurrency(r.totalTtc) },
    {
      key: 'refund', label: 'Remboursé', align: 'right',
      render: (r) => {
        const v = refundOf(r);
        return v > 0
          ? <span className="font-bold text-caramel">− {formatCurrency(v)}</span>
          : r.excessAmount > 0
            ? <Badge variant="success">En acompte</Badge>
            : <span className="text-text-muted">—</span>;
      },
    },
  ];

  const recoveryActions = (r: DeliveryRecovery): ActionItem[] => [
    { label: 'Imprimer le bon de récupération', icon: <Printer size={15} />, onClick: () => askPrintRecovery(r) },
    {
      label: 'Voir le bon de livraison', icon: <Eye size={15} />,
      onClick: () => { const d = deliveries.find((x) => x.id === r.deliveryId); if (d) setViewing(d); },
    },
    {
      label: 'Annuler la récupération', icon: <Trash2 size={15} />, danger: true,
      hidden: !can('clients', 'delete'),
      onClick: () => setCancelRecovery(r),
    },
  ];

  /* --------------------------------------------------------------- rendu */
  return (
    <div className="space-y-6">
      <PageHeader
        title="Livraisons"
        subtitle={`${deliveries.length} bon(s) de livraison · ${recoveries.length} récupération(s)`}
        icon={<Truck size={24} />}
        actions={
          can('clients', 'create') && (
            <Button variant="gold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus size={18} /> Nouvelle livraison
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Bons de livraison" value={stats.count} icon={<Truck size={22} />} index={0} accent="gold" />
        <StatCard label="Quantité livrée" value={stats.qty} icon={<PackageCheck size={22} />} index={1} accent="pistachio" />
        <StatCard label="Valeur livrée (TTC)" value={stats.value} format="currency" icon={<Receipt size={22} />} index={2} accent="caramel" />
        <StatCard label="Reste dû" value={stats.rest} format="currency" icon={<Wallet size={22} />} index={3} accent="rose" />
      </div>

      <div className="flex border-b border-gold/15">
        {([
          ['deliveries', 'Bons de livraison', <Truck key="t" size={16} />],
          ['recoveries', `Récupérations (${recoveries.length})`, <Undo2 key="r" size={16} />],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-[2px] flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition-all ${
              tab === id ? 'border-gold-dark text-gold-dark' : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {icon}<span>{label}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un bon, un client, un produit…" />
        </div>
        <div className="w-full sm:w-[210px]">
          <Select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            options={[
              { value: 'all', label: 'Toutes les dates' },
              { value: 'today', label: "Aujourd'hui" },
              { value: 'week', label: 'Cette semaine' },
              { value: 'month', label: 'Ce mois' },
            ]}
          />
        </div>
        {tab === 'deliveries' && (
          <>
            <div className="w-full sm:w-[250px]">
              <Select
                value={source}
                onChange={(e) => setSource(e.target.value as SourceFilter)}
                options={[
                  { value: 'all', label: 'Toutes les origines' },
                  { value: 'livraison', label: 'Créés ici (Livraisons)' },
                  { value: 'command', label: 'Créés depuis Commandes' },
                ]}
              />
            </div>
            <div className="w-full sm:w-[230px]">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                options={[
                  { value: 'all', label: 'Tous les états' },
                  { value: 'debt', label: 'Avec reste dû' },
                  { value: 'paid', label: 'Réglés' },
                  { value: 'recovered', label: 'Avec récupération' },
                ]}
              />
            </div>
          </>
        )}
      </div>

      {tab === 'deliveries' ? (
        rows.length === 0 ? (
          <EmptyState message="Aucun bon de livraison" icon={<Truck size={32} />} />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(d) => d.id}
            actions={actions}
            onRowClick={(d) => setViewing(d)}
          />
        )
      ) : recoveryRows.length === 0 ? (
        <EmptyState message="Aucune récupération" icon={<Undo2 size={32} />} />
      ) : (
        <DataTable rows={recoveryRows} columns={recoveryColumns} rowKey={(r) => r.id} actions={recoveryActions} />
      )}

      {/* ------------------------------------------------ création / modification */}
      <ClientDeliveryForm
        open={formOpen}
        editing={editing}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSaved={(list) => {
          setFormOpen(false);
          setEditing(null);
          if (list.length) setPrintPrompt(list);
        }}
      />

      {/* --------------------------------------------- imprimer après création */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} title="Imprimer le bon de livraison ?" size="sm">
        {printPrompt && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              {printPrompt.length > 1
                ? `${printPrompt.length} bons ont été enregistrés. Imprimez-les :`
                : `Le bon ${printPrompt[0].reference} est enregistré. Voulez-vous l'imprimer ?`}
            </p>
            <div className="space-y-2">
              {printPrompt.map((d) => (
                <Button key={d.id} variant="gold" className="w-full" onClick={() => askPrintDelivery(d)}>
                  <Printer size={16} /> Imprimer {d.reference} · {formatCurrency(d.totalTtc ?? 0)}
                </Button>
              ))}
            </div>
            <Button variant="secondary" className="w-full" onClick={() => setPrintPrompt(null)}>Plus tard</Button>
          </div>
        )}
      </Modal>

      {/* ----------------------------------------------------------- détails */}
      <DeliveryDetails
        delivery={viewing ? deliveries.find((d) => d.id === viewing.id) ?? viewing : null}
        onClose={() => setViewing(null)}
        onPrint={askPrintDelivery}
        onEdit={can('clients', 'edit') ? (d) => { setViewing(null); setEditing(d); setFormOpen(true); } : undefined}
        onRecover={can('clients', 'edit') ? (d) => { setViewing(null); setRecovering(d); } : undefined}
        onPrintRecovery={askPrintRecovery}
        refundOf={refundOf}
        productions={productions}
      />

      {/* -------------------------------------------------------- récupération */}
      <RecoveryModal
        delivery={recovering}
        onClose={() => setRecovering(null)}
        onSaved={(r) => { setRecovering(null); setRecoveryPrompt(r); }}
      />

      <Modal open={!!recoveryPrompt} onClose={() => setRecoveryPrompt(null)} title="Imprimer le bon de récupération ?" size="sm">
        {recoveryPrompt && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              La récupération {recoveryPrompt.reference} est enregistrée : la marchandise est revenue au stock prêt
              {refundOf(recoveryPrompt) > 0 ? ` et ${formatCurrency(refundOf(recoveryPrompt))} ont été rendus au client` : ''}.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setRecoveryPrompt(null)}>Plus tard</Button>
              <Button
                variant="gold"
                className="flex-1"
                onClick={() => { const r = recoveryPrompt; setRecoveryPrompt(null); askPrintRecovery(r); }}
              >
                <Printer size={16} /> Imprimer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Supprimer le bon de livraison"
        message="La facture du bon, ses encaissements, sa production automatique et ses récupérations disparaissent ; les quantités redeviennent « à livrer » sur la commande."
        onConfirm={() => {
          if (deleteId) void deleteDelivery(deleteId).then(() => toast.success('Bon de livraison supprimé'));
        }}
      />
      <ConfirmDialog
        open={!!cancelRecovery}
        onClose={() => setCancelRecovery(null)}
        title="Annuler la récupération"
        message="La marchandise repart chez le client : elle quitte le stock prêt, la facture du bon remonte et le remboursement est annulé."
        onConfirm={() => {
          if (cancelRecovery) void deleteRecovery(cancelRecovery.id).then(() => toast.success('Récupération annulée'));
        }}
      />

      <PrintTitleDialog request={titleRequest} onClose={() => setTitleRequest(null)} />
    </div>
  );
}

/* ============================================================================
 *  DÉTAILS D'UN BON DE LIVRAISON
 * ========================================================================== */
function DeliveryDetails({
  delivery, onClose, onPrint, onEdit, onRecover, onPrintRecovery, refundOf, productions,
}: {
  delivery: CommandDelivery | null;
  onClose: () => void;
  onPrint: (d: CommandDelivery) => void;
  onEdit?: (d: CommandDelivery) => void;
  onRecover?: (d: CommandDelivery) => void;
  onPrintRecovery: (r: DeliveryRecovery) => void;
  refundOf: (r: DeliveryRecovery) => number;
  productions: ReturnType<typeof useProductionStore.getState>['productions'];
}) {
  const { language } = useLanguage();
  const commands = useCommandStore((s) => s.commands);
  const recoveries = useCommandStore((s) => s.recoveries);
  const command = delivery ? commands.find((c) => c.id === delivery.commandId) : undefined;
  const myRecoveries = delivery ? recoveries.filter((r) => r.deliveryId === delivery.id) : [];
  const autoProductions = delivery ? productions.filter((p) => p.deliveryId === delivery.id) : [];

  return (
    <Modal open={!!delivery} onClose={onClose} title={delivery ? `Bon de livraison ${delivery.reference}` : ''} size="lg">
      {delivery && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gold/20 bg-gradient-card px-4 py-3">
              <p className="text-xs text-text-muted">Client</p>
              <p className="font-bold text-text-primary">{command?.clientName ?? '—'}</p>
              {command?.clientPhone && <p className="text-xs text-text-muted">📞 {command.clientPhone}</p>}
              <p className="mt-1 text-[11px] text-text-muted">
                Commande {command?.reference ?? '—'}{command?.bonNumber ? ` · bon n° ${command.bonNumber}` : ''}
              </p>
            </div>
            <div className="space-y-1 rounded-xl border border-gold/20 bg-gradient-card px-4 py-3 text-xs">
              <p className="flex items-center gap-1.5"><CalendarClock size={12} className="text-gold" /> {formatDateTime(delivery.deliveredAt, language)}</p>
              <p className="flex items-center gap-1.5"><MapPin size={12} className="text-gold" /> {delivery.location || command?.clientAddress || '—'}</p>
              <p className="flex items-center gap-1.5"><User size={12} className="text-gold" /> {delivery.driverName || '—'}{delivery.driverPlate ? ` · ` : ''}{delivery.driverPlate && <><Hash size={11} />{delivery.driverPlate}</>}</p>
              <p className="flex items-center gap-1.5"><FileText size={12} className="text-gold" /> Facture {delivery.saleReference ?? '—'}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gold/15">
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60 text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Produit</th>
                  <th className="px-3 py-2 text-center">Livré</th>
                  <th className="px-3 py-2 text-center">Du stock prêt</th>
                  <th className="px-3 py-2 text-center">Produit auto.</th>
                  <th className="px-3 py-2 text-center">Récupéré</th>
                  <th className="px-3 py-2 text-right">P.U.</th>
                  <th className="px-3 py-2 text-right">Montant H.T</th>
                </tr>
              </thead>
              <tbody>
                {delivery.items.map((it, i) => {
                  const line = command?.items.find((x) => x.id === it.commandItemId);
                  const back = it.commandItemId ? recoveredOnLine(recoveries, delivery.id, it.commandItemId) : 0;
                  const price = line?.unitPrice ?? 0;
                  const u = it.sellUnit ? ` ${it.sellUnit}` : '';
                  return (
                    <tr key={`${it.commandItemId}-${i}`} className="border-t border-gold/10">
                      <td className="px-3 py-2 font-medium text-text-primary">{it.productName}</td>
                      <td className="px-3 py-2 text-center tabular font-semibold">{q(it.quantity)}{u}</td>
                      <td className="px-3 py-2 text-center tabular text-pistachio">{it.readyApplied ? `${q(it.fromReady ?? 0)}${u}` : '—'}</td>
                      <td className="px-3 py-2 text-center tabular text-caramel">{it.readyApplied ? `${q(it.producedQuantity ?? 0)}${u}` : '—'}</td>
                      <td className="px-3 py-2 text-center tabular text-rose-deep">{back > 0 ? `− ${q(back)}${u}` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular">{formatCurrency(price)}</td>
                      <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">{formatCurrency((it.quantity - back) * price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Tile label="Total H.T" value={formatCurrency(delivery.totalHt ?? 0)} />
            <Tile label={delivery.tvaEnabled ? `TVA ${delivery.tvaRate} %` : 'TVA'} value={formatCurrency(delivery.tvaAmount ?? 0)} />
            <Tile label="Net à payer" value={formatCurrency(delivery.totalTtc ?? 0)} tone="text-gold-dark" />
            <Tile label="Payé" value={formatCurrency(delivery.paidAmount ?? 0)} tone="text-pistachio" />
            <Tile label="Reste" value={formatCurrency(delivery.restAmount ?? 0)} tone={(delivery.restAmount ?? 0) > 0.004 ? 'text-rose-deep' : 'text-pistachio'} />
          </div>
          {((delivery.advanceApplied ?? 0) > 0 || (delivery.cashPaid ?? 0) > 0) && (
            <p className="text-xs text-text-muted">
              Acompte de la commande imputé : <b>{formatCurrency(delivery.advanceApplied ?? 0)}</b> · encaissé à la
              remise : <b>{formatCurrency(delivery.cashPaid ?? 0)}</b>
            </p>
          )}

          {autoProductions.length > 0 && (
            <div className="rounded-xl border border-caramel/30 bg-caramel/5 px-4 py-3 text-xs">
              <p className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wider text-caramel">
                <Factory size={13} /> Production automatique
              </p>
              {autoProductions.map((p) => (
                <p key={p.id} className="text-text-secondary">
                  {p.name} — {q(p.outputQuantity)}{p.sellByUnit && p.sellUnit ? ` ${p.sellUnit}` : ''} produits le {formatDateTime(`${p.date}T${p.hour || '00:00'}`, language)} · coût matières {formatCurrency(p.totalCost ?? 0)}
                </p>
              ))}
            </div>
          )}

          {(delivery.consumptions ?? []).length > 0 && (
            <div className="rounded-xl border border-gold/20 bg-vanilla/30 px-4 py-3 text-xs">
              <p className="mb-1 font-bold uppercase tracking-wider text-gold-dark">Matières déduites (ancien bon)</p>
              {(delivery.consumptions ?? []).map((c) => (
                <p key={c.id} className="text-text-secondary">{c.productName} — {q(c.quantity)}{c.unit ? ` ${c.unit}` : ''} · {formatCurrency(c.lineCost)}</p>
              ))}
            </div>
          )}

          {myRecoveries.length > 0 && (
            <div className="rounded-xl border border-rose-deep/20 bg-rose-deep/5 px-4 py-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-deep">
                <Undo2 size={13} /> Récupérations
              </p>
              <div className="space-y-1.5">
                {myRecoveries.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>
                      <b>{r.reference}</b> · {formatDateTime(r.recoveredAt, language)} ·{' '}
                      {r.items.map((i) => `${i.productName} (${q(i.quantity)})`).join(', ')}
                      {refundOf(r) > 0 ? ` · remboursé ${formatCurrency(refundOf(r))}` : r.excessAmount > 0 ? ' · gardé en acompte' : ''}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => onPrintRecovery(r)}><Printer size={13} /> Imprimer</Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {delivery.notes && (
            <p className="rounded-xl border border-gold/10 bg-vanilla/30 p-3 text-sm italic text-text-secondary">« {delivery.notes} »</p>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-gold/10 pt-3">
            {onRecover && (
              <Button variant="secondary" onClick={() => onRecover(delivery)}><RotateCcw size={15} /> Récupérer</Button>
            )}
            {onEdit && !delivery.isHistorical && (
              <Button variant="secondary" onClick={() => onEdit(delivery)}><Pencil size={15} /> Modifier</Button>
            )}
            <Button variant="gold" onClick={() => onPrint(delivery)}><Printer size={15} /> Imprimer le bon</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Tile({ label, value, tone = 'text-text-primary' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2 text-center">
      <p className="text-[10px] uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${tone}`}>{value}</p>
    </div>
  );
}
