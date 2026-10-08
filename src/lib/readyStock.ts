import type { Production, CommandDelivery, DeliveryRecovery } from '@/types';
import type { Command } from '@/store/commandStore';
import type { FicheTechnic } from '@/store/ficheTechnicStore';

/* ============================================================================
 *  STOCK PRÊT & SUIVI DES COMMANDES PAR PRODUIT
 * ----------------------------------------------------------------------------
 *  Miroir, côté application, des règles de la base de données
 *  (`fiche_ready_quantity()` et `_allocate_client_lines()` dans
 *  supabase/parts/07_livraisons_stock_pret.sql). Rien n'est écrit ici : ces
 *  calculs servent à AFFICHER, la base refait et applique tout elle-même.
 *
 *  STOCK PRÊT d'un produit (fiche technique) =
 *      productions du produit (hors caisse) − envoyé au comptoir
 *    − quantités livrées depuis le stock prêt
 *    + quantités récupérées sur des bons de livraison
 *
 *  Une commande « en cours » est une commande ni annulée ni ancienne : c'est
 *  elle seule que l'écran Livraisons peut servir.
 * ========================================================================== */

const r3 = (n: number) => Math.round((n || 0) * 1000) / 1000;
const norm = (s?: string) => (s ?? '').trim().toLowerCase();

/** Commande servie par l'écran Livraisons (ni annulée, ni ancienne). */
export const isOpenCommand = (c: Command) => c.status !== 'cancelled' && !c.isHistorical;

/** Stock prêt de chaque produit, indexé par l'identifiant de sa fiche technique. */
export function readyByFiche(
  productions: Production[],
  deliveries: CommandDelivery[],
  recoveries: DeliveryRecovery[]
): Map<string, number> {
  const map = new Map<string, number>();
  const add = (id: string | undefined, q: number) => {
    if (!id) return;
    map.set(id, (map.get(id) ?? 0) + q);
  };
  productions.forEach((p) => {
    if (p.origin === 'pos') return;
    add(p.ficheTechnicId, p.outputQuantity - (p.sentToComptoir ?? 0));
  });
  deliveries.forEach((d) =>
    d.items.forEach((it) => { if (it.readyApplied) add(it.ficheTechnicId, -it.quantity); })
  );
  recoveries.forEach((r) =>
    r.items.forEach((it) => { if (it.readyApplied) add(it.ficheTechnicId, it.quantity); })
  );
  map.forEach((v, k) => map.set(k, r3(v)));
  return map;
}

/** Fiche technique d'une ligne de commande : son identifiant, sinon son nom. */
export function ficheOfLine(
  line: { ficheTechnicId?: string; productName: string },
  fiches: FicheTechnic[]
): FicheTechnic | undefined {
  if (line.ficheTechnicId) {
    const byId = fiches.find((f) => f.id === line.ficheTechnicId);
    if (byId) return byId;
  }
  const key = norm(line.productName);
  return fiches.find((f) => norm(f.name) === key);
}

export interface FicheOrderStats {
  fiche: FicheTechnic;
  unit?: string;
  /** Quantité commandée (annulations déduites) sur les commandes en cours. */
  ordered: number;
  /** Quantité déjà livrée (récupérations déduites). */
  delivered: number;
  /** Reste à livrer — baisse à chaque livraison. */
  remaining: number;
  /** Produit fini prêt, pas encore livré. */
  ready: number;
  /** Ce qu'il faudra encore produire pour honorer le reste. */
  toProduce: number;
  /** Commandes et clients qui attendent encore ce produit. */
  openCommands: number;
  openClients: number;
  /** Livré / commandé, en pourcentage. */
  percent: number;
}

/** Totaux commandés / livrés / restants / prêts de CHAQUE produit. */
export function ficheOrderStats(
  fiches: FicheTechnic[],
  commands: Command[],
  ready: Map<string, number>
): FicheOrderStats[] {
  const acc = new Map<string, { ordered: number; delivered: number; cmds: Set<string>; clients: Set<string> }>();
  fiches.forEach((f) => acc.set(f.id, { ordered: 0, delivered: 0, cmds: new Set(), clients: new Set() }));

  commands.filter(isOpenCommand).forEach((c) => {
    c.items.forEach((it) => {
      const f = ficheOfLine(it, fiches);
      if (!f) return;
      const a = acc.get(f.id)!;
      const expected = Math.max(0, it.quantity - (it.cancelledQuantity ?? 0));
      const delivered = Math.min(expected, it.deliveredQuantity ?? 0);
      a.ordered += expected;
      a.delivered += delivered;
      if (expected - delivered > 0.0005) {
        a.cmds.add(c.id);
        if (c.clientId) a.clients.add(c.clientId);
      }
    });
  });

  return fiches.map((fiche) => {
    const a = acc.get(fiche.id)!;
    const ordered = r3(a.ordered);
    const delivered = r3(a.delivered);
    const remaining = r3(Math.max(0, ordered - delivered));
    const rdy = Math.max(0, ready.get(fiche.id) ?? 0);
    return {
      fiche,
      unit: fiche.sellByUnit ? fiche.sellUnit : undefined,
      ordered,
      delivered,
      remaining,
      ready: rdy,
      toProduce: r3(Math.max(0, remaining - rdy)),
      openCommands: a.cmds.size,
      openClients: a.clients.size,
      percent: ordered > 0 ? Math.min(100, (delivered / ordered) * 100) : 0,
    };
  });
}

