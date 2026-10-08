import { create } from 'zustand';
import type { FreeInvoice, FreeInvoiceDocType, FreeInvoiceLine } from '@/types';
import { db, rpc } from '@/lib/db';
import { save } from '@/lib/persist';

/** Saisie d'une facture non comptabilisée (création ou modification). */
export interface FreeInvoiceInput {
  docType: FreeInvoiceDocType;
  clientId?: string;
  clientName: string;
  clientPhone?: string;
  clientAddress?: string;
  clientRc?: string;
  clientNif?: string;
  clientNis?: string;
  clientArticle?: string;
  date: string;
  location?: string;
  driverName?: string;
  driverPlate?: string;
  tvaEnabled: boolean;
  tvaRate: number;
  reduction: number;
  paidAmount: number;
  paymentMode?: string;
  notes?: string;
  lines: FreeInvoiceLine[];
}

const payload = (i: FreeInvoiceInput) => ({
  doc_type: i.docType,
  client_id: i.clientId ?? null,
  client_name: i.clientName,
  client_phone: i.clientPhone ?? '',
  client_address: i.clientAddress ?? '',
  client_rc: i.clientRc ?? '',
  client_nif: i.clientNif ?? '',
  client_nis: i.clientNis ?? '',
  client_article: i.clientArticle ?? '',
  date: i.date,
  location: i.location ?? '',
  driver_name: i.driverName ?? '',
  driver_plate: i.driverPlate ?? '',
  tva_enabled: i.tvaEnabled,
  tva_rate: i.tvaEnabled ? i.tvaRate : 0,
  reduction: Math.max(0, i.reduction || 0),
  paid_amount: Math.max(0, i.paidAmount || 0),
  payment_mode: i.paymentMode ?? '',
  notes: i.notes ?? '',
  lines: i.lines.map((l) => ({
    fiche_technic_id: l.ficheTechnicId ?? null,
    product_name: l.productName,
    description: l.description ?? '',
    quantity: l.quantity,
    unit: l.unit ?? '',
    unit_price: l.unitPrice,
  })),
});

interface FreeInvoiceState {
  invoices: FreeInvoice[];
  load: () => Promise<void>;
  save: (id: string | null, input: FreeInvoiceInput) => Promise<FreeInvoice | undefined>;
  remove: (id: string) => Promise<void>;
}

/**
 * FACTURES NON COMPTABILISÉES — de simples documents à imprimer.
 * La base les garde pour pouvoir les réimprimer ou les corriger, mais elles ne
 * touchent ni au stock, ni à la caisse, ni à la dette du client, ni aux rapports.
 */
export const useFreeInvoiceStore = create<FreeInvoiceState>()((set, get) => ({
  invoices: [],

  load: async () => {
    set({ invoices: await db.freeInvoices.list() });
  },

  save: async (id, input) => {
    const row = await save<{ id: string }>(id ? 'freeInvoices.update' : 'freeInvoices.create', () =>
      rpc.saveFreeInvoice(id, payload(input))
    );
    const invoices = await db.freeInvoices.list();
    set({ invoices });
    return invoices.find((x) => x.id === row?.id);
  },

  remove: async (id) => {
    await save('freeInvoices.delete', () => db.freeInvoices.remove(id));
    set({ invoices: get().invoices.filter((x) => x.id !== id) });
  },
}));
