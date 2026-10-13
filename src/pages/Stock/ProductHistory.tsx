import { useMemo, useState, type ReactNode } from 'react';
import {
  ShoppingCart, Undo2, Factory, Store, Truck, Printer, Package, CalendarRange,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useProductionStore } from '@/store/productionStore';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore } from '@/store/commandStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useSettingsStore } from '@/store/settingsStore';
import { dayOf, formatCurrency, formatDate, formatNumber, localISODate, todayISO } from '@/lib/utils';
import { printOfficialDocument, type DocTable } from '@/lib/officialDoc';
import type { Product } from '@/types';

/* ============================================================================
 *  HISTORIQUE D'UN PRODUIT DU STOCK
 * ----------------------------------------------------------------------------
 *  Tout ce qui a fait bouger le produit sur une période :
 *   · ACHATS          — lignes des factures d'achat (et retours fournisseur) ;
 *   · PRODUCTION      — quantités consommées par les lots lancés à l'atelier ;
 *   · VENTES CAISSE   — matière consommée par les ventes du point de vente
 *                       (production automatique) et ventes directes ;
 *   · VENTES BL       — matière retirée du stock par les bons de livraison.
 * ========================================================================== */

export type Period = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom';

interface PurchaseRow { date: string; ref: string; supplier: string; bon?: string; qty: number; price: number; total: number; old?: boolean }
interface ReturnRow { date: string; ref: string; supplier: string; reason: string; qty: number; price: number; total: number }
interface UseRow { date: string; ref: string; label: string; qty: number; unitCost: number; cost: number }
interface PosRow { date: string; ref: string; label: string; kind: 'production' | 'direct'; qty: number; amount: number }
interface BlRow { date: string; ref: string; client: string; label: string; delivered: number; qty: number; cost: number }

type PrintPart = 'purchases' | 'production' | 'pos' | 'bl';
const PRINT_PARTS: { id: PrintPart; label: string }[] = [
  { id: 'purchases', label: 'Achats (et retours)' },
  { id: 'production', label: 'Quantités utilisées en production' },
  { id: 'pos', label: 'Ventes caisse (POS)' },
  { id: 'bl', label: 'Ventes par bon de livraison' },
];

export function periodRange(p: Period, from: string, to: string): [string, string] {
  const today = todayISO();
  const d = new Date();
  if (p === 'today') return [today, today];
  if (p === 'week') { const s = new Date(d); s.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [localISODate(s), today]; }
  if (p === 'month') return [localISODate(new Date(d.getFullYear(), d.getMonth(), 1)), today];
  if (p === 'year') return [`${d.getFullYear()}-01-01`, today];
  if (p === 'custom') return [from || '0000-01-01', to || '9999-12-31'];
  return ['0000-01-01', '9999-12-31'];
}

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + (f(r) || 0), 0);

