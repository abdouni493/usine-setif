import type { Client, CommandDelivery, DeliveryRecovery, StoreSettings } from '@/types';
import type { Command } from '@/store/commandStore';
import { commandTtc } from './commandBilling';
import { printDeliveryNote, printRecoveryNote } from './documents';
import { recoveredOnLine } from './readyStock';

/* ============================================================================
 *  IMPRESSION D'UN BON DE LIVRAISON / D'UN BON DE RÉCUPÉRATION
 * ----------------------------------------------------------------------------
 *  Partagé par l'écran Livraisons et l'historique du client : le bon imprimé
 *  est le même, d'où qu'on le lance.
 * ========================================================================== */

/** Identifiants fiscaux du client — imprimés dans le bloc « DOIT ». */
const fiscalOf = (client?: Client) => ({
  clientRc: client?.rc, clientNif: client?.nif, clientNis: client?.nis, clientArticle: client?.article,
});

export function printDeliveryFor(
  delivery: CommandDelivery,
  command: Command | undefined,
  client: Client | undefined,
  store: StoreSettings,
  docTitle?: string,
  endText = '',
  recoveries: DeliveryRecovery[] = []
) {
  const items = command?.items ?? [];
  // les lignes du bon ; une marchandise récupérée depuis n'y figure plus : le
  // bon réimprimé reflète ce que le client a réellement gardé et payé
  const lines = delivery.items.map((l) => {
    const it = items.find((x) => (l.commandItemId && x.id === l.commandItemId) || x.productName === l.productName);
    const back = l.commandItemId ? recoveredOnLine(recoveries, delivery.id, l.commandItemId) : 0;
    return {
      productName: l.productName,
      ordered: it?.quantity ?? l.quantity,
      deliveredNow: Math.max(0, l.quantity - back),
      deliveredTotal: it?.deliveredQuantity ?? l.quantity,
      unit: it?.sellByUnit ? it.sellUnit : l.sellUnit,
      unitPrice: it?.unitPrice ?? 0,
    };
  });
  printDeliveryNote(
    {
      docTitle,
      endText,
      reference: delivery.reference,
      blNumber: delivery.blNumber,
      commandReference: command?.reference ?? '',
      bonNumber: command?.bonNumber,
      clientName: command?.clientName ?? client?.name ?? '',
      clientPhone: command?.clientPhone ?? client?.phone,
      clientAddress: command?.clientAddress ?? client?.address,
      ...fiscalOf(client),
      location: delivery.location || command?.clientAddress,
      historical: delivery.isHistorical ?? command?.isHistorical,
      tvaEnabled: delivery.tvaEnabled,
      tvaRate: delivery.tvaRate,
      tvaAmount: delivery.tvaAmount,
      deliveryTotalHt: delivery.totalHt,
      deliveryTotalTtc: delivery.totalTtc,
      deliveryPaid: delivery.paidAmount,
      deliveryRest: delivery.restAmount,
      advanceApplied: delivery.advanceApplied,
      cashPaid: delivery.cashPaid,
      saleReference: delivery.saleReference,
      deliveredAt: delivery.deliveredAt,
      notes: delivery.notes,
      driverName: delivery.driverName || command?.driverName,
      driverPlate: delivery.driverPlate || command?.driverPlate,
      lines,
      totalAmount: command ? commandTtc(command) : 0,
      paidAmount: command?.paidAmount ?? 0,
      restAmount: command?.restAmount ?? 0,
    },
    store
  );
}

export function printRecoveryFor(
  recovery: DeliveryRecovery,
  delivery: CommandDelivery | undefined,
  command: Command | undefined,
  client: Client | undefined,
  refundAmount: number,
  store: StoreSettings,
  docTitle?: string,
  endText = ''
) {
  printRecoveryNote(
    {
      docTitle,
      endText,
      reference: recovery.reference,
      deliveryReference: delivery?.reference ?? '—',
      commandReference: command?.reference,
      recoveredAt: recovery.recoveredAt,
      client: {
        name: recovery.clientName || command?.clientName || client?.name || '',
        phone: client?.phone ?? command?.clientPhone,
        address: client?.address ?? command?.clientAddress,
        rc: client?.rc, nif: client?.nif, nis: client?.nis, article: client?.article,
      },
      reason: recovery.reason,
      lines: recovery.items.map((it) => {
        const delivered = delivery?.items
          .filter((x) => x.commandItemId === it.commandItemId)
          .reduce((s, x) => s + x.quantity, 0);
        return {
          productName: it.productName,
          delivered: delivered ?? it.quantity,
          recovered: it.quantity,
          unit: it.unit,
          unitPrice: it.unitPrice,
        };
      }),
      tvaEnabled: recovery.tvaEnabled,
      tvaRate: recovery.tvaRate,
      tvaAmount: recovery.tvaAmount,
      totalHt: recovery.totalHt,
      totalTtc: recovery.totalTtc,
      excessAmount: recovery.excessAmount,
      refundAmount,
      refundMethod: recovery.refundMethod,
    },
    store
  );
}
