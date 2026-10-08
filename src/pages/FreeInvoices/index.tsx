import { useMemo, useState } from 'react';
import { FileText, Plus, Eye, Pencil, Trash2, Printer, Receipt, Wallet, Info } from 'lucide-react';
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
import { useFreeInvoiceStore } from '@/store/freeInvoiceStore';
import { useSettingsStore } from '@/store/settingsStore';
import { usePermissions } from '@/hooks/usePermissions';
import { useLanguage } from '@/hooks/useLanguage';
import { formatCurrency, formatDate, matchesDateFilter, type DateFilter } from '@/lib/utils';
import { printSaleInvoice } from '@/lib/invoicePrint';
import { printFreeDeliveryNote } from '@/lib/documents';
import type { FreeInvoice, FreeInvoiceDocType } from '@/types';
import { FreeInvoiceForm, FREE_DOC_TYPES } from './FreeInvoiceForm';

const typeLabel = (t: FreeInvoiceDocType) => FREE_DOC_TYPES.find((x) => x.value === t)?.label ?? 'Facture';

/** Titre imprimé par défaut selon le type du document. */
const defaultTitle = (inv: FreeInvoice) =>
  inv.docType === 'bon_livraison'
    ? 'BON DE LIVRAISON'
    : inv.docType === 'proforma'
      ? 'FACTURE PROFORMA'
      : inv.tvaEnabled ? 'FACTURE (T.T.C)' : 'FACTURE';

/**
 * FACTURES NON COMPTABILISÉES — documents seulement imprimés.
 * Créer, modifier ou supprimer l'un d'eux ne change RIEN aux données de
 * l'entreprise : ni stock, ni caisse, ni dette client, ni rapports.
 */
