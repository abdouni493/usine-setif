import { useMemo, useState } from 'react';
import { Factory, Store, Truck, Undo2, Printer, Boxes, CalendarRange, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { useProductionStore } from '@/store/productionStore';
import { useSalesStore } from '@/store/salesStore';
import { useCommandStore } from '@/store/commandStore';
import { useClientStore } from '@/store/clientStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { FicheTechnic } from '@/store/ficheTechnicStore';
import { readyByFiche } from '@/lib/readyStock';
import { dayOf, formatCurrency, formatDate, formatNumber, todayISO } from '@/lib/utils';
import { printOfficialDocument, type DocTable } from '@/lib/officialDoc';
import { Section, SummaryCard, periodRange, type Period } from './ProductHistory';

/* ============================================================================
 *  HISTORIQUE D'UN PRODUIT DE PRODUCTION (fiche technique)
 * ----------------------------------------------------------------------------
 *   · PRODUCTION     — lots fabriqués (manuels, caisse, livraison), pertes ;
 *   · VENTES CAISSE  — lignes des ventes du point de vente ;
 *   · VENTES BL      — quantités remises par les bons de livraison ;
 *   · RÉCUPÉRATIONS  — quantités reprises au client après livraison.
 * ========================================================================== */

type Part = 'production' | 'pos' | 'bl' | 'recovery';
const PARTS: { id: Part; label: string }[] = [
  { id: 'production', label: 'Production (lots fabriqués)' },
  { id: 'pos', label: 'Ventes caisse (POS)' },
  { id: 'bl', label: 'Ventes par bon de livraison' },
  { id: 'recovery', label: 'Récupérations' },
];
const ORIGIN: Record<string, string> = { manual: 'Atelier', pos: 'Caisse', delivery: 'Livraison' };
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + (f(r) || 0), 0);

