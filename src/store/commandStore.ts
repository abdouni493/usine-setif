import { create } from 'zustand';
import type {
  CommandDelivery, CommandDeliveryItem, CommandAdjustment, CommandAdjustmentLine, CommandPayment,
  DeliveryRecovery, PaymentMethod,
} from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';
import { recoveredByDelivery } from '@/lib/readyStock';
import { useStockStore } from './stockStore';
import { useSalesStore } from './salesStore';
import { useProductionStore } from './productionStore';

export interface CommandItem {
  /** database id of the line — needed to attribute a delivery to it */
  id?: string;
  /** Rang de la ligne dans la commande — distingue deux lignes du MEME produit. */
  position?: number;
  /** Quantite annulee sur cette ligne (le client a renonce au reste). */
  cancelledQuantity?: number;
  productId?: string;
  productName: string;
  quantity: number;
  /** quantity already delivered across every "Livraison" of the command */
  deliveredQuantity?: number;
  unitPrice: number;
  totalPrice: number;
  sellByUnit?: boolean;
  sellUnit?: string;
  ficheTechnicId?: string;
}

export type CommandLine = CommandItem;

export interface Command {
  id: string;
  reference: string;
  /** N° de bon de commande saisi manuellement (repère client, recherche). */
  bonNumber?: string;
  createdAt: string;
  receiveDate: string;
  receiveHour: string;
  receiveMinute: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  /** Adresse de livraison — saisie obligatoirement à chaque commande. */
  clientAddress?: string;
  /** Chauffeur prévu pour emmener la commande. */
  driverName?: string;
  /** Immatriculation du camion — facultative. */
  driverPlate?: string;
  items: CommandItem[];
  /** Total HORS TAXES des lignes de la commande. */
  totalAmount: number;
  /** TVA activee sur la commande — reprise par defaut sur chaque livraison. */
  tvaEnabled?: boolean;
  /** Taux applique en pourcentage (19 % par defaut). */
  tvaRate?: number;
  /** Montant de TVA = total HT x taux / 100. */
  tvaAmount?: number;
  /** Net a payer : total HT + TVA. C'est lui qui determine le reste du. */
  totalTtc?: number;
  advancePaid: number;
  /** Reglements encaisses depuis l'ecran « Commandes » (hors acompte). */
  extraPaid?: number;
  /** Detail date de ces reglements (table command_payments). */
  payments?: CommandPayment[];
  /** Acompte du client (avance) utilise comme acompte de la commande. */
  creditApplied?: number;
  paidAmount: number;
  restAmount: number;
  status: 'pending' | 'finalised' | 'cancelled';
  /**
   * « Ancienne commande » : commande antérieure saisie a posteriori pour
   * reconstituer l'historique d'un client. Rien n'est déduit du stock, aucune
   * production n'est lancée et aucune écriture de caisse n'est générée — seule
   * la statistique commerciale (client, dette, rapports) est alimentée.
   */
  isHistorical?: boolean;
  notes?: string;
  createdBy: string;
}

export type AddCommandInput = Omit<
  Command,
  'id' | 'reference' | 'createdAt' | 'paidAmount' | 'restAmount' | 'status' | 'createdBy' | 'advancePaid'
  | 'totalTtc' | 'tvaAmount' | 'extraPaid' | 'payments' | 'creditApplied'
> & {
  createdBy?: string;
  advancePaid?: number;
  paidAmount?: number;
  /** Optional manual creation date (ISO) — lets the POS back-date a command. */
  createdAt?: string;
};

/** Ordered vs delivered summary of a command — drives the card alert. */
export function deliveryStatus(cmd: Command) {
  const ordered = cmd.items.reduce((s, i) => s + i.quantity, 0);
  const delivered = cmd.items.reduce((s, i) => s + (i.deliveredQuantity ?? 0), 0);
  // Le solde auquel le client a RENONCE ne doit plus etre attendu : une
  // commande de 100 livree a 70 puis annulee pour 30 est « livree ».
  const cancelled = cmd.items.reduce((s, i) => s + (i.cancelledQuantity ?? 0), 0);
  const expected = Math.max(0, ordered - cancelled);
  const remaining = Math.max(0, expected - delivered);
  return {
    ordered,
    delivered,
    cancelled,
    expected,
    remaining,
    // Une commande dont TOUT le reste a ete annule n'attend plus rien : elle
    // est « livree », meme si la quantite attendue est tombee a zero.
    isFull: remaining <= 0.0001,
    isPartial: delivered > 0 && remaining > 0.0001,
    percent: expected > 0 ? Math.min(100, (delivered / expected) * 100) : 0,
  };
}