export default function FreeInvoicesPage() {
  const { language } = useLanguage();
  const { can } = usePermissions();
  const settings = useSettingsStore((s) => s.settings);
  const invoices = useFreeInvoiceStore((s) => s.invoices);
  const removeInvoice = useFreeInvoiceStore((s) => s.remove);

  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | FreeInvoiceDocType>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FreeInvoice | null>(null);
  const [viewing, setViewing] = useState<FreeInvoice | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [printPrompt, setPrintPrompt] = useState<FreeInvoice | null>(null);
  const [titleRequest, setTitleRequest] = useState<PrintTitleRequest | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...invoices]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      .filter((inv) => {
        if (typeFilter !== 'all' && inv.docType !== typeFilter) return false;
        if (!matchesDateFilter(inv.date, dateFilter)) return false;
        if (!term) return true;
        return [inv.reference, inv.clientName, inv.clientPhone, ...inv.lines.map((l) => l.productName)]
          .filter(Boolean).join(' ').toLowerCase().includes(term);
      });
  }, [invoices, search, dateFilter, typeFilter]);

  const totals = useMemo(() => ({
    count: rows.length,
    amount: rows.reduce((s, x) => s + x.finalAmount, 0),
    rest: rows.reduce((s, x) => s + x.restAmount, 0),
  }), [rows]);

  /* ---------------------------------------------------------- impression */
  const runPrint = (inv: FreeInvoice, title: string, endText: string) => {
    const client = {
      name: inv.clientName, phone: inv.clientPhone, address: inv.clientAddress,
      rc: inv.clientRc, nif: inv.clientNif, nis: inv.clientNis, article: inv.clientArticle,
    };
    if (inv.docType === 'bon_livraison') {
      printFreeDeliveryNote({
        docType: inv.docType, reference: inv.reference, date: inv.date, client,
        location: inv.location, driverName: inv.driverName, driverPlate: inv.driverPlate,
        lines: inv.lines, totalHt: inv.totalAmount, reduction: inv.reduction,
        tvaEnabled: inv.tvaEnabled, tvaRate: inv.tvaRate, tvaAmount: inv.tvaAmount,
        finalAmount: inv.finalAmount, paidAmount: inv.paidAmount, restAmount: inv.restAmount,
        paymentMode: inv.paymentMode, notes: inv.notes, docTitle: title, endText,
      }, settings);
      return;
    }
    printSaleInvoice({
      hidePayment: true,
      docTitle: title,
      endText,
      observations: inv.notes || undefined,
      reference: inv.reference,
      date: inv.date,
      client,
      paymentMode: inv.paymentMode,
      lines: inv.lines.map((l) => ({
        designation: l.productName, description: l.description || undefined,
        quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice,
      })),
      total: inv.totalAmount,
      reduction: inv.reduction,
      tvaEnabled: inv.tvaEnabled,
      tvaRate: inv.tvaRate,
      tvaAmount: inv.tvaAmount,
      final: inv.finalAmount,
      paid: inv.paidAmount,
      rest: inv.restAmount,
      createdBy: inv.createdBy,
    }, settings);
  };

  const askPrint = (inv: FreeInvoice) =>
    setTitleRequest({
      defaultTitle: defaultTitle(inv),
      scope: 'delivery',
      dialogTitle: `Imprimer ${inv.reference}`,
      print: ({ title, endText }) => runPrint(inv, title, endText),
    });

  /* ------------------------------------------------------------ colonnes */
  const columns: DataColumn<FreeInvoice>[] = [
    { key: 'ref', label: 'N°', render: (x) => <span className="font-bold text-gold">{x.reference}</span> },
    {
      key: 'type', label: 'Type', align: 'center',
      render: (x) => (
        <Badge variant={x.docType === 'bon_livraison' ? 'info' : x.docType === 'proforma' ? 'warning' : 'gold'} className="text-[10px]">
          {typeLabel(x.docType)}
        </Badge>
      ),
    },
    { key: 'date', label: 'Date', render: (x) => formatDate(x.date, language) },
    {
      key: 'client', label: 'Client',
      render: (x) => (
        <div className="min-w-0">
          <p className="font-semibold text-text-primary truncate">{x.clientName || '—'}</p>
          {x.clientPhone && <p className="text-[11px] text-text-muted">{x.clientPhone}</p>}
        </div>
      ),
    },
    {
      key: 'lines', label: 'Produits', hideOnMobile: true,
      render: (x) => <span className="text-xs">{x.lines.map((l) => `${l.productName} (${l.quantity})`).join(' · ')}</span>,
    },
    { key: 'total', label: 'Total', align: 'right', render: (x) => <span className="font-bold">{formatCurrency(x.finalAmount)}</span> },
    { key: 'paid', label: 'Versement', align: 'right', hideOnMobile: true, render: (x) => <span className="text-pistachio">{formatCurrency(x.paidAmount)}</span> },
    {
      key: 'rest', label: 'Reste', align: 'right',
      render: (x) => x.restAmount > 0.004
        ? <span className="font-bold text-rose-deep">{formatCurrency(x.restAmount)}</span>
        : <Badge variant="success">Réglée</Badge>,
    },
  ];

  const actions = (x: FreeInvoice): ActionItem[] => [
    { label: 'Voir les détails', icon: <Eye size={15} />, onClick: () => setViewing(x) },
    { label: 'Imprimer', icon: <Printer size={15} />, onClick: () => askPrint(x) },
    {
      label: 'Modifier', icon: <Pencil size={15} />, hidden: !can('sales', 'edit'),
      onClick: () => { setEditing(x); setFormOpen(true); },
    },
    {
      label: 'Supprimer', icon: <Trash2 size={15} />, danger: true, hidden: !can('sales', 'delete'),
      onClick: () => setDeleteId(x.id),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Factures non comptabilisées"
        subtitle={`${invoices.length} document(s) — impression seulement`}
        icon={<FileText size={24} />}
        actions={
          can('sales', 'create') && (
            <Button variant="gold" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus size={18} /> Nouvelle facture
            </Button>
          )
        }
      />

      <div className="flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/5 px-4 py-3 text-sm text-text-secondary">
        <Info size={17} className="mt-0.5 shrink-0 text-gold-dark" />
        Ces documents (factures, proformas, bons de livraison) servent uniquement à être imprimés : ils ne
        modifient ni le stock, ni la caisse, ni la dette des clients, ni les rapports.
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Documents" value={totals.count} icon={<FileText size={22} />} index={0} accent="gold" />
        <StatCard label="Montant total" value={totals.amount} format="currency" icon={<Receipt size={22} />} index={1} accent="caramel" />
        <StatCard label="Reste affiché" value={totals.rest} format="currency" icon={<Wallet size={22} />} index={2} accent="rose" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un document, un client, un produit…" />
        </div>
        <div className="w-full sm:w-[230px]">
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as 'all' | FreeInvoiceDocType)}
            options={[{ value: 'all', label: 'Tous les types' }, ...FREE_DOC_TYPES]}
          />
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
      </div>

      {rows.length === 0 ? (
        <EmptyState message="Aucune facture non comptabilisée" icon={<FileText size={32} />} />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(x) => x.id} actions={actions} onRowClick={(x) => setViewing(x)} />
      )}

      <FreeInvoiceForm
        open={formOpen}
        editing={editing}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSaved={(inv) => { setFormOpen(false); setEditing(null); setPrintPrompt(inv); }}
      />

      {/* imprimer après création / modification */}
      <Modal open={!!printPrompt} onClose={() => setPrintPrompt(null)} title="Imprimer le document ?" size="sm">
        {printPrompt && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              {typeLabel(printPrompt.docType)} {printPrompt.reference} enregistré(e) pour {printPrompt.clientName} —{' '}
              {formatCurrency(printPrompt.finalAmount)}.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setPrintPrompt(null)}>Plus tard</Button>
              <Button variant="gold" className="flex-1" onClick={() => { const x = printPrompt; setPrintPrompt(null); askPrint(x); }}>
                <Printer size={16} /> Imprimer
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* détails */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${typeLabel(viewing.docType)} ${viewing.reference}` : ''} size="lg">
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gold/20 bg-gradient-card px-4 py-3 text-sm">
                <p className="text-xs text-text-muted">Client</p>
                <p className="font-bold text-text-primary">{viewing.clientName}</p>
                <div className="mt-1 space-y-0.5 text-[11px] text-text-muted">
                  {viewing.clientPhone && <p>Tél : {viewing.clientPhone}</p>}
                  {viewing.clientAddress && <p>Adresse : {viewing.clientAddress}</p>}
                  {viewing.clientRc && <p>R.C : {viewing.clientRc}</p>}
                  {viewing.clientNif && <p>NIF : {viewing.clientNif}</p>}
                  {viewing.clientNis && <p>NIS : {viewing.clientNis}</p>}
                  {viewing.clientArticle && <p>Article : {viewing.clientArticle}</p>}
                </div>
              </div>
              <div className="rounded-xl border border-gold/20 bg-gradient-card px-4 py-3 text-xs space-y-1">
                <p><b>Date :</b> {formatDate(viewing.date, language)}</p>
                <p><b>Règlement :</b> {viewing.paymentMode || '—'}</p>
                {viewing.docType === 'bon_livraison' && (
                  <>
                    <p><b>Lieu :</b> {viewing.location || viewing.clientAddress || '—'}</p>
                    <p><b>Chauffeur :</b> {viewing.driverName || '—'}{viewing.driverPlate ? ` · ${viewing.driverPlate}` : ''}</p>
                  </>
                )}
                {viewing.createdBy && <p><b>Établi par :</b> {viewing.createdBy}</p>}
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gold/15">
              <table className="w-full text-sm">
                <thead className="bg-vanilla/60 text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left">Désignation</th>
                    <th className="px-3 py-2 text-center">Quantité</th>
                    <th className="px-3 py-2 text-right">Prix U</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {viewing.lines.map((l, i) => (
                    <tr key={i} className="border-t border-gold/10">
                      <td className="px-3 py-2">
                        <p className="font-medium text-text-primary">{l.productName}</p>
                        {l.description && <p className="text-[11px] text-text-muted">{l.description}</p>}
                      </td>
                      <td className="px-3 py-2 text-center tabular">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                      <td className="px-3 py-2 text-right tabular">{formatCurrency(l.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">{formatCurrency(l.totalPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Tile label="Total H.T" value={formatCurrency(viewing.totalAmount)} />
              <Tile label="Réduction" value={formatCurrency(viewing.reduction)} />
              <Tile label={viewing.tvaEnabled ? `TVA ${viewing.tvaRate} %` : 'TVA'} value={formatCurrency(viewing.tvaAmount)} />
              <Tile label="Net à payer" value={formatCurrency(viewing.finalAmount)} tone="text-gold-dark" />
              <Tile label="Reste" value={formatCurrency(viewing.restAmount)} tone={viewing.restAmount > 0.004 ? 'text-rose-deep' : 'text-pistachio'} />
            </div>
            {viewing.notes && <p className="rounded-xl border border-gold/10 bg-vanilla/30 p-3 text-sm italic text-text-secondary">« {viewing.notes} »</p>}
            <div className="flex justify-end gap-2 border-t border-gold/10 pt-3">
              {can('sales', 'edit') && (
                <Button variant="secondary" onClick={() => { const x = viewing; setViewing(null); setEditing(x); setFormOpen(true); }}>
                  <Pencil size={15} /> Modifier
                </Button>
              )}
              <Button variant="gold" onClick={() => askPrint(viewing)}><Printer size={15} /> Imprimer</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Supprimer le document"
        message="Le document part dans la corbeille. Aucune autre donnée n'est touchée."
        onConfirm={() => { if (deleteId) void removeInvoice(deleteId).then(() => toast.success('Document supprimé')); }}
      />

      <PrintTitleDialog request={titleRequest} onClose={() => setTitleRequest(null)} />
    </div>
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
