import { db } from '@/lib/db';
import { useWebsiteStore } from '@/store/websiteStore';
import { useSettingsStore } from '@/store/settingsStore';
import { todayISO } from '@/lib/utils';

/* ============================================================================
 *  SAUVEGARDE EXCEL
 * ----------------------------------------------------------------------------
 *  Chaque partie de l'application devient une ou plusieurs feuilles d'un
 *  classeur .xlsx. Les données sont relues dans la base au moment de la
 *  sauvegarde. Les listes imbriquées (lignes d'un achat, articles d'une
 *  commande, versements…) partent dans leur propre feuille, chaque ligne
 *  rappelant la référence du document parent.
 * ========================================================================== */

export interface BackupPart {
  id: string;
  label: string;
  group: string;
  load: () => Promise<unknown[]>;
}

const optional = (fn: () => Promise<unknown[]>) => async () => {
  try { return await fn(); } catch { return []; }
};

export const BACKUP_PARTS: BackupPart[] = [
  // Stock
  { id: 'products', group: 'Stock', label: 'Produits', load: () => db.products.list() },
  { id: 'categories', group: 'Stock', label: 'Catégories', load: () => db.categories.list() },
  { id: 'marques', group: 'Stock', label: 'Marques', load: () => db.marques.list() },
  { id: 'units', group: 'Stock', label: 'Unités', load: () => db.units.list() },
  { id: 'comptoir', group: 'Stock', label: 'Comptoir', load: () => db.comptoir.list() },
  // Achats
  { id: 'suppliers', group: 'Achats', label: 'Fournisseurs', load: () => db.suppliers.list() },
  { id: 'purchases', group: 'Achats', label: 'Achats', load: () => db.purchases.list() },
  { id: 'purchaseReturns', group: 'Achats', label: "Retours d'achat", load: optional(() => db.purchaseReturns.list()) },
  { id: 'purchaseOrders', group: 'Achats', label: 'Bons de commande fournisseurs', load: optional(() => db.purchaseOrders.list()) },
  { id: 'supplierPayments', group: 'Achats', label: 'Règlements fournisseurs', load: optional(() => db.supplierPayments.list()) },
  { id: 'supplierOldDebts', group: 'Achats', label: 'Anciennes dettes fournisseurs', load: optional(() => db.partyOldDebts.list('supplier')) },
  { id: 'supplierRefunds', group: 'Achats', label: 'Excédents fournisseurs', load: optional(() => db.partyRefunds.list('supplier')) },
  // Production
  { id: 'productions', group: 'Production', label: 'Productions', load: () => db.productions.list() },
  { id: 'productionCategories', group: 'Production', label: 'Catégories de production', load: optional(() => db.productionCategories.list()) },
  { id: 'ficheTechnics', group: 'Production', label: 'Fiches techniques', load: () => db.ficheTechnics.list() },
  { id: 'ficheCategories', group: 'Production', label: 'Catégories des fiches', load: optional(() => db.ficheCategories.list()) },
  // Ventes & clients
  { id: 'clients', group: 'Ventes', label: 'Clients', load: () => db.clients.list() },
  { id: 'sales', group: 'Ventes', label: 'Ventes (factures)', load: () => db.sales.list() },
  { id: 'commands', group: 'Ventes', label: 'Commandes', load: () => db.commands.list() },
  { id: 'commandDeliveries', group: 'Ventes', label: 'Bons de livraison', load: optional(() => db.commandDeliveries.list()) },
  { id: 'deliveryRecoveries', group: 'Ventes', label: 'Récupérations', load: optional(() => db.deliveryRecoveries.list()) },
  { id: 'commandAdjustments', group: 'Ventes', label: 'Ajustements de commandes', load: optional(() => db.commandAdjustments.list()) },
  { id: 'freeInvoices', group: 'Ventes', label: 'Factures non comptabilisées', load: optional(() => db.freeInvoices.list()) },
  { id: 'clientPayments', group: 'Ventes', label: 'Versements clients', load: optional(() => db.clientPayments.list()) },
  { id: 'clientDebts', group: 'Ventes', label: 'Dettes clients', load: optional(() => db.clientDebts.list()) },
  { id: 'clientOldDebts', group: 'Ventes', label: 'Anciennes dettes clients', load: optional(() => db.partyOldDebts.list('client')) },
  { id: 'clientRefunds', group: 'Ventes', label: 'Excédents rendus aux clients', load: optional(() => db.partyRefunds.list('client')) },
  {
    id: 'websiteOrders', group: 'Ventes', label: 'Commandes du site web',
    load: optional(async () => { await useWebsiteStore.getState().loadOrders(); return useWebsiteStore.getState().orders; }),
  },
  // Personnel
  { id: 'workers', group: 'Personnel', label: 'Employés', load: () => db.workers.list() },
  { id: 'overtimes', group: 'Personnel', label: 'Heures supplémentaires', load: optional(() => db.overtimes.list()) },
  // Finances
  { id: 'expenses', group: 'Finances', label: 'Dépenses', load: () => db.expenses.list() },
  { id: 'expenseCategories', group: 'Finances', label: 'Catégories de dépenses', load: optional(() => db.expenseCategories.list()) },
  { id: 'caisse', group: 'Finances', label: 'Caisse (mouvements)', load: () => db.caisse.list() },
  { id: 'caisseCategories', group: 'Finances', label: 'Catégories de caisse', load: optional(() => db.caisseCategories.list()) },
  { id: 'caisseReports', group: 'Finances', label: 'Rapports de caisse', load: optional(() => db.caisseReports.list()) },
  // Paramètres
  {
    id: 'settings', group: 'Paramètres', label: "Informations de l'entreprise",
    load: async () => [useSettingsStore.getState().settings],
  },
];