/** Ligne saisie dans « Annuler le reste » / « Augmenter la commande ». */
export interface AdjustmentInput {
  commandItemId?: string;
  productName: string;
  quantity: number;
  unitPrice?: number;
  unit?: string;
}

/** Une ligne saisie dans l'écran Livraisons : un produit et sa quantité. */
export interface ClientDeliveryLineInput {
  ficheTechnicId?: string;
  productName: string;
  quantity: number;
}

/** Livraison saisie depuis l'écran Livraisons (client → produits → quantités). */
export interface ClientDeliveryInput {
  clientId: string;
  /** ISO datetime de la remise. */
  deliveredAt: string;
  notes?: string;
  driverName?: string;
  driverPlate?: string;
  location?: string;
  tvaEnabled?: boolean;
  tvaRate?: number;
  /** Argent encaissé à la remise (réparti sur les bons créés, dans l'ordre). */
  cashPaid?: number;
  /** Imputer l'acompte des commandes servies (oui par défaut). */
  useAdvance?: boolean;
  /** Acompte LIBRE du client à utiliser sur les factures créées. */
  creditUsed?: number;
  lines: ClientDeliveryLineInput[];
  /** Quantités livrées HORS commande : une commande est créée pour elles. */
  directLines?: (ClientDeliveryLineInput & { unitPrice: number; sellByUnit?: boolean; sellUnit?: string })[];
}

/** Récupération de marchandise saisie sur un bon de livraison. */
export interface RecoveryInput {
  deliveryId: string;
  recoveredAt: string;
  reason?: string;
  /** 'cash' : l'argent est rendu (sortie de caisse) · 'credit' : il reste en acompte. */
  refundMode: 'cash' | 'credit';
  refundAmount?: number;
  refundMethod?: PaymentMethod;
  items: { commandItemId: string; quantity: number }[];
}

interface CommandState {
  commands: Command[];
  deliveries: CommandDelivery[];
  /** Annulations du reste et augmentations enregistrees sur les commandes. */
  adjustments: CommandAdjustment[];
  /** Récupérations de marchandise sur les bons de livraison. */
  recoveries: DeliveryRecovery[];
  load: () => Promise<void>;
  addCommand: (c: AddCommandInput) => Promise<Command>;
  /** Returns false when the product lines were kept because a delivery exists. */
  updateCommand: (id: string, data: Partial<Command>) => Promise<boolean>;
  /** Annule le reste NON LIVRE : plus de dette ni de quantite en attente. */
  cancelRemainder: (
    commandId: string, lines: AdjustmentInput[], reason: string, date?: string
  ) => Promise<CommandAdjustment | undefined>;
  /** Augmente les quantites commandees d'une commande deja passee. */
  increaseCommand: (
    commandId: string, lines: AdjustmentInput[], reason: string, date?: string
  ) => Promise<CommandAdjustment | undefined>;
  /** Supprime un ajustement — la commande revient a l'etat precedent. */
  deleteAdjustment: (id: string) => Promise<void>;
  payDebt: (commandId: string, amount: number, date?: string) => Promise<void>;
  /** Corrige un reglement de commande deja encaisse (montant, date). */
  updateCommandPayment: (id: string, amount: number, date: string, notes?: string) => Promise<void>;
  updateStatus: (commandId: string, status: Command['status']) => Promise<void>;
  deleteCommand: (id: string) => Promise<void>;
  // ---- livraisons ----
  addDelivery: (
    commandId: string,
    items: CommandDeliveryItem[],
    deliveredAt: string,
    notes?: string,
    driver?: DeliveryDriver,
    payment?: DeliveryPayment
  ) => Promise<CommandDelivery>;
  updateDelivery: (
    id: string,
    items: CommandDeliveryItem[],
    deliveredAt: string,
    notes?: string,
    driver?: DeliveryDriver,
    payment?: DeliveryPayment
  ) => Promise<void>;
  deleteDelivery: (id: string) => Promise<void>;
  // ---- écran Livraisons ----
  /** Crée un bon par commande servie ; renvoie les bons créés. */
  addClientDelivery: (input: ClientDeliveryInput) => Promise<CommandDelivery[]>;
  updateClientDelivery: (id: string, input: ClientDeliveryInput) => Promise<CommandDelivery | undefined>;
  addRecovery: (input: RecoveryInput) => Promise<DeliveryRecovery | undefined>;
  deleteRecovery: (id: string) => Promise<void>;
}

