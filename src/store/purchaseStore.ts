import { create } from 'zustand';
import type { Purchase, PurchaseReturn } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { todayISO } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { useStockStore } from './stockStore';
import { useCaisseStore } from './caisseStore';
import { ignoredEdits } from '@/lib/purchaseEdit';

export type AddPurchaseInput = Omit<
  Purchase,
  'id' | 'reference' | 'date' | 'totalAmount' | 'restAmount' | 'payments'
> & {
  date?: string;
  totalAmount?: number;
  restAmount?: number;
  payments?: Purchase['payments'];
};

/**
 * Modification d'une facture d'achat. Tout ce qui a été saisi à la création
 * peut être corrigé : fournisseur, date, bon de livraison, matricule, lignes
 * de marchandises et règlement. Les clés absentes gardent leur valeur — quand
 * `products` est omis, les lignes et le stock ne sont pas touchés.
 */
export interface UpdatePurchaseInput {
  supplierId?: string;
  date?: string;
  bonNumber?: string;
  driverPlate?: string;
  isHistorical?: boolean;
  paidAmount?: number;
  note?: string;
  products?: Purchase['products'];
}

/** Retour d'achat saisi : quantités rendues par ligne de la facture. */
export interface PurchaseReturnInput {
  purchaseId: string;
  date: string;
  reason?: string;
  items: { purchaseLineId: string; quantity: number }[];
}

interface PurchaseState {
  purchases: Purchase[];
  returns: PurchaseReturn[];
  addReturn: (input: PurchaseReturnInput) => Promise<PurchaseReturn | undefined>;
  deleteReturn: (id: string) => Promise<void>;
  load: () => Promise<void>;
  addPurchase: (p: AddPurchaseInput) => Promise<Purchase>;
  /** Edits an invoice — header AND lines; the stock follows the correction. */
  updatePurchase: (id: string, data: UpdatePurchaseInput) => Promise<void>;
  paySupplierDebt: (purchaseId: string, amount: number, date?: string) => Promise<void>;
  payDebt: (purchaseId: string, amount: number, date?: string) => Promise<void>;
  deletePurchase: (id: string) => Promise<void>;
}