export function ProductHistory({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const purchases = usePurchaseStore((s) => s.purchases);
  const returns = usePurchaseStore((s) => s.returns);
  const suppliers = useSupplierStore((s) => s.suppliers);
  const productions = useProductionStore((s) => s.productions);
  const sales = useSalesStore((s) => s.sales);
  const deliveries = useCommandStore((s) => s.deliveries);
  const commands = useCommandStore((s) => s.commands);
  const fiches = useFicheTechnicStore((s) => s.ficheTechnics);
  const settings = useSettingsStore((s) => s.settings);

  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'all' | PrintPart>('all');
  const [printOpen, setPrintOpen] = useState(false);
  const [printParts, setPrintParts] = useState<PrintPart[]>(PRINT_PARTS.map((p) => p.id));

  const unit = product?.unit ? ` ${product.unit}` : '';
  const qtyTxt = (q: number) => `${formatNumber(q)}${unit}`;
  const [start, end] = periodRange(period, from, to);
  const inRange = (date: string) => { const d = dayOf(date); return d >= start && d <= end; };

  const data = useMemo(() => {
    if (!product) return null;
    const id = product.id;
    const supplierName = (sid: string) => suppliers.find((s) => s.id === sid)?.name || '—';
    const ficheName = (fid?: string) => fiches.find((f) => f.id === fid)?.name;

    const purchaseRows: PurchaseRow[] = [];
    for (const p of purchases) {
      if (!inRange(p.date)) continue;
      for (const l of p.products) {
        if (l.productId !== id) continue;
        purchaseRows.push({
          date: p.date, ref: p.reference, supplier: supplierName(p.supplierId), bon: p.bonNumber,
          qty: l.quantity, price: l.purchasePrice, total: l.quantity * l.purchasePrice, old: p.isHistorical,
        });
      }
    }

    const returnRows: ReturnRow[] = [];
    for (const r of returns) {
      if (!inRange(r.date)) continue;
      for (const it of r.items) {
        if (it.productId !== id) continue;
        returnRows.push({
          date: r.date, ref: r.reference, supplier: supplierName(r.supplierId), reason: r.reason || '',
          qty: it.quantity, price: it.unitPrice, total: it.amount,
        });
      }
    }

    const productionRows: UseRow[] = [];
    const posRows: PosRow[] = [];
    const blRows: BlRow[] = [];
    const usesOf = (pr: (typeof productions)[number]) =>
      pr.usedProducts.filter((u) => u.productId === id && (u.sourceType ?? 'stock') === 'stock');

    for (const pr of productions) {
      if (!inRange(pr.date)) continue;
      for (const u of usesOf(pr)) {
        const cost = u.lineCost ?? u.quantityUsed * (u.unitCost ?? product.purchasePrice);
        if (pr.origin === 'pos') {
          posRows.push({
            date: pr.date, ref: pr.saleReference || '—', label: pr.name, kind: 'production',
            qty: u.quantityUsed, amount: cost,
          });
        } else if (pr.origin !== 'delivery') {
          productionRows.push({
            date: pr.date, ref: pr.categoryName || '—', label: pr.name,
            qty: u.quantityUsed, unitCost: u.unitCost ?? product.purchasePrice, cost,
          });
        }
      }
    }

    // ventes directes du produit à la caisse (sans fiche technique)
    for (const s of sales) {
      if (s.deliveryId || !inRange(s.date)) continue;
      for (const l of s.products) {
        if (l.productId !== id || l.ficheTechnicId) continue;
        posRows.push({
          date: s.date, ref: s.reference, label: 'Vente directe', kind: 'direct',
          qty: l.quantity, amount: l.quantity * l.sellingPrice,
        });
      }
    }

    for (const d of deliveries) {
      if (!inRange(d.date || d.deliveredAt)) continue;
      const cmd = commands.find((c) => c.id === d.commandId);
      const client = cmd?.clientName || '—';
      const cons = (d.consumptions ?? []).filter((c) => c.productId === id);
      for (const c of cons) {
        blRows.push({
          date: d.date || d.deliveredAt, ref: d.reference, client,
          label: ficheName(c.ficheTechnicId) || d.items.find((i) => i.ficheTechnicId === c.ficheTechnicId)?.productName || '—',
          delivered: c.deliveredQuantity, qty: c.quantity, cost: c.lineCost,
        });
      }
      if (!cons.length) {
        // production automatique liée au bon (anciennes données sans détail)
        for (const pr of productions.filter((p) => p.origin === 'delivery' && p.deliveryId === d.id)) {
          for (const u of usesOf(pr)) {
            blRows.push({
              date: d.date || d.deliveredAt, ref: d.reference, client, label: pr.name,
              delivered: pr.outputQuantity, qty: u.quantityUsed,
              cost: u.lineCost ?? u.quantityUsed * (u.unitCost ?? product.purchasePrice),
            });
          }
        }
      }
    }

    const byDate = <T extends { date: string }>(a: T, b: T) => b.date.localeCompare(a.date);
    [purchaseRows, returnRows, productionRows, posRows, blRows].forEach((l) => (l as { date: string }[]).sort(byDate));

    const purchasedQty = sum(purchaseRows, (r) => r.qty);
    const returnedQty = sum(returnRows, (r) => r.qty);
    const productionQty = sum(productionRows, (r) => r.qty);
    const posQty = sum(posRows, (r) => r.qty);
    const blQty = sum(blRows, (r) => r.qty);
    return {
      purchaseRows, returnRows, productionRows, posRows, blRows,
      totals: {
        purchasedQty, purchasedAmount: sum(purchaseRows, (r) => r.total),
        avgPrice: purchasedQty ? sum(purchaseRows, (r) => r.total) / purchasedQty : 0,
        suppliers: new Set(purchaseRows.map((r) => r.supplier)).size,
        returnedQty, returnedAmount: sum(returnRows, (r) => r.total),
        productionQty, productionCost: sum(productionRows, (r) => r.cost),
        productionBatches: new Set(productionRows.map((r) => r.label + r.date)).size,
        posQty, posAmount: sum(posRows, (r) => r.amount), posCount: new Set(posRows.map((r) => r.ref)).size,
        blQty, blCost: sum(blRows, (r) => r.cost), blCount: new Set(blRows.map((r) => r.ref)).size,
        blClients: new Set(blRows.map((r) => r.client)).size,
        usedQty: productionQty + posQty + blQty,
        netQty: purchasedQty - returnedQty - productionQty - posQty - blQty,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, purchases, returns, suppliers, productions, sales, deliveries, commands, fiches, start, end]);

  if (!product || !data) return null;
  const t = data.totals;
  const periodLabel = period === 'all' ? 'Toute la période' : `Du ${formatDate(start)} au ${formatDate(end)}`;

  const tables = (): Record<PrintPart, DocTable[]> => ({
    purchases: [
      {
        title: `Achats — ${data.purchaseRows.length} ligne(s)`,
        columns: [
          { label: 'Date', align: 'center', width: '11%' }, { label: 'Référence', align: 'left', width: '14%' },
          { label: 'Fournisseur', align: 'left' }, { label: 'N° bon', align: 'center', width: '10%' },
          { label: 'Quantité', align: 'right', width: '13%' }, { label: 'Prix unitaire', align: 'right', width: '14%' },
          { label: 'Montant', align: 'right', width: '15%' },
        ],
        rows: data.purchaseRows.map((r) => ({
          cells: [formatDate(r.date), r.ref + (r.old ? ' (ancien)' : ''), r.supplier, r.bon || '/', qtyTxt(r.qty), formatCurrency(r.price), formatCurrency(r.total)],
        })),
        totals: [
          { label: 'Quantité achetée', value: qtyTxt(t.purchasedQty) },
          { label: 'Prix moyen', value: formatCurrency(t.avgPrice) },
          { label: 'Total des achats', value: formatCurrency(t.purchasedAmount), strong: true },
        ],
        emptyLabel: 'Aucun achat sur la période',
      },
      ...(data.returnRows.length ? [{
        title: `Retours au fournisseur — ${data.returnRows.length} ligne(s)`,
        columns: [
          { label: 'Date', align: 'center' as const, width: '11%' }, { label: 'Référence', align: 'left' as const, width: '14%' },
          { label: 'Fournisseur', align: 'left' as const }, { label: 'Motif', align: 'left' as const },
          { label: 'Quantité', align: 'right' as const, width: '13%' }, { label: 'Montant', align: 'right' as const, width: '15%' },
        ],
        rows: data.returnRows.map((r) => ({ cells: [formatDate(r.date), r.ref, r.supplier, r.reason || '/', qtyTxt(r.qty), formatCurrency(r.total)] })),
        totals: [
          { label: 'Quantité retournée', value: qtyTxt(t.returnedQty) },
          { label: 'Total retourné', value: formatCurrency(t.returnedAmount), strong: true },
        ],
      }] : []),
    ],
    production: [{
      title: `Quantités utilisées en production — ${data.productionRows.length} lot(s)`,
      columns: [
        { label: 'Date', align: 'center', width: '11%' }, { label: 'Production', align: 'left' },
        { label: 'Catégorie', align: 'left', width: '18%' }, { label: 'Quantité utilisée', align: 'right', width: '16%' },
        { label: 'Coût unitaire', align: 'right', width: '14%' }, { label: 'Coût', align: 'right', width: '15%' },
      ],
      rows: data.productionRows.map((r) => ({ cells: [formatDate(r.date), r.label, r.ref, qtyTxt(r.qty), formatCurrency(r.unitCost), formatCurrency(r.cost)] })),
      totals: [
        { label: 'Quantité utilisée', value: qtyTxt(t.productionQty) },
        { label: 'Coût total', value: formatCurrency(t.productionCost), strong: true },
      ],
      emptyLabel: 'Aucune production sur la période',
    }],
    pos: [{
      title: `Ventes caisse (POS) — ${t.posCount} vente(s)`,
      columns: [
        { label: 'Date', align: 'center', width: '11%' }, { label: 'Vente', align: 'left', width: '16%' },
        { label: 'Produit vendu', align: 'left' }, { label: 'Type', align: 'center', width: '14%' },
        { label: 'Quantité', align: 'right', width: '14%' }, { label: 'Montant / coût', align: 'right', width: '16%' },
      ],
      rows: data.posRows.map((r) => ({
        cells: [formatDate(r.date), r.ref, r.label, r.kind === 'direct' ? 'Vente directe' : 'Matière utilisée', qtyTxt(r.qty), formatCurrency(r.amount)],
      })),
      totals: [
        { label: 'Quantité sortie', value: qtyTxt(t.posQty) },
        { label: 'Total', value: formatCurrency(t.posAmount), strong: true },
      ],
      emptyLabel: 'Aucune vente caisse sur la période',
    }],
    bl: [{
      title: `Ventes par bon de livraison — ${t.blCount} bon(s)`,
      columns: [
        { label: 'Date', align: 'center', width: '11%' }, { label: 'N° BL', align: 'left', width: '13%' },
        { label: 'Client', align: 'left' }, { label: 'Produit livré', align: 'left' },
        { label: 'Qté livrée', align: 'right', width: '11%' }, { label: 'Matière utilisée', align: 'right', width: '14%' },
        { label: 'Coût', align: 'right', width: '13%' },
      ],
      rows: data.blRows.map((r) => ({ cells: [formatDate(r.date), r.ref, r.client, r.label, formatNumber(r.delivered), qtyTxt(r.qty), formatCurrency(r.cost)] })),
      totals: [
        { label: 'Matière utilisée', value: qtyTxt(t.blQty) },
        { label: 'Coût total', value: formatCurrency(t.blCost), strong: true },
      ],
      emptyLabel: 'Aucun bon de livraison sur la période',
    }],
  });

  const print = () => {
    if (!printParts.length) return;
    const all = tables();
    const chosen = PRINT_PARTS.filter((p) => printParts.includes(p.id));
    const summary: DocTable = {
      title: 'Synthèse',
      columns: [{ label: 'Mouvement', align: 'left' }, { label: 'Opérations', align: 'center', width: '16%' }, { label: 'Quantité', align: 'right', width: '20%' }, { label: 'Montant', align: 'right', width: '20%' }],
      rows: [
        ...(printParts.includes('purchases') ? [
          { cells: ['Achats', data.purchaseRows.length, qtyTxt(t.purchasedQty), formatCurrency(t.purchasedAmount)] },
          ...(data.returnRows.length ? [{ cells: ['Retours au fournisseur', data.returnRows.length, `- ${qtyTxt(t.returnedQty)}`, formatCurrency(t.returnedAmount)] }] : []),
        ] : []),
        ...(printParts.includes('production') ? [{ cells: ['Utilisé en production', data.productionRows.length, qtyTxt(t.productionQty), formatCurrency(t.productionCost)] }] : []),
        ...(printParts.includes('pos') ? [{ cells: ['Ventes caisse (POS)', t.posCount, qtyTxt(t.posQty), formatCurrency(t.posAmount)] }] : []),
        ...(printParts.includes('bl') ? [{ cells: ['Ventes par bon de livraison', t.blCount, qtyTxt(t.blQty), formatCurrency(t.blCost)] }] : []),
      ],
    };
    printOfficialDocument({
      title: `HISTORIQUE DU PRODUIT`,
      docDate: todayISO(),
      doitLabel: 'PRODUIT',
      doitName: product.name,
      doitCode: null,
      doitLines: [
        `Stock actuel : ${qtyTxt(product.currentQuantity)}`,
        `Prix d'achat : ${formatCurrency(product.purchasePrice)}${unit ? ` /${product.unit}` : ''}`,
      ],
      metaLines: [periodLabel.toUpperCase(), `Parties : ${chosen.map((c) => c.label).join(', ')}`],
      tables: [summary, ...chosen.flatMap((c) => all[c.id])],
      signatures: ['Le responsable', 'Signature'],
      fileName: `Historique_${product.name.replace(/\s+/g, '_')}`,
    }, settings);
    setPrintOpen(false);
  };

  const show = (p: PrintPart) => tab === 'all' || tab === p;

  return (
    <Modal open={!!product} onClose={onClose} title={`Historique — ${product.name}`} size="xl">
      <div className="space-y-5">
        {/* filtres */}
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gold/20 bg-vanilla/40 p-3">
          <div className="min-w-[170px]">
            <Select label="Période" value={period} onChange={(e) => setPeriod(e.target.value as Period)}
              options={[
                { value: 'all', label: 'Toute la période' }, { value: 'today', label: "Aujourd'hui" },
                { value: 'week', label: 'Cette semaine' }, { value: 'month', label: 'Ce mois' },
                { value: 'year', label: 'Cette année' }, { value: 'custom', label: 'Période personnalisée' },
              ]} />
          </div>
          {period === 'custom' && (
            <>
              <div className="w-[160px]"><Input type="date" label="Du" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="w-[160px]"><Input type="date" label="Au" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </>
          )}
          <span className="flex items-center gap-1.5 pb-2.5 text-xs font-semibold text-text-muted">
            <CalendarRange size={14} /> {periodLabel}
          </span>
          <Button variant="gold" className="ms-auto" onClick={() => setPrintOpen(true)}><Printer size={16} /> Imprimer le rapport</Button>
        </div>

        {/* synthèse */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard icon={<Package size={16} />} tone="gold" title="Stock actuel" value={qtyTxt(product.currentQuantity)}
            lines={[`Valeur : ${formatCurrency(product.currentQuantity * product.purchasePrice)}`, `Mouvement net période : ${t.netQty >= 0 ? '+' : ''}${qtyTxt(t.netQty)}`]} />
          <SummaryCard icon={<ShoppingCart size={16} />} tone="mint" title="Achats" value={qtyTxt(t.purchasedQty)}
            lines={[`${data.purchaseRows.length} ligne(s) · ${t.suppliers} fournisseur(s)`, `Total : ${formatCurrency(t.purchasedAmount)}`, `Prix moyen : ${formatCurrency(t.avgPrice)}`, ...(t.returnedQty ? [`Retours : ${qtyTxt(t.returnedQty)} (${formatCurrency(t.returnedAmount)})`] : [])]} />
          <SummaryCard icon={<Factory size={16} />} tone="amber" title="Utilisé en production" value={qtyTxt(t.productionQty)}
            lines={[`${data.productionRows.length} lot(s)`, `Coût : ${formatCurrency(t.productionCost)}`]} />
          <SummaryCard icon={<Store size={16} />} tone="rose" title="Ventes (caisse + BL)" value={qtyTxt(t.posQty + t.blQty)}
            lines={[`Caisse : ${qtyTxt(t.posQty)} · ${t.posCount} vente(s)`, `Bons de livraison : ${qtyTxt(t.blQty)} · ${t.blCount} bon(s)`, `${t.blClients} client(s) livré(s)`]} />
        </div>

        {/* onglets */}
        <div className="flex flex-wrap gap-2">
          {([['all', 'Tout'], ['purchases', `Achats (${data.purchaseRows.length + data.returnRows.length})`], ['production', `Production (${data.productionRows.length})`], ['pos', `Caisse (${data.posRows.length})`], ['bl', `Bons de livraison (${data.blRows.length})`]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${tab === id ? 'border-gold bg-gold/15 text-gold-dark' : 'border-gold/20 text-text-muted hover:bg-gold/5'}`}>
              {label}
            </button>
          ))}
        </div>

        {show('purchases') && (
          <Section icon={<ShoppingCart size={16} />} title="Achats" subtitle={`${qtyTxt(t.purchasedQty)} · ${formatCurrency(t.purchasedAmount)}`}
            head={['Date', 'Référence', 'Fournisseur', 'N° bon', 'Quantité', 'Prix unitaire', 'Montant']}
            rows={data.purchaseRows.map((r) => [formatDate(r.date), <span key="r">{r.ref} {r.old && <Badge variant="neutral">ancien</Badge>}</span>, r.supplier, r.bon || '—', qtyTxt(r.qty), formatCurrency(r.price), formatCurrency(r.total)])}
            empty="Aucun achat sur la période" />
        )}
        {show('purchases') && data.returnRows.length > 0 && (
          <Section icon={<Undo2 size={16} />} title="Retours au fournisseur" subtitle={`${qtyTxt(t.returnedQty)} · ${formatCurrency(t.returnedAmount)}`}
            head={['Date', 'Référence', 'Fournisseur', 'Motif', 'Quantité', 'Montant']}
            rows={data.returnRows.map((r) => [formatDate(r.date), r.ref, r.supplier, r.reason || '—', qtyTxt(r.qty), formatCurrency(r.total)])}
            empty="" />
        )}
        {show('production') && (
          <Section icon={<Factory size={16} />} title="Quantités utilisées en production" subtitle={`${qtyTxt(t.productionQty)} · ${formatCurrency(t.productionCost)}`}
            head={['Date', 'Production', 'Catégorie', 'Quantité utilisée', 'Coût unitaire', 'Coût']}
            rows={data.productionRows.map((r) => [formatDate(r.date), r.label, r.ref, qtyTxt(r.qty), formatCurrency(r.unitCost), formatCurrency(r.cost)])}
            empty="Aucune production sur la période" />
        )}
        {show('pos') && (
          <Section icon={<Store size={16} />} title="Ventes caisse (POS)" subtitle={`${qtyTxt(t.posQty)} · ${formatCurrency(t.posAmount)}`}
            head={['Date', 'Vente', 'Produit vendu', 'Type', 'Quantité', 'Montant / coût']}
            rows={data.posRows.map((r) => [formatDate(r.date), r.ref, r.label, r.kind === 'direct' ? 'Vente directe' : 'Matière utilisée', qtyTxt(r.qty), formatCurrency(r.amount)])}
            empty="Aucune vente caisse sur la période" />
        )}
        {show('bl') && (
          <Section icon={<Truck size={16} />} title="Ventes par bon de livraison" subtitle={`${qtyTxt(t.blQty)} · ${formatCurrency(t.blCost)}`}
            head={['Date', 'N° BL', 'Client', 'Produit livré', 'Qté livrée', 'Matière utilisée', 'Coût']}
            rows={data.blRows.map((r) => [formatDate(r.date), r.ref, r.client, r.label, formatNumber(r.delivered), qtyTxt(r.qty), formatCurrency(r.cost)])}
            empty="Aucun bon de livraison sur la période" />
        )}
      </div>

      <Modal open={printOpen} onClose={() => setPrintOpen(false)} title="Imprimer l'historique" size="sm"
        footer={<Button variant="gold" disabled={!printParts.length} onClick={print}><Printer size={16} /> Imprimer</Button>}>
        <p className="mb-3 text-sm text-text-muted">Choisissez les parties à imprimer ({periodLabel.toLowerCase()}) :</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {([['Tout', PRINT_PARTS.map((p) => p.id)], ['Achats seuls', ['purchases']], ['Quantités utilisées', ['production']], ['Ventes seules', ['pos', 'bl']]] as [string, PrintPart[]][]).map(([label, ids]) => (
            <button key={label} type="button" onClick={() => setPrintParts(ids)}
              className="rounded-full border border-gold/25 px-3 py-1 text-xs font-semibold text-gold-dark hover:bg-gold/10">{label}</button>
          ))}
        </div>
        <div className="space-y-2">
          {PRINT_PARTS.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2 text-sm text-text-primary">
              <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-gold))]" checked={printParts.includes(p.id)}
                onChange={() => setPrintParts((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))} />
              {p.label}
            </label>
          ))}
        </div>
      </Modal>
    </Modal>
  );
}

const TONES = {
  gold: 'border-gold/30 bg-gold/10 text-gold-dark',
  mint: 'border-pistachio/30 bg-pistachio/10 text-pistachio',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  rose: 'border-rose-deep/30 bg-rose-deep/10 text-rose-deep',
};

export function SummaryCard({ icon, title, value, lines, tone }: { icon: ReactNode; title: string; value: string; lines: string[]; tone: keyof typeof TONES }) {
  return (
    <div className={`rounded-2xl border p-3.5 ${TONES[tone]}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">{icon} {title}</p>
      <p className="mt-1.5 font-display text-xl font-bold tabular text-text-primary">{value}</p>
      <div className="mt-1.5 space-y-0.5">
        {lines.map((l) => <p key={l} className="text-[11px] font-medium text-text-muted">{l}</p>)}
      </div>
    </div>
  );
}

export function Section({ icon, title, subtitle, head, rows, empty }: {
  icon: ReactNode; title: string; subtitle: string; head: string[]; rows: ReactNode[][]; empty: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gold/15 bg-gradient-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/15 bg-vanilla/60 px-4 py-2.5">
        <h4 className="flex items-center gap-2 font-display text-sm font-semibold text-text-primary"><span className="text-gold">{icon}</span>{title}</h4>
        <span className="text-xs font-semibold tabular text-text-muted">{rows.length} ligne(s) · {subtitle}</span>
      </div>
      {rows.length ? (
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-vanilla text-text-secondary">
              <tr>{head.map((h, i) => <th key={h} className={`px-3 py-2 font-semibold ${i >= head.length - 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gold/10 hover:bg-gold/5">
                  {r.map((c, j) => <td key={j} className={`px-3 py-2 ${j >= r.length - 3 ? 'text-right tabular' : ''} ${j === 0 ? 'whitespace-nowrap' : ''}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-xs italic text-text-muted">{empty}</p>
      )}
    </div>
  );
}