/** Chauffeur et lieu d'une livraison — repris de la commande ou saisis à la volée. */
export interface DeliveryPayment {
  /** TVA appliquee a ce bon (par defaut celle de la commande). */
  tvaEnabled?: boolean;
  tvaRate?: number;
  /** Argent reellement encaisse au moment de la remise (entre en caisse). */
  cashPaid?: number;
  /** Part de l'acompte de la commande imputee ici (n'entre pas en caisse). */
  advanceApplied?: number;
  /**
   * Acompte du CLIENT (verse en trop auparavant) a utiliser sur ce bon — impute
   * apres la creation de la facture, sans ecriture de caisse.
   */
  creditUsed?: number;
}

export interface DeliveryDriver {
  driverName?: string;
  driverPlate?: string;
  /** Lieu réellement livré pour ce bon (défaut : adresse de la commande). */
  location?: string;
}

/**
 * `position` fige l'ORDRE DE SAISIE des lignes. Une commande peut porter
 * plusieurs fois le MEME produit avec des quantites et des prix differents :
 * sans ce reperage, les lignes se confondraient d'un rechargement a l'autre.
 */
const itemPayload = (i: CommandItem, index = 0) => ({
  // `id` permet a `update_command()` de RETROUVER la ligne existante : sans
  // lui, une modification supprimerait puis recreerait les lignes et les
  // quantites deja livrees seraient orphelines.
  id: i.id ?? null,
  position: i.position ?? index,
  product_id: i.productId ?? null,
  fiche_technic_id: i.ficheTechnicId ?? null,
  product_name: i.productName,
  quantity: i.quantity,
  unit_price: i.unitPrice,
  total_price: i.totalPrice,
  sell_by_unit: i.sellByUnit ?? false,
  sell_unit: i.sellUnit ?? null,
});

const adjustmentPayload = (l: AdjustmentInput) => ({
  command_item_id: l.commandItemId ?? null,
  product_name: l.productName,
  quantity: l.quantity,
  unit_price: l.unitPrice ?? null,
  unit: l.unit ?? null,
});

const deliveryItemPayload = (i: CommandDeliveryItem) => ({
  command_item_id: i.commandItemId ?? null,
  product_name: i.productName,
  quantity: i.quantity,
  sell_unit: i.sellUnit ?? null,
});

/**
 * Recharge « Gestion de stock » ET les productions après une livraison : le
 * manquant du stock prêt est produit automatiquement (matières déduites).
 */
const reloadStock = () =>
  Promise.all([
    useStockStore.getState().load(),
    useProductionStore.getState().load(),
  ]).catch(() => undefined);

/** Chaque bon connaît la quantité (et le coût) déjà récupérés sur lui. */
const withRecoveries = (deliveries: CommandDelivery[], recoveries: DeliveryRecovery[]) => {
  const rec = recoveredByDelivery(recoveries);
  return deliveries.map((d) => {
    const r = rec.get(d.id);
    return r ? { ...d, recoveredQuantity: r.quantity, recoveredCost: r.cost } : d;
  });
};