export const usePurchaseStore = create<PurchaseState>()((set, get) => {
  const payFn = async (purchaseId: string, amount: number, date?: string) => {
    await save('purchases.payDebt', () => rpc.paySupplierDebt(purchaseId, amount, date));
    set({ purchases: await db.purchases.list() });
  };

  return {
    purchases: [],
    returns: [],

    load: async () => {
      const [purchases, returns] = await Promise.all([db.purchases.list(), db.purchaseReturns.list()]);
      set({ purchases, returns });
    },

    addReturn: async (input) => {
      const row = await save<{ id: string }>('purchases.return', () =>
        rpc.createPurchaseReturn({
          purchase_id: input.purchaseId,
          date: input.date,
          reason: input.reason ?? '',
          items: input.items
            .filter((i) => i.quantity > 0)
            .map((i) => ({ purchase_line_id: i.purchaseLineId, quantity: i.quantity })),
        })
      );
      const [purchases, returns] = await Promise.all([db.purchases.list(), db.purchaseReturns.list()]);
      set({ purchases, returns });
      await Promise.all([
        useStockStore.getState().load(),
        useCaisseStore.getState().load(),
      ]).catch(() => undefined);
      return returns.find((r) => r.id === row?.id);
    },

    deleteReturn: async (id) => {
      await save('purchases.return.delete', () => db.purchaseReturns.remove(id));
      const [purchases, returns] = await Promise.all([db.purchases.list(), db.purchaseReturns.list()]);
      set({ purchases, returns });
      await Promise.all([
        useStockStore.getState().load(),
        useCaisseStore.getState().load(),
      ]).catch(() => undefined);
    },

    addPurchase: async (p) => {
      const total =
        p.totalAmount ?? p.products.reduce((acc, pr) => acc + pr.quantity * pr.purchasePrice, 0);
      const paid = p.paidAmount || 0;
      const purDate = p.date || todayISO();

      // create_purchase() writes the invoice + its lines, feeds the stock
      // (trg_purchase_line_stock) and books the caisse withdrawal.
      // « Ancien achat » (is_historical) : la facture est enregistrée à sa date
      // d'origine mais ni le stock ni la caisse ne bougent.
      const row = await save('purchases.create', () =>
        rpc.createPurchase({
          supplier_id: p.supplierId,
          date: purDate,
          driver_plate: p.driverPlate?.trim() || null,
          bon_number: p.bonNumber?.trim() || null,
          is_historical: p.isHistorical ?? false,
          total_amount: total,
          paid_amount: paid,
          products: p.products.map((l) => ({
            product_id: l.productId,
            product_name: l.productName,
            quantity: l.quantity,
            purchase_price: l.purchasePrice,
            min_alert_quantity: l.minAlertQuantity ?? null,
            unit_enabled: l.unitEnabled ?? false,
            unit: l.unit ?? null,
            expiration_enabled: l.expirationEnabled ?? false,
            expiration_date: l.expirationDate,
          })),
        })
      );

      // The purchase changed the stock: reload both lists from the database so
      // the /stock screen immediately shows the new quantities.
      const [purchases] = await Promise.all([db.purchases.list(), useStockStore.getState().load()]);
      set({ purchases });

      // Filet de sécurité : « ancien achat » n'existe que si
      // supabase/papeterie_supabase_full.sql a été exécuté.
      const saved = purchases.find((x) => x.id === row.id);
      if (p.isHistorical && saved && !saved.isHistorical) {
        toast.error(
          "Base de données non mise à jour : la facture a été enregistrée normalement " +
          "(stock alimenté). Exécutez supabase/papeterie_supabase_full.sql."
        );
      }

      return (
        purchases.find((x) => x.id === row.id) ?? {
          ...(p as unknown as Purchase),
          id: row.id,
          reference: row.reference,
          date: purDate,
          isHistorical: p.isHistorical ?? false,
          totalAmount: total,
          paidAmount: paid,
          restAmount: Math.max(0, total - paid),
          payments: [],
        }
      );
    },

    updatePurchase: async (id, data) => {
      await save('purchases.update', () =>
        rpc.updatePurchase(id, {
          supplier_id: data.supplierId ?? null,
          date: data.date ?? null,
          bon_number: data.bonNumber ?? null,
          driver_plate: data.driverPlate ?? null,
          is_historical: data.isHistorical ?? null,
          paid_amount: data.paidAmount ?? null,
          note: data.note ?? null,
          // `products` absent => update_purchase() ne touche ni aux lignes ni au
          // stock ; présent => il remplace les lignes et corrige le stock de
          // l'ÉCART entre l'ancienne et la nouvelle quantité, produit par
          // produit (la marchandise déjà vendue n'est donc jamais recomptée).
          ...(data.products
            ? {
                products: data.products.map((l) => ({
                  product_id: l.productId,
                  product_name: l.productName,
                  quantity: l.quantity,
                  purchase_price: l.purchasePrice,
                  min_alert_quantity: l.minAlertQuantity ?? null,
                  unit_enabled: l.unitEnabled ?? false,
                  unit: l.unit ?? null,
                  expiration_enabled: l.expirationEnabled ?? false,
                  expiration_date: l.expirationDate,
                })),
              }
            : {}),
        })
      );
      // update_purchase() réconcilie le stock par écart et refait le règlement :
      // les trois écrans concernés sont rechargés depuis la base.
      const [purchases] = await Promise.all([
        db.purchases.list(),
        data.products ? useStockStore.getState().load() : Promise.resolve(),
        useCaisseStore.getState().load(),
      ]);
      set({ purchases });

      const saved = purchases.find((p) => p.id === id);
      const ignored = saved ? ignoredEdits(saved, data) : [];
      if (ignored.length > 0) {
        toast.error(
          `Base de données non à jour : ${ignored.join(', ')} n'a pas été enregistré. ` +
          'Exécutez supabase/papeterie_supabase_full.sql.'
        );
        throw new Error(`update_purchase obsolète — ignoré : ${ignored.join(', ')}`);
      }
    },

    paySupplierDebt: payFn,
    payDebt: payFn,

    deletePurchase: async (id) => {
      await save('purchases.delete', () => db.purchases.remove(id));
      set({ purchases: get().purchases.filter((p) => p.id !== id) });
    },
  };
});