/* ------------------------------------------------------------------ client */

/** Une ligne de commande d'un client qui attend encore une livraison. */
export interface OpenLine {
  commandId: string;
  commandReference: string;
  commandCreatedAt: string;
  itemId: string;
  position: number;
  ficheId?: string;
  productName: string;
  unit?: string;
  unitPrice: number;
  left: number;
}

/**
 * Lignes en attente d'un client, dans l'ordre de service (la plus ancienne
 * d'abord). `extra` rend disponibles les quantités d'un bon en cours de
 * modification : la base les remet « à livrer » avant de reconstruire le bon.
 */
export function openLinesOfClient(
  clientId: string, commands: Command[], fiches: FicheTechnic[], extra?: Map<string, number>
): OpenLine[] {
  const out: OpenLine[] = [];
  commands
    .filter((c) => c.clientId === clientId && isOpenCommand(c))
    .forEach((c) =>
      c.items.forEach((it, idx) => {
        if (!it.id) return;
        const left = r3(
          it.quantity - (it.cancelledQuantity ?? 0) - (it.deliveredQuantity ?? 0) + (extra?.get(it.id) ?? 0)
        );
        if (left <= 0.0005) return;
        out.push({
          commandId: c.id,
          commandReference: c.reference,
          commandCreatedAt: c.createdAt,
          itemId: it.id,
          position: it.position ?? idx,
          ficheId: ficheOfLine(it, fiches)?.id,
          productName: it.productName,
          unit: it.sellByUnit ? it.sellUnit : undefined,
          unitPrice: it.unitPrice || 0,
          left,
        });
      })
    );
  return out.sort(
    (a, b) =>
      a.commandCreatedAt.localeCompare(b.commandCreatedAt) ||
      a.commandReference.localeCompare(b.commandReference) ||
      a.position - b.position
  );
}

export interface AllocationPart extends OpenLine {
  take: number;
}

export interface AllocationResult {
  parts: AllocationPart[];
  /** Quantité demandée qui dépasse le reste à livrer (0 si tout est servi). */
  missing: number;
}

/**
 * Imputation d'une quantité sur les commandes d'un client — EXACTEMENT comme
 * la base : lignes préférées d'abord (modification d'un bon), puis commande
 * préférée, puis la commande la plus ancienne.
 */
export function allocateQuantity(
  lines: OpenLine[],
  ficheId: string,
  quantity: number,
  prefer: { items?: string[]; commandId?: string } = {}
): AllocationResult {
  const pool = lines
    .filter((l) => l.ficheId === ficheId)
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const pa = prefer.items?.includes(a.l.itemId) ? 0 : 1;
      const pb = prefer.items?.includes(b.l.itemId) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ca = prefer.commandId && a.l.commandId === prefer.commandId ? 0 : 1;
      const cb = prefer.commandId && b.l.commandId === prefer.commandId ? 0 : 1;
      if (ca !== cb) return ca - cb;
      return a.i - b.i;
    })
    .map((x) => x.l);
  let need = r3(quantity);
  const parts: AllocationPart[] = [];
  for (const l of pool) {
    if (need <= 0.0005) break;
    const take = r3(Math.min(need, l.left));
    if (take <= 0) continue;
    parts.push({ ...l, take });
    need = r3(need - take);
  }
  return { parts, missing: Math.max(0, need) };
}

/** Quantité et coût récupérés par bon de livraison (écrans et rapports). */
export function recoveredByDelivery(recoveries: DeliveryRecovery[]) {
  const map = new Map<string, { quantity: number; cost: number; ttc: number; count: number }>();
  recoveries.forEach((r) => {
    const cur = map.get(r.deliveryId) ?? { quantity: 0, cost: 0, ttc: 0, count: 0 };
    r.items.forEach((it) => {
      cur.quantity += it.quantity;
      cur.cost += it.costAmount ?? 0;
    });
    cur.ttc += r.totalTtc;
    cur.count += 1;
    map.set(r.deliveryId, cur);
  });
  return map;
}

/** Quantité déjà récupérée sur UNE ligne (ligne de commande) d'un bon. */
export function recoveredOnLine(recoveries: DeliveryRecovery[], deliveryId: string, commandItemId?: string): number {
  return r3(
    recoveries
      .filter((r) => r.deliveryId === deliveryId)
      .reduce(
        (s, r) => s + r.items.filter((it) => it.commandItemId === commandItemId).reduce((a, it) => a + it.quantity, 0),
        0
      )
  );
}