/** Lignes de l'écran Livraisons envoyées à la base. */
const clientDeliveryPayload = (i: ClientDeliveryInput) => ({
  client_id: i.clientId,
  delivered_at: i.deliveredAt,
  notes: i.notes ?? '',
  driver_name: i.driverName ?? '',
  driver_plate: i.driverPlate ?? '',
  location: i.location ?? '',
  ...(i.tvaEnabled === undefined
    ? {}
    : { tva_enabled: i.tvaEnabled, tva_rate: i.tvaEnabled ? (i.tvaRate ?? 19) : 0 }),
  cash_paid: Math.max(0, i.cashPaid ?? 0),
  use_advance: i.useAdvance ?? true,
  lines: i.lines
    .filter((l) => l.quantity > 0)
    .map((l) => ({
      fiche_technic_id: l.ficheTechnicId ?? null,
      product_name: l.productName,
      quantity: l.quantity,
    })),
  direct_lines: (i.directLines ?? [])
    .filter((l) => l.quantity > 0)
    .map((l) => ({
      fiche_technic_id: l.ficheTechnicId ?? null,
      product_name: l.productName,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      sell_by_unit: !!l.sellByUnit,
      sell_unit: l.sellUnit ?? null,
    })),
});

/** Option TVA envoyee a la base — omise quand l'appelant ne la precise pas. */
const tvaPayload = (p?: DeliveryPayment) =>
  p?.tvaEnabled === undefined
    ? {}
    : { tva_enabled: p.tvaEnabled, tva_rate: p.tvaEnabled ? (p.tvaRate ?? 19) : 0 };

/**
 * Une livraison EST une vente : la facture qu'elle genere doit apparaitre
 * immediatement dans « Ventes », dans la caisse et sur la fiche du client.
 */
const reloadSales = () =>
  useSalesStore.getState().load().catch(() => undefined);

/**
 * Le compte du client suit chaque modification : l'acompte (argent libere par
 * un bon ou un prix en baisse), ses anciennes dettes et la caisse sont relus.
 * Sans cela, la carte et le compte rendu gardaient les anciens montants.
 * Import dynamique : `clientStore` importe deja ce module.
 */
const reloadAccounts = async () => {
  try {
    const [{ useClientStore }, { useCaisseStore }] = await Promise.all([
      import('./clientStore'), import('./caisseStore'),
    ]);
    await Promise.all([useClientStore.getState().load(), useCaisseStore.getState().load()]);
  } catch {
    /* relus au prochain passage sur l'ecran */
  }
};

