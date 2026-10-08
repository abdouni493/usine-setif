import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, PiggyBank, RotateCcw, Undo2, Wallet } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { useCommandStore } from '@/store/commandStore';
import { recoveredOnLine } from '@/lib/readyStock';
import { formatCurrency, formatNumber, PAYMENT_METHODS } from '@/lib/utils';
import type { CommandDelivery, DeliveryRecovery, PaymentMethod } from '@/types';

interface Props {
  delivery: CommandDelivery | null;
  onClose: () => void;
  onSaved: (recovery: DeliveryRecovery) => void;
}

const r3 = (n: number) => Math.round((n || 0) * 1000) / 1000;
const q = (n: number) => formatNumber(r3(n));

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * RÉCUPÉRER LA MARCHANDISE D'UN BON DE LIVRAISON.
 *
 * Les quantités récupérées reviennent au STOCK PRÊT du produit et redeviennent
 * « à livrer » sur la commande du client. La facture du bon baisse d'autant :
 * si le client avait déjà payé plus que ce qu'il garde, l'excédent lui est
 * rendu (sortie de caisse) ou reste sur son compte comme acompte.
 */
export function RecoveryModal({ delivery, onClose, onSaved }: Props) {
  const commands = useCommandStore((s) => s.commands);
  const recoveries = useCommandStore((s) => s.recoveries);
  const addRecovery = useCommandStore((s) => s.addRecovery);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [recoveredAt, setRecoveredAt] = useState(nowLocal());
  const [reason, setReason] = useState('');
  const [refundMode, setRefundMode] = useState<'cash' | 'credit'>('cash');
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!delivery) return;
    setQuantities({});
    setRecoveredAt(nowLocal());
    setReason('');
    setRefundMode('cash');
    setMethod('especes');
    setSaving(false);
  }, [delivery]);

  const command = delivery ? commands.find((c) => c.id === delivery.commandId) : undefined;

  /** Une ligne par ligne de commande livrée sur ce bon. */
  const rows = useMemo(() => {
    if (!delivery) return [];
    const map = new Map<string, { itemId: string; productName: string; unit?: string; delivered: number }>();
    delivery.items.forEach((it) => {
      if (!it.commandItemId) return;
      const cur = map.get(it.commandItemId);
      if (cur) cur.delivered += it.quantity;
      else map.set(it.commandItemId, { itemId: it.commandItemId, productName: it.productName, unit: it.sellUnit, delivered: it.quantity });
    });
    return [...map.values()].map((r) => {
      const already = recoveredOnLine(recoveries, delivery.id, r.itemId);
      const max = r3(Math.max(0, r.delivered - already));
      // la facture du bon valorise la ligne au prix de la commande
      const price = command?.items.find((x) => x.id === r.itemId)?.unitPrice ?? 0;
      const now = Math.min(max, Math.max(0, Number(quantities[r.itemId] ?? 0)));
      return { ...r, already, max, price, now };
    });
  }, [delivery, recoveries, quantities, command]);

  const money = useMemo(() => {
    const ht = rows.reduce((s, r) => s + r.now * r.price, 0);
    const rate = delivery?.tvaEnabled ? (delivery.tvaRate ?? 0) : 0;
    const tva = rate ? Math.round(ht * rate) / 100 : 0;
    const ttc = Math.round((ht + tva) * 100) / 100;
    const invoiceNow = delivery?.totalTtc ?? 0;
    const paid = delivery?.paidAmount ?? 0;
    const invoiceAfter = Math.max(0, invoiceNow - ttc);
    const excess = delivery?.isHistorical ? 0 : Math.max(0, Math.round((paid - invoiceAfter) * 100) / 100);
    const debtDrop = Math.min(ttc, Math.max(0, invoiceNow - paid));
    return { ht, tva, ttc, invoiceNow, invoiceAfter, paid, excess, debtDrop };
  }, [rows, delivery]);

  const totalNow = rows.reduce((s, r) => s + r.now, 0);

  const handleSave = async () => {
    if (!delivery) return;
    if (totalNow <= 0) { toast.error('Saisissez au moins une quantité à récupérer'); return; }
    setSaving(true);
    try {
      const rec = await addRecovery({
        deliveryId: delivery.id,
        recoveredAt: new Date(recoveredAt).toISOString(),
        reason: reason.trim(),
        refundMode,
        refundAmount: refundMode === 'cash' ? money.excess : 0,
        refundMethod: method,
        items: rows.filter((r) => r.now > 0).map((r) => ({ commandItemId: r.itemId, quantity: r3(r.now) })),
      });
      if (rec) {
        toast.success(
          rec.refundAmount > 0
            ? `Récupération ${rec.reference} enregistrée — ${formatCurrency(rec.refundAmount)} rendus au client`
            : `Récupération ${rec.reference} enregistrée — quantité remise au stock prêt`
        );
        onSaved(rec);
      }
    } catch {
      /* message déjà affiché */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!delivery}
      onClose={onClose}
      title={delivery ? `Récupérer la marchandise — ${delivery.reference}` : ''}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="gold" onClick={handleSave} disabled={saving || totalNow <= 0}>
            <RotateCcw size={16} /> {saving ? 'Enregistrement…' : 'Valider la récupération'}
          </Button>
        </>
      }
    >
      {delivery && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/20 bg-gradient-card px-4 py-3">
            <div>
              <p className="text-xs text-text-muted">Client</p>
              <p className="font-bold text-text-primary">{command?.clientName ?? '—'}</p>
              <p className="text-[11px] text-text-muted">Commande {command?.reference ?? '—'} · facture {delivery.saleReference ?? '—'}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-muted">Facture du bon</p>
              <p className="text-lg font-bold tabular text-gold-dark">{formatCurrency(money.invoiceNow)}</p>
              <p className="text-[11px] text-pistachio">Payé {formatCurrency(money.paid)}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gold/15">
            <table className="w-full text-sm">
              <thead className="bg-vanilla/60 text-text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">Produit</th>
                  <th className="px-3 py-2 text-center">Livré</th>
                  <th className="px-3 py-2 text-center">Déjà récupéré</th>
                  <th className="px-3 py-2 text-center">À récupérer</th>
                  <th className="px-3 py-2 text-right">P.U.</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const u = r.unit ? ` ${r.unit}` : '';
                  return (
                    <tr key={r.itemId} className="border-t border-gold/10">
                      <td className="px-3 py-2 font-medium text-text-primary">{r.productName}</td>
                      <td className="px-3 py-2 text-center tabular">{q(r.delivered)}{u}</td>
                      <td className="px-3 py-2 text-center tabular text-text-muted">{q(r.already)}{u}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1.5">
                          <input
                            type="number" step="any" min={0} max={r.max}
                            value={quantities[r.itemId] ?? 0}
                            disabled={r.max <= 0}
                            onChange={(e) => setQuantities((x) => ({ ...x, [r.itemId]: Math.max(0, Number(e.target.value)) }))}
                            className="h-9 w-24 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm font-semibold tabular text-text-primary focus:border-gold focus:outline-none disabled:opacity-50"
                          />
                          <button
                            type="button"
                            disabled={r.max <= 0}
                            onClick={() => setQuantities((x) => ({ ...x, [r.itemId]: r.max }))}
                            className="h-9 rounded-lg border border-gold/25 px-2 text-[11px] text-text-muted hover:bg-gold/10 disabled:opacity-40"
                          >
                            Tout
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular">{formatCurrency(r.price)}</td>
                      <td className="px-3 py-2 text-right tabular font-bold text-gold-dark">{formatCurrency(r.now * r.price)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Date et heure de la récupération"
              type="datetime-local"
              value={recoveredAt}
              onChange={(e) => setRecoveredAt(e.target.value)}
              icon={<CalendarClock size={15} />}
            />
            <Textarea
              label="Motif (facultatif)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Marchandise non conforme, surplus, erreur de livraison…"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Money label="Valeur récupérée" value={formatCurrency(money.ttc)} tone="text-gold-dark" />
            <Money label="Facture après" value={formatCurrency(money.invoiceAfter)} />
            <Money label="Dette réduite de" value={formatCurrency(money.debtDrop)} tone="text-pistachio" />
            <Money label="Argent à rendre" value={formatCurrency(money.excess)} tone={money.excess > 0 ? 'text-rose-deep' : 'text-text-muted'} />
          </div>

          {money.excess > 0.004 ? (
            <div className="space-y-3 rounded-2xl border-2 border-gold/30 bg-gold/5 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-gold-dark">
                Le client avait payé {formatCurrency(money.excess)} de plus que ce qu'il garde
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="radio" checked={refundMode === 'cash'} onChange={() => setRefundMode('cash')} className="mt-1 accent-[#B91C1C]" />
                <span>
                  <span className="flex items-center gap-1.5 font-semibold text-text-primary"><Wallet size={14} /> Rendre l'argent au client</span>
                  <span className="block text-[11px] text-text-muted">Sortie de caisse de {formatCurrency(money.excess)} à la date de la récupération, inscrite dans son historique.</span>
                </span>
              </label>
              {refundMode === 'cash' && (
                <div className="ml-6 flex flex-wrap gap-2">
                  {PAYMENT_METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMethod(m.value)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${method === m.value ? 'border-gold bg-gold text-white' : 'border-gold/25 text-text-secondary hover:bg-gold/10'}`}
                    >
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>
              )}
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="radio" checked={refundMode === 'credit'} onChange={() => setRefundMode('credit')} className="mt-1 accent-[#B91C1C]" />
                <span>
                  <span className="flex items-center gap-1.5 font-semibold text-text-primary"><PiggyBank size={14} /> Garder en acompte du client</span>
                  <span className="block text-[11px] text-text-muted">Aucune sortie de caisse : le montant paiera ses prochaines livraisons.</span>
                </span>
              </label>
            </div>
          ) : (
            totalNow > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-pistachio/30 bg-pistachio/10 px-3 py-2 text-xs font-semibold text-pistachio">
                <Undo2 size={14} className="mt-0.5 shrink-0" />
                Rien à rembourser : la facture du bon et la dette du client baissent de la valeur récupérée.
              </p>
            )
          )}

          <p className="flex items-start gap-2 text-[11px] text-text-muted">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            La quantité récupérée revient au stock prêt du produit et redevient « à livrer » sur la commande
            {command ? ` ${command.reference}` : ''}.
          </p>
        </div>
      )}
    </Modal>
  );
}

function Money({ label, value, tone = 'text-text-primary' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${tone}`}>{value}</p>
    </div>
  );
}
