import { useEffect, useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { usePurchaseStore } from '@/store/purchaseStore';
import { useSupplierStore } from '@/store/supplierStore';
import { useSettingsStore } from '@/store/settingsStore';
import { printPurchaseReturn } from '@/lib/documents';
import { formatCurrency, formatNumber, todayISO } from '@/lib/utils';
import type { Purchase, PurchaseReturn } from '@/types';

interface Props {
  purchase: Purchase | null;
  onClose: () => void;
}

const r3 = (n: number) => Math.round((n || 0) * 1000) / 1000;

/** Impression d'un retour d'achat enregistré. */
export function printReturn(ret: PurchaseReturn, purchase: Purchase | undefined) {
  const supplier = useSupplierStore.getState().suppliers.find((s) => s.id === ret.supplierId);
  printPurchaseReturn({
    reference: ret.reference,
    purchaseReference: purchase?.reference ?? '—',
    date: ret.date,
    supplierName: supplier?.name ?? '—',
    supplierPhone: supplier?.phone,
    reason: ret.reason,
    lines: ret.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice })),
    totalAmount: ret.totalAmount,
    refundAmount: ret.refundAmount,
  }, useSettingsStore.getState().settings);
}

/**
 * RETOUR D'ACHAT — la marchandise achetée est rendue au fournisseur : elle sort
 * du stock, la facture d'achat baisse d'autant et l'argent déjà payé en trop
 * revient en caisse. Le retour apparaît dans l'historique du fournisseur.
 */
export function PurchaseReturnModal({ purchase, onClose }: Props) {
  const returns = usePurchaseStore((s) => s.returns);
  const addReturn = usePurchaseStore((s) => s.addReturn);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [date, setDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setQty({}); setDate(todayISO()); setReason(''); setSaving(false);
  }, [purchase]);

  const lines = useMemo(() => {
    if (!purchase) return [];
    return purchase.products
      .filter((l) => l.lineId)
      .map((l) => {
        const done = returns
          .filter((r) => r.purchaseId === purchase.id)
          .flatMap((r) => r.items)
          .filter((i) => i.purchaseLineId === l.lineId)
          .reduce((s, i) => s + i.quantity, 0);
        return { ...l, lineId: l.lineId as string, left: r3(Math.max(0, l.quantity - done)) };
      });
  }, [purchase, returns]);

  const total = lines.reduce((s, l) => s + Math.min(qty[l.lineId] ?? 0, l.left) * l.purchasePrice, 0);
  // l'argent récupéré : ce qui a été payé au-delà du nouveau total de la facture
  const refund = purchase ? Math.max(0, Math.min(total, purchase.paidAmount - (purchase.totalAmount - total))) : 0;

  const handleSave = async () => {
    if (!purchase) return;
    const items = lines
      .map((l) => ({ purchaseLineId: l.lineId, quantity: r3(qty[l.lineId] ?? 0), left: l.left, name: l.productName }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) { toast.error('Saisissez au moins une quantité à rendre'); return; }
    const over = items.find((i) => i.quantity > i.left + 0.0005);
    if (over) { toast.error(`« ${over.name} » : au plus ${formatNumber(over.left)} peuvent être rendus`); return; }
    setSaving(true);
    try {
      const ret = await addReturn({ purchaseId: purchase.id, date, reason: reason.trim(), items });
      toast.success(`Retour enregistré — ${formatCurrency(ret?.refundAmount ?? refund)} récupérés, stock mis à jour`);
      onClose();
      if (ret && window.confirm('Imprimer le bon de retour ?')) printReturn(ret, purchase);
    } catch {
      /* message déjà affiché */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!purchase}
      onClose={onClose}
      title={purchase ? `Retour d'achat — ${purchase.reference}` : ''}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="gold" onClick={handleSave} disabled={saving || total <= 0}>
            <Undo2 size={16} /> {saving ? 'Enregistrement…' : 'Valider le retour'}
          </Button>
        </>
      }
    >
      {purchase && (
        <div className="space-y-4">
          <p className="text-xs text-text-muted">
            Les quantités rendues sortent du stock, la facture d'achat est réduite d'autant et l'argent déjà
            payé au fournisseur pour cette marchandise revient en caisse.
          </p>
          <div className="overflow-x-auto rounded-xl border border-gold/20">
            <table className="w-full text-sm">
              <thead className="bg-gold/10 text-xs uppercase text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Produit</th>
                  <th className="px-3 py-2 text-right">Acheté</th>
                  <th className="px-3 py-2 text-right">Rendable</th>
                  <th className="px-3 py-2 text-right">Prix U</th>
                  <th className="px-3 py-2 text-center">Qté rendue</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.lineId} className="border-t border-gold/10">
                    <td className="px-3 py-2 font-semibold text-text-primary">{l.productName}</td>
                    <td className="px-3 py-2 text-right tabular">{formatNumber(l.quantity)}{l.unit ? ` ${l.unit}` : ''}</td>
                    <td className="px-3 py-2 text-right tabular text-gold-dark">{formatNumber(l.left)}</td>
                    <td className="px-3 py-2 text-right tabular">{formatCurrency(l.purchasePrice)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1.5">
                        <input
                          type="number" step="any" min={0} max={l.left}
                          disabled={l.left <= 0}
                          value={qty[l.lineId] ?? ''}
                          onChange={(e) => setQty((q) => ({ ...q, [l.lineId]: Math.max(0, Number(e.target.value)) }))}
                          className="h-9 w-24 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm font-bold tabular text-text-primary focus:border-gold focus:outline-none disabled:opacity-50"
                        />
                        <button
                          type="button"
                          disabled={l.left <= 0}
                          onClick={() => setQty((q) => ({ ...q, [l.lineId]: l.left }))}
                          className="h-9 rounded-lg border border-gold/25 px-2 text-[11px] font-semibold text-text-muted hover:bg-gold/10 disabled:opacity-50"
                        >
                          Tout
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Date du retour" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="rounded-xl border border-gold/20 bg-gradient-card px-4 py-3 text-sm">
              <p className="flex justify-between"><span className="text-text-muted">Valeur rendue</span><b>{formatCurrency(total)}</b></p>
              <p className="flex justify-between"><span className="text-text-muted">Argent récupéré (caisse)</span><b className="text-pistachio">{formatCurrency(refund)}</b></p>
              <p className="flex justify-between"><span className="text-text-muted">Déduit de la dette</span><b>{formatCurrency(Math.max(0, total - refund))}</b></p>
            </div>
          </div>
          <Textarea label="Motif du retour" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>
      )}
    </Modal>
  );
}