export const useCommandStore = create<CommandState>()((set, get) => ({
  commands: [],
  deliveries: [],
  adjustments: [],

  recoveries: [],

  load: async () => {
    const [commands, deliveries, adjustments, recoveries] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      db.deliveryRecoveries.list(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, recoveries), adjustments, recoveries });
  },

  addCommand: async (data) => {
    const advance = data.advancePaid ?? data.paidAmount ?? 0;
    const row = await save('commands.create', () =>
      rpc.createCommand({
        client_id: data.clientId,
        client_name: data.clientName,
        client_phone: data.clientPhone ?? null,
        client_address: data.clientAddress ?? null,
        driver_name: data.driverName ?? null,
        driver_plate: data.driverPlate ?? null,
        receive_date: data.receiveDate || null,
        receive_hour: data.receiveHour,
        receive_minute: data.receiveMinute,
        total_amount: data.totalAmount,
        tva_enabled: data.tvaEnabled ?? false,
        tva_rate: data.tvaEnabled ? (data.tvaRate ?? 19) : 0,
        advance_paid: advance,
        notes: data.notes ?? null,
        bon_number: data.bonNumber ?? null,
        is_historical: data.isHistorical ?? false,
        created_at: data.createdAt ?? null,
        items: data.items.map(itemPayload),
      })
    );
    const commands = await db.commands.list();
    set({ commands });
    return commands.find((c) => c.id === row.id) as Command;
  },

  /**
   * MODIFIER UNE COMMANDE — EN ENTIER.
   *
   * L'ancienne version n'ecrivait que quelques colonnes de l'en-tete : la TVA,
   * l'acompte, le n de bon, l'adresse, le chauffeur et surtout les LIGNES
   * repartaient a l'identique — « je modifie et rien ne change ».
   *
   * Tout passe desormais par `update_command()` cote base, qui :
   *   - reecrit l'en-tete (client, dates, TVA, acompte, n de bon, notes) ;
   *   - remplace les lignes EN CONSERVANT ce qui a deja ete livre (une ligne
   *     deja servie ne peut pas descendre sous la quantite remise) ;
   *   - recalcule total H.T / TVA / T.T.C, l'acompte, le reste du et
   *     l'ecriture de caisse de l'acompte ;
   *   - reconstruit les factures de vente des bons de livraison, donc la
   *     dette du client, la caisse et les rapports.
   */
  updateCommand: async (id, data) => {
    const hasDeliveries = get().deliveries.some((d) => d.commandId === id);
    const payload: Record<string, unknown> = {
      client_id: data.clientId,
      client_name: data.clientName,
      client_phone: data.clientPhone ?? null,
      receive_date: data.receiveDate || null,
      receive_hour: data.receiveHour,
      receive_minute: data.receiveMinute,
      // sans total, la base le recalcule des lignes (annulations deduites)
      ...(data.totalAmount !== undefined ? { total_amount: data.totalAmount } : {}),
      notes: data.notes ?? null,
      ...(data.tvaEnabled !== undefined
        ? { tva_enabled: data.tvaEnabled, tva_rate: data.tvaEnabled ? (data.tvaRate ?? 19) : 0 }
        : {}),
      ...(data.advancePaid !== undefined ? { advance_paid: data.advancePaid } : {}),
      ...(data.clientAddress !== undefined ? { client_address: data.clientAddress || null } : {}),
      ...(data.driverName !== undefined ? { driver_name: data.driverName || null } : {}),
      ...(data.driverPlate !== undefined ? { driver_plate: data.driverPlate || null } : {}),
      ...(data.bonNumber !== undefined ? { bon_number: data.bonNumber || null } : {}),
      ...(data.isHistorical !== undefined ? { is_historical: data.isHistorical } : {}),
      ...(data.createdAt ? { created_at: data.createdAt } : {}),
      ...(data.items ? { items: data.items.map(itemPayload) } : {}),
    };

    let linesKept = true;
    try {
      const row = await save<{ lines_replaced?: boolean }>('commands.update', () =>
        rpc.updateCommand(id, payload)
      );
      linesKept = row?.lines_replaced !== false;
    } catch (e) {
      // Base pas encore a jour : on retombe sur l'ancienne ecriture directe.
      const msg = (e as Error).message;
      if (!/PGRST202|Could not find the function|does not exist|schema cache/i.test(msg)) throw e;
      await save('commands.update.legacy', () => db.commands.update(id, payload));
      if (data.items && !hasDeliveries) {
        await save('commands.updateItems', () =>
          db.commands.replaceItems(id, data.items!.map(itemPayload))
        );
      }
      linesKept = !hasDeliveries;
    }

    // L'acompte et la TVA ont bouge : les factures des bons, la caisse et la
    // fiche du client doivent repartir des valeurs recalculees par la base.
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadSales(), reloadStock(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, get().recoveries), adjustments });
    return linesKept;
  },

  payDebt: async (commandId, amount, date) => {
    await save('commands.pay', () => rpc.payCommand(commandId, amount, date));
    // le reglement descend sur les bons : leurs factures changent aussi
    const [commands, deliveries] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), reloadSales(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, get().recoveries) });
  },

  updateCommandPayment: async (id, amount, date, notes) => {
    await save('commands.payment.update', () => rpc.updateCommandPayment(id, amount, date, notes));
    // l'argent de la commande est re-reparti sur ses bons (factures comprises)
    const [commands, deliveries] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), reloadSales(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, get().recoveries) });
  },

  updateStatus: async (commandId, status) => {
    await save('commands.status', () => rpc.setCommandStatus(commandId, status));
    set({ commands: await db.commands.list() });
  },

  /**
   * ANNULER LE RESTE NON LIVRE.
   * Le client s'arrete a 70 unites sur 100 et renonce au solde : chaque ligne
   * est ramenee a ce qui a ete reellement remis. Le reste du disparait de sa
   * fiche, la commande passe en « livree » et l'ecart est archive.
   */
  cancelRemainder: async (commandId, lines, reason, date) => {
    const row = await save<{ id: string }>('commands.cancelRemainder', () =>
      rpc.cancelCommandRemainder({
        command_id: commandId,
        reason,
        date: date ?? null,
        lines: lines.filter((l) => l.quantity > 0).map(adjustmentPayload),
      })
    );
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadSales(), reloadStock(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, get().recoveries), adjustments });
    return adjustments.find((a) => a.id === row?.id);
  },

  /**
   * AUGMENTER LA COMMANDE.
   * Le client en redemande : la quantite de chaque ligne choisie augmente, le
   * total et le reste du suivent, et le supplement est archive pour le rapport.
   */
  increaseCommand: async (commandId, lines, reason, date) => {
    const row = await save<{ id: string }>('commands.increase', () =>
      rpc.increaseCommand({
        command_id: commandId,
        reason,
        date: date ?? null,
        lines: lines.filter((l) => l.quantity > 0).map(adjustmentPayload),
      })
    );
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadSales(), reloadStock(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, get().recoveries), adjustments });
    return adjustments.find((a) => a.id === row?.id);
  },

  deleteAdjustment: async (id) => {
    await save('commands.adjustment.delete', () => rpc.deleteCommandAdjustment(id));
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadSales(), reloadStock(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, get().recoveries), adjustments });
  },

  deleteCommand: async (id) => {
    const hadDeliveries = get().deliveries.some((d) => d.commandId === id);
    await save('commands.delete', () => db.commands.remove(id));
    // Tout ce qui pendait a cette commande disparait avec elle : ses bons de
    // livraison (donc leurs factures de vente), ses annulations et ses
    // augmentations — plus rien ne doit la faire réapparaître dans un rapport.
    const goneDeliveries = new Set(get().deliveries.filter((d) => d.commandId === id).map((d) => d.id));
    set({
      commands: get().commands.filter((c) => c.id !== id),
      deliveries: get().deliveries.filter((d) => d.commandId !== id),
      adjustments: get().adjustments.filter((a) => a.commandId !== id),
      recoveries: get().recoveries.filter((r) => !goneDeliveries.has(r.deliveryId)),
    });
    // ses livraisons partent en cascade : leurs matières reviennent au stock
    await Promise.all([reloadAccounts(), ...(hadDeliveries ? [reloadStock(), reloadSales()] : [])]);
  },

  addDelivery: async (commandId, items, deliveredAt, notes = '', driver, payment) => {
    const row = await save('commands.deliver', () =>
      rpc.createCommandDelivery({
        command_id: commandId,
        delivered_at: deliveredAt,
        notes,
        driver_name: driver?.driverName ?? null,
        driver_plate: driver?.driverPlate ?? null,
        location: driver?.location ?? null,
        ...tvaPayload(payment),
        cash_paid: payment?.cashPaid ?? 0,
        advance_applied: payment?.advanceApplied ?? 0,
        items: items.map(deliveryItemPayload),
      })
    );
    // La livraison a retiré les matières premières du stock : « Gestion de
    // stock » doit repartir des quantités réelles de la base.
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadStock(), reloadSales(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, get().recoveries), adjustments });
    return deliveries.find((d) => d.id === row.id) as CommandDelivery;
  },

  updateDelivery: async (id, items, deliveredAt, notes = '', driver, payment) => {
    await save('commands.delivery.update', () =>
      rpc.updateCommandDelivery(id, {
        delivered_at: deliveredAt,
        notes,
        driver_name: driver?.driverName ?? null,
        driver_plate: driver?.driverPlate ?? null,
        location: driver?.location ?? null,
        ...tvaPayload(payment),
        cash_paid: payment?.cashPaid ?? 0,
        advance_applied: payment?.advanceApplied ?? 0,
        items: items.map(deliveryItemPayload),
      })
    );
    // les quantités déduites ont été recalculées côté serveur
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadStock(), reloadSales(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, get().recoveries), adjustments });
  },

  deleteDelivery: async (id) => {
    await save('commands.delivery.delete', () => rpc.deleteCommandDelivery(id));
    // supprimer une livraison remet les matières en stock (production
    // automatique défaite) et emporte ses récupérations
    const [commands, deliveries, adjustments, recoveries] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      db.deliveryRecoveries.list(), reloadStock(), reloadSales(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, recoveries), adjustments, recoveries });
  },

  /* ==========================================================================
   *  ÉCRAN LIVRAISONS — client → produit → quantité
   *  La base impute chaque quantité sur les commandes en cours du client (la
   *  plus ancienne d'abord) et crée UN bon par commande servie. Chaque bon
   *  prend d'abord dans le stock prêt du produit ; le manquant est produit
   *  automatiquement. Le bon vaut vente : facture, caisse, dette du client.
   * ======================================================================== */
  addClientDelivery: async (input) => {
    const rows = await save<Array<{ id: string; sale_id?: string | null }>>('deliveries.client.create', () =>
      rpc.createClientDelivery(clientDeliveryPayload(input))
    );
    const ids = (rows ?? []).map((r) => r.id);
    // l'acompte LIBRE du client paie les factures créées, dans l'ordre
    let credit = Math.max(0, input.creditUsed ?? 0);
    for (const r of rows ?? []) {
      if (credit <= 0.004 || !r.sale_id) break;
      try {
        const used = await rpc.applyCreditToSale(r.sale_id, credit);
        credit -= Number(used) || 0;
      } catch { /* la facture reste à crédit */ }
    }
    const [commands, deliveries, adjustments] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      reloadStock(), reloadSales(), reloadAccounts(),
    ]);
    const merged = withRecoveries(deliveries, get().recoveries);
    set({ commands, deliveries: merged, adjustments });
    return merged.filter((d) => ids.includes(d.id));
  },

  updateClientDelivery: async (id, input) => {
    await save('deliveries.client.update', () => rpc.updateClientDelivery(id, clientDeliveryPayload(input)));
    const credit = Math.max(0, input.creditUsed ?? 0);
    if (credit > 0.004) {
      const fresh = await db.commandDeliveries.list();
      const saleId = fresh.find((d) => d.id === id)?.saleId;
      if (saleId) {
        try { await rpc.applyCreditToSale(saleId, credit); } catch { /* reste à crédit */ }
      }
    }
    const [commands, deliveries, adjustments, recoveries] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.commandAdjustments.list(),
      db.deliveryRecoveries.list(), reloadStock(), reloadSales(), reloadAccounts(),
    ]);
    const merged = withRecoveries(deliveries, recoveries);
    set({ commands, deliveries: merged, adjustments, recoveries });
    return merged.find((d) => d.id === id);
  },

  /* ==========================================================================
   *  RÉCUPÉRATION — la marchandise revient au stock prêt, la quantité redevient
   *  « à livrer » sur la commande, la facture baisse et l'argent payé au-delà
   *  est rendu au client (ou reste en acompte sur son compte).
   * ======================================================================== */
  addRecovery: async (input) => {
    const row = await save<{ id: string }>('deliveries.recovery.create', () =>
      rpc.createDeliveryRecovery({
        delivery_id: input.deliveryId,
        recovered_at: input.recoveredAt,
        reason: input.reason ?? '',
        refund_mode: input.refundMode,
        refund_amount: input.refundAmount ?? null,
        refund_method: input.refundMethod ?? 'especes',
        items: input.items
          .filter((i) => i.quantity > 0)
          .map((i) => ({ command_item_id: i.commandItemId, quantity: i.quantity })),
      })
    );
    const [commands, deliveries, recoveries] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.deliveryRecoveries.list(),
      reloadStock(), reloadSales(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, recoveries), recoveries });
    return recoveries.find((r) => r.id === row?.id);
  },

  deleteRecovery: async (id) => {
    await save('deliveries.recovery.delete', () => db.deliveryRecoveries.remove(id));
    const [commands, deliveries, recoveries] = await Promise.all([
      db.commands.list(), db.commandDeliveries.list(), db.deliveryRecoveries.list(),
      reloadStock(), reloadSales(), reloadAccounts(),
    ]);
    set({ commands, deliveries: withRecoveries(deliveries, recoveries), recoveries });
  },
}));