export function FicheHistory({ fiche, onClose }: { fiche: FicheTechnic | null; onClose: () => void }) {
  const productions = useProductionStore((s) => s.productions);
  const sales = useSalesStore((s) => s.sales);
  const deliveries = useCommandStore((s) => s.deliveries);
  const commands = useCommandStore((s) => s.commands);
  const recoveries = useCommandStore((s) => s.recoveries);
  const clients = useClientStore((s) => s.clients);
  const settings = useSettingsStore((s) => s.settings);

  const [period, setPeriod] = useState<Period>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'all' | Part>('all');
  const [printOpen, setPrintOpen] = useState(false);
  const [printParts, setPrintParts] = useState<Part[]>(PARTS.map((p) => p.id));

  const unit = fiche?.sellByUnit && fiche.sellUnit ? ` ${fiche.sellUnit}` : '';
  const q = (n: number) => `${formatNumber(n)}${unit}`;
  const [start, end] = periodRange(period, from, to);

  const data = useMemo(() => {
    if (!fiche) return null;
    const id = fiche.id;
    const inRange = (d: string) => { const x = dayOf(d); return x >= start && x <= end; };
    const clientName = (cid?: string | null) => clients.find((c) => c.id === cid)?.name || 'Client passager';

    const prodRows = productions
      .filter((p) => p.ficheTechnicId === id && inRange(p.date))
      .map((p) => ({
        date: p.date, hour: p.hour, origin: ORIGIN[p.origin ?? 'manual'] ?? 'Atelier', ref: p.saleReference || '',
        qty: p.outputQuantity, loss: p.lossQuantity ?? 0, cost: p.totalCost ?? 0,
        unitCost: p.outputQuantity ? (p.totalCost ?? 0) / p.outputQuantity : 0, value: p.totalValue,
        comptoir: p.sentToComptoir ?? 0,
      }));

    const posRows: { date: string; ref: string; client: string; qty: number; price: number; total: number; old?: boolean }[] = [];
    for (const s of sales) {
      if (s.deliveryId || !inRange(s.date)) continue;
      for (const l of s.products) {
        if (l.ficheTechnicId !== id) continue;
        posRows.push({ date: s.date, ref: s.reference, client: clientName(s.clientId), qty: l.quantity, price: l.sellingPrice, total: l.quantity * l.sellingPrice, old: s.isHistorical });
      }
    }

    const blRows: { date: string; ref: string; client: string; qty: number; fromReady: number; produced: number; price: number; total: number; cost: number }[] = [];
    for (const d of deliveries) {
      const date = d.date || d.deliveredAt;
      if (!inRange(date)) continue;
      const items = d.items.filter((i) => i.ficheTechnicId === id);
      if (!items.length) continue;
      const cmd = commands.find((c) => c.id === d.commandId);
      const sale = sales.find((s) => s.id === d.saleId || s.deliveryId === d.id);
      for (const it of items) {
        const line = sale?.products.find((l) => l.ficheTechnicId === id);
        const cmdItem = cmd?.items.find((c) => c.id === it.commandItemId);
        const price = line?.sellingPrice ?? (cmdItem as { unitPrice?: number } | undefined)?.unitPrice ?? 0;
        blRows.push({
          date, ref: d.reference, client: cmd?.clientName || clientName(sale?.clientId),
          qty: it.quantity, fromReady: it.fromReady ?? 0, produced: it.producedQuantity ?? 0,
          price, total: it.quantity * price, cost: it.costAmount ?? it.quantity * (it.unitCost ?? fiche.costPerUnit),
        });
      }
    }

    const recRows: { date: string; ref: string; client: string; reason: string; qty: number; amount: number }[] = [];
    for (const r of recoveries) {
      if (!inRange(r.recoveredAt || r.date)) continue;
      for (const it of r.items.filter((i) => i.ficheTechnicId === id)) {
        recRows.push({ date: r.recoveredAt || r.date, ref: r.reference, client: r.clientName || '—', reason: r.reason || '', qty: it.quantity, amount: it.amount });
      }
    }

    const desc = <T extends { date: string }>(a: T, b: T) => b.date.localeCompare(a.date);
    prodRows.sort(desc); posRows.sort(desc); blRows.sort(desc); recRows.sort(desc);
    const producedQty = sum(prodRows, (r) => r.qty);
    const posQty = sum(posRows, (r) => r.qty);
    const blQty = sum(blRows, (r) => r.qty);
    const recQty = sum(recRows, (r) => r.qty);
    const salesAmount = sum(posRows, (r) => r.total) + sum(blRows, (r) => r.total);
    const prodCost = sum(prodRows, (r) => r.cost);
    return {
      prodRows, posRows, blRows, recRows,
      t: {
        producedQty, prodCost, lossQty: sum(prodRows, (r) => r.loss), batches: prodRows.length,
        avgCost: producedQty ? prodCost / producedQty : 0,
        posQty, posAmount: sum(posRows, (r) => r.total), posCount: new Set(posRows.map((r) => r.ref)).size,
        blQty, blAmount: sum(blRows, (r) => r.total), blCost: sum(blRows, (r) => r.cost),
        blCount: new Set(blRows.map((r) => r.ref)).size, blClients: new Set(blRows.map((r) => r.client)).size,
        recQty, recAmount: sum(recRows, (r) => r.amount),
        soldQty: posQty + blQty - recQty, salesAmount: salesAmount - sum(recRows, (r) => r.amount),
      },
    };
  }, [fiche, productions, sales, deliveries, commands, recoveries, clients, start, end]);

  const ready = useMemo(
    () => (fiche ? Math.max(0, readyByFiche(productions, deliveries, recoveries).get(fiche.id) ?? 0) : 0),
    [fiche, productions, deliveries, recoveries],
  );

  if (!fiche || !data) return null;
  const { t } = data;
  const periodLabel = period === 'all' ? 'Toute la période' : `Du ${formatDate(start)} au ${formatDate(end)}`;

  const docTables: Record<Part, DocTable> = {
    production: {
      title: `Production — ${t.batches} lot(s)`,
      columns: [
        { label: 'Date', align: 'center', width: '11%' }, { label: 'Origine', align: 'center', width: '11%' },
        { label: 'Vente liée', align: 'left', width: '13%' }, { label: 'Quantité produite', align: 'right' },
        { label: 'Perte', align: 'right', width: '10%' }, { label: 'Coût unitaire', align: 'right', width: '13%' },
        { label: 'Coût', align: 'right', width: '14%' },
      ],
      rows: data.prodRows.map((r) => ({ cells: [formatDate(r.date), r.origin, r.ref || '/', q(r.qty), r.loss ? q(r.loss) : '/', formatCurrency(r.unitCost), formatCurrency(r.cost)] })),
      totals: [
        { label: 'Quantité produite', value: q(t.producedQty) },
        { label: 'Coût moyen', value: formatCurrency(t.avgCost) },
        { label: 'Coût total', value: formatCurrency(t.prodCost), strong: true },
      ],
      emptyLabel: 'Aucune production sur la période',
    },
    pos: {
      title: `Ventes caisse (POS) — ${t.posCount} vente(s)`,
      columns: [
        { label: 'Date', align: 'center', width: '11%' }, { label: 'Vente', align: 'left', width: '15%' },
        { label: 'Client', align: 'left' }, { label: 'Quantité', align: 'right', width: '13%' },
        { label: 'Prix unitaire', align: 'right', width: '14%' }, { label: 'Montant', align: 'right', width: '15%' },
      ],
      rows: data.posRows.map((r) => ({ cells: [formatDate(r.date), r.ref + (r.old ? ' (ancien)' : ''), r.client, q(r.qty), formatCurrency(r.price), formatCurrency(r.total)] })),
      totals: [{ label: 'Quantité vendue', value: q(t.posQty) }, { label: 'Total', value: formatCurrency(t.posAmount), strong: true }],
      emptyLabel: 'Aucune vente caisse sur la période',
    },
    bl: {
      title: `Ventes par bon de livraison — ${t.blCount} bon(s)`,
      columns: [
        { label: 'Date', align: 'center', width: '10%' }, { label: 'N° BL', align: 'left', width: '12%' },
        { label: 'Client', align: 'left' }, { label: 'Quantité', align: 'right', width: '11%' },
        { label: 'Dont stock prêt', align: 'right', width: '11%' }, { label: 'Prix unitaire', align: 'right', width: '12%' },
        { label: 'Montant', align: 'right', width: '13%' },
      ],
      rows: data.blRows.map((r) => ({ cells: [formatDate(r.date), r.ref, r.client, q(r.qty), q(r.fromReady), formatCurrency(r.price), formatCurrency(r.total)] })),
      totals: [
        { label: 'Quantité livrée', value: q(t.blQty) },
        { label: 'Coût de revient', value: formatCurrency(t.blCost) },
        { label: 'Total', value: formatCurrency(t.blAmount), strong: true },
      ],
      emptyLabel: 'Aucun bon de livraison sur la période',
    },
    recovery: {
      title: `Récupérations — ${data.recRows.length} ligne(s)`,
      columns: [
        { label: 'Date', align: 'center', width: '11%' }, { label: 'Référence', align: 'left', width: '14%' },
        { label: 'Client', align: 'left' }, { label: 'Motif', align: 'left' },
        { label: 'Quantité', align: 'right', width: '12%' }, { label: 'Montant', align: 'right', width: '14%' },
      ],
      rows: data.recRows.map((r) => ({ cells: [formatDate(r.date), r.ref, r.client, r.reason || '/', q(r.qty), formatCurrency(r.amount)] })),
      totals: [{ label: 'Quantité récupérée', value: q(t.recQty) }, { label: 'Total', value: formatCurrency(t.recAmount), strong: true }],
      emptyLabel: 'Aucune récupération sur la période',
    },
  };

  const print = () => {
    const chosen = PARTS.filter((p) => printParts.includes(p.id));
    if (!chosen.length) return;
    const summaryRows = [
      ['production', 'Production', t.batches, q(t.producedQty), formatCurrency(t.prodCost)],
      ['pos', 'Ventes caisse (POS)', t.posCount, q(t.posQty), formatCurrency(t.posAmount)],
      ['bl', 'Ventes par bon de livraison', t.blCount, q(t.blQty), formatCurrency(t.blAmount)],
      ['recovery', 'Récupérations', data.recRows.length, `- ${q(t.recQty)}`, formatCurrency(t.recAmount)],
    ].filter((r) => printParts.includes(r[0] as Part)).map((r) => ({ cells: r.slice(1) as (string | number)[] }));
    printOfficialDocument({
      title: 'HISTORIQUE DU PRODUIT',
      docDate: todayISO(),
      doitLabel: 'PRODUIT',
      doitName: fiche.name,
      doitCode: null,
      doitLines: [
        `Catégorie : ${fiche.categoryName || '/'}`,
        `Stock prêt : ${q(ready)}`,
        `Prix de vente : ${formatCurrency(fiche.unitPrice)} · Coût de revient : ${formatCurrency(fiche.costPerUnit)}`,
      ],
      metaLines: [periodLabel.toUpperCase(), `Parties : ${chosen.map((c) => c.label).join(', ')}`],
      tables: [
        {
          title: 'Synthèse',
          columns: [{ label: 'Mouvement', align: 'left' }, { label: 'Opérations', align: 'center', width: '16%' }, { label: 'Quantité', align: 'right', width: '20%' }, { label: 'Montant', align: 'right', width: '20%' }],
          rows: summaryRows,
        },
        ...chosen.map((c) => docTables[c.id]),
      ],
      signatures: ['Le responsable', 'Signature'],
      fileName: `Historique_${fiche.name.replace(/\s+/g, '_')}`,
    }, settings);
    setPrintOpen(false);
  };

  const show = (p: Part) => tab === 'all' || tab === p;

  return (
    <Modal open={!!fiche} onClose={onClose} title={`Historique — ${fiche.name}`} size="xl">
      <div className="space-y-5">
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
          <span className="flex items-center gap-1.5 pb-2.5 text-xs font-semibold text-text-muted"><CalendarRange size={14} /> {periodLabel}</span>
          <Button variant="gold" className="ms-auto" onClick={() => setPrintOpen(true)}><Printer size={16} /> Imprimer le rapport</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard icon={<Boxes size={16} />} tone="gold" title="Stock prêt" value={q(ready)}
            lines={[`Prix de vente : ${formatCurrency(fiche.unitPrice)}`, `Coût de revient : ${formatCurrency(fiche.costPerUnit)}`, `Gain / unité : ${formatCurrency(fiche.gainsPerUnit)}`]} />
          <SummaryCard icon={<Factory size={16} />} tone="amber" title="Production" value={q(t.producedQty)}
            lines={[`${t.batches} lot(s)`, `Coût : ${formatCurrency(t.prodCost)}`, `Coût moyen : ${formatCurrency(t.avgCost)}`, ...(t.lossQty ? [`Pertes : ${q(t.lossQty)}`] : [])]} />
          <SummaryCard icon={<Store size={16} />} tone="mint" title="Ventes caisse (POS)" value={q(t.posQty)}
            lines={[`${t.posCount} vente(s)`, `Total : ${formatCurrency(t.posAmount)}`]} />
          <SummaryCard icon={<Truck size={16} />} tone="rose" title="Ventes par bon de livraison" value={q(t.blQty)}
            lines={[`${t.blCount} bon(s) · ${t.blClients} client(s)`, `Total : ${formatCurrency(t.blAmount)}`, `Coût de revient : ${formatCurrency(t.blCost)}`, ...(t.recQty ? [`Récupéré : ${q(t.recQty)}`] : [])]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-pistachio/25 bg-pistachio/8 px-3.5 py-2 text-xs font-semibold text-text-primary">
          <span>Vendu net : {q(t.soldQty)}</span><span className="text-text-muted">·</span>
          <span>Chiffre d'affaires net : {formatCurrency(t.salesAmount)}</span>
          {t.lossQty > 0 && <Badge variant="danger" className="gap-1"><AlertTriangle size={10} /> Pertes {q(t.lossQty)}</Badge>}
        </div>

        <div className="flex flex-wrap gap-2">
          {([['all', 'Tout'], ['production', `Production (${data.prodRows.length})`], ['pos', `Caisse (${data.posRows.length})`], ['bl', `Bons de livraison (${data.blRows.length})`], ['recovery', `Récupérations (${data.recRows.length})`]] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${tab === id ? 'border-gold bg-gold/15 text-gold-dark' : 'border-gold/20 text-text-muted hover:bg-gold/5'}`}>
              {label}
            </button>
          ))}
        </div>

        {show('production') && (
          <Section icon={<Factory size={16} />} title="Production" subtitle={`${q(t.producedQty)} · ${formatCurrency(t.prodCost)}`}
            head={['Date', 'Origine', 'Vente liée', 'Quantité produite', 'Perte', 'Coût']}
            rows={data.prodRows.map((r) => [`${formatDate(r.date)}${r.hour ? ` ${r.hour}` : ''}`, r.origin, r.ref || '—', q(r.qty), r.loss ? q(r.loss) : '—', formatCurrency(r.cost)])}
            empty="Aucune production sur la période" />
        )}
        {show('pos') && (
          <Section icon={<Store size={16} />} title="Ventes caisse (POS)" subtitle={`${q(t.posQty)} · ${formatCurrency(t.posAmount)}`}
            head={['Date', 'Vente', 'Client', 'Quantité', 'Prix unitaire', 'Montant']}
            rows={data.posRows.map((r) => [formatDate(r.date), r.ref, r.client, q(r.qty), formatCurrency(r.price), formatCurrency(r.total)])}
            empty="Aucune vente caisse sur la période" />
        )}
        {show('bl') && (
          <Section icon={<Truck size={16} />} title="Ventes par bon de livraison" subtitle={`${q(t.blQty)} · ${formatCurrency(t.blAmount)}`}
            head={['Date', 'N° BL', 'Client', 'Dont stock prêt', 'Quantité', 'Prix unitaire', 'Montant']}
            rows={data.blRows.map((r) => [formatDate(r.date), r.ref, r.client, q(r.fromReady), q(r.qty), formatCurrency(r.price), formatCurrency(r.total)])}
            empty="Aucun bon de livraison sur la période" />
        )}
        {show('recovery') && (
          <Section icon={<Undo2 size={16} />} title="Récupérations" subtitle={`${q(t.recQty)} · ${formatCurrency(t.recAmount)}`}
            head={['Date', 'Référence', 'Client', 'Motif', 'Quantité', 'Montant']}
            rows={data.recRows.map((r) => [formatDate(r.date), r.ref, r.client, r.reason || '—', q(r.qty), formatCurrency(r.amount)])}
            empty="Aucune récupération sur la période" />
        )}
      </div>

      <Modal open={printOpen} onClose={() => setPrintOpen(false)} title="Imprimer l'historique" size="sm"
        footer={<Button variant="gold" disabled={!printParts.length} onClick={print}><Printer size={16} /> Imprimer</Button>}>
        <p className="mb-3 text-sm text-text-muted">Choisissez les parties à imprimer ({periodLabel.toLowerCase()}) :</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {([['Tout', PARTS.map((p) => p.id)], ['Production seule', ['production']], ['Ventes seules', ['pos', 'bl']]] as [string, Part[]][]).map(([label, ids]) => (
            <button key={label} type="button" onClick={() => setPrintParts(ids)}
              className="rounded-full border border-gold/25 px-3 py-1 text-xs font-semibold text-gold-dark hover:bg-gold/10">{label}</button>
          ))}
        </div>
        <div className="space-y-2">
          {PARTS.map((p) => (
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