type Row = Record<string, string | number | boolean | null>;

const scalar = (v: unknown): string | number | boolean | null => {
  if (v == null) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
};

const isObjList = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));

/** Aplatit une liste d'enregistrements : feuille principale + feuilles des sous-listes. */
function flatten(name: string, records: unknown[], out: Map<string, Row[]>) {
  const main: Row[] = out.get(name) ?? [];
  out.set(name, main);
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') { main.push({ valeur: scalar(rec) }); continue; }
    const r = rec as Record<string, unknown>;
    const ref = scalar(r.reference ?? r.name ?? r.fullName ?? r.id);
    const row: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (isObjList(v)) {
        flatten(`${name} - ${k}`, v.map((x) => ({ parent: ref, ...x })), out);
      } else if (Array.isArray(v)) {
        row[k] = v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : null;
      } else if (v && typeof v === 'object' && !(v instanceof Date)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) row[`${k}.${k2}`] = scalar(v2);
      } else {
        row[k] = scalar(v);
      }
    }
    main.push(row);
  }
}

/** Nom de feuille Excel valide (31 caractères, sans : \ / ? * [ ]) et unique. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31).trim() || 'Feuille';
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 27)} (${i})`;
  used.add(n.toLowerCase());
  return n;
}

/**
 * Construit et télécharge le classeur Excel des parties choisies.
 * Renvoie le nombre de feuilles et de lignes écrites.
 */
export async function downloadExcelBackup(
  partIds: string[],
  onProgress?: (label: string) => void,
): Promise<{ sheets: number; rows: number; failed: string[] }> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Usine Setif';
  wb.created = new Date();

  const parts = BACKUP_PARTS.filter((p) => partIds.includes(p.id));
  const used = new Set<string>();
  const failed: string[] = [];
  const summary: { partie: string; groupe: string; feuilles: number; lignes: number }[] = [];
  const summarySheet = wb.addWorksheet(sheetName('Sommaire', used));
  let sheets = 0;
  let rows = 0;

  for (const part of parts) {
    onProgress?.(part.label);
    let records: unknown[] = [];
    try { records = await part.load(); } catch { failed.push(part.label); continue; }
    const out = new Map<string, Row[]>();
    flatten(part.label, records, out);
    let partRows = 0;
    for (const [name, data] of out) {
      const ws = wb.addWorksheet(sheetName(name, used));
      const cols = [...new Set(data.flatMap((r) => Object.keys(r)))];
      ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.min(45, Math.max(12, c.length + 2)) }));
      data.forEach((r) => ws.addRow(r));
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8A6A1F' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      if (cols.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
      sheets++;
      partRows += data.length;
    }
    rows += partRows;
    summary.push({ partie: part.label, groupe: part.group, feuilles: out.size, lignes: partRows });
  }

  summarySheet.columns = [
    { header: 'Partie', key: 'partie', width: 36 },
    { header: 'Groupe', key: 'groupe', width: 16 },
    { header: 'Feuilles', key: 'feuilles', width: 10 },
    { header: 'Lignes', key: 'lignes', width: 10 },
  ];
  summary.forEach((s) => summarySheet.addRow(s));
  summarySheet.addRow({});
  summarySheet.addRow({ partie: `Sauvegarde du ${new Date().toLocaleString('fr-FR')}` });
  summarySheet.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sauvegarde-${todayISO()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { sheets, rows, failed };
}

/* ---- choix mémorisé des parties (toutes par défaut) ---- */
const PREF_KEY = 'altech-excel-backup-parts';
const AUTO_KEY = 'altech-excel-backup-auto';
const LAST_KEY = 'altech-excel-backup-last';

export function loadBackupSelection(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (Array.isArray(v)) return v.filter((id) => BACKUP_PARTS.some((p) => p.id === id));
  } catch { /* défaut */ }
  return BACKUP_PARTS.map((p) => p.id);
}
export function saveBackupSelection(ids: string[]) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(ids)); } catch { /* ignoré */ }
}
export function isAutoBackupOn(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch { return true; }
}
export function setAutoBackup(on: boolean) {
  try { localStorage.setItem(AUTO_KEY, on ? 'on' : 'off'); } catch { /* ignoré */ }
}
export function lastAutoBackup(): string {
  try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; }
}

/**
 * Sauvegarde automatique : une fois par jour, au premier lancement de la
 * journée, le classeur des parties choisies est téléchargé.
 */
export async function runDailyAutoBackup(): Promise<void> {
  if (!isAutoBackupOn()) return;
  const today = todayISO();
  if (lastAutoBackup() === today) return;
  try { localStorage.setItem(LAST_KEY, today); } catch { return; }
  try { await downloadExcelBackup(loadBackupSelection()); } catch { /* réessai demain */ }
}
