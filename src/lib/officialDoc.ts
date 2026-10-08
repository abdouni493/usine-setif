import type { StoreSettings } from '@/types';
import { formatCurrency, formatDate } from './utils';
import { openPrintPreview } from './printWindow';

/* ============================================================================
 *  MODÈLE OFFICIEL DES DOCUMENTS IMPRIMÉS
 * ----------------------------------------------------------------------------
 *  Reprise fidèle du modèle papier de l'entreprise, habillée aux couleurs de
 *  l'application (or / ambre sur encre ardoise) et portant son logo.
 *
 *      ┌──────────────────────────────────────────────────────────┐
 *      │ ADRESSE : …                                     ┌──────┐ │
 *      │ TEL : …            SARL ACTCE LOKMANE           │ LOGO │ │
 *      │ R.C : … NIF : …   FABRICATION DE PAPIER         └──────┘ │
 *      │ NIS : … ART : …      PRET A L'EMPLOI                     │
 *      └──────────────────────────────────────────────────────────┘
 *                                                BLIDA LE 05/04/2026
 *                        BON DE LIVRAISON            (souligné)
 *
 *      DOIT : HARAZI OULED AICHE                    N° BL : BL-0012
 *      ┌─────────────┬──────────────┬──────────┬──────────┬────────┐
 *      │ DESIGNATION │ ADRESSE DE   │ QUANTITE │  PRIX U  │ P.T HT │
 *      │             │  LIVRAISON   │          │          │        │
 *      ├─────────────┼──────────────┼──────────┼──────────┼────────┤
 *      │ PAPIER KRAFT│ OULED AICHE  │   74,5   │ 8 700,00 │ 648150 │
 *      └─────────────┴──────────────┴──────────┼──────────┼────────┤
 *                                              │ TOTAL HT │   …    │
 *                                              │VERSEMENT │   …    │
 *                                              │ LE REST  │   …    │
 *                                              └──────────┴────────┘
 *      CLIENT                                            SIGNATURE
 *
 *  TOUS les documents de l'application (bon de livraison, bon de commande,
 *  facture de vente, facture d'achat, reçu de versement, fiche de production…)
 *  sont rendus par ce même moteur : seuls le titre, les colonnes et le bloc de
 *  totaux changent.
 *
 *  Le bloc de totaux est « accroché » aux DEUX dernières colonnes du tableau,
 *  exactement comme sur le modèle : la partie gauche du tableau s'arrête et les
 *  totaux se poursuivent seuls, à droite.
 * ========================================================================== */

export type Align = 'left' | 'center' | 'right';

export interface DocColumn {
  label: string;
  align?: Align;
  /** Largeur CSS optionnelle (ex : '9%'). */
  width?: string;
}

export interface DocRow {
  cells: (string | number)[];
  /** Ligne de sous-total / regroupement — fond ambré et texte gras. */
  variant?: 'normal' | 'group' | 'subtotal';
  /** La première cellule occupe toutes les colonnes sauf la dernière. */
  span?: boolean;
}

export interface DocTotal {
  label: string;
  value: string;
  /** Ligne mise en évidence (TOTAL T.T.C, LE REST…). */
  strong?: boolean;
}

export interface DocTable {
  /** Titre de section, imprimé au-dessus du tableau (facultatif). */
  title?: string;
  columns: DocColumn[];
  rows: DocRow[];
  /** Bloc de totaux accroché au pied du tableau, sur ses 2 dernières colonnes. */
  totals?: DocTotal[];
  /**
   * Nombre de colonnes occupées par le LIBELLÉ d'un total (défaut : 1, ou 2
   * au-delà de six colonnes). Les comptes rendus l'élargissent pour que
   * « ANCIENNE DETTE DU 01/01/2026 — … » tienne sur une ligne.
   */
  totalsLabelSpan?: number;
  emptyLabel?: string;
  note?: string;
}

export interface DocData {
  /** Titre souligné : BON DE LIVRAISON, BON DE COMMANDE… */
  title: string;
  /** Date portée par la mention « <VILLE> LE jj/mm/aaaa ». */
  docDate: string;
  /** Libellé du destinataire : DOIT, FOURNISSEUR, EMPLOYÉ… */
  doitLabel?: string;
  doitName?: string;
  /** Identifiants du destinataire (adresse, R.C, NIF, NIS, article, tél). */
  doitLines?: string[];
  /** Références du document (N° BL, commande liée, chauffeur…) — à DROITE du DOIT. */
  metaLines?: string[];
  /** Mentions encadrées (LIVRAISON PARTIELLE, ANCIENNE COMMANDE…). */
  stamps?: { label: string; tone?: 'ok' | 'warn' }[];
  tables: DocTable[];
  /** Montant en toutes lettres — encadré sous les tableaux. */
  amountInWords?: string;
  /** Lignes libres en bas à gauche : « VERSEMENT DE … DA LE … ». */
  footNotes?: string[];
  /** Observations encadrées. */
  observations?: string;
  /** Texte libre saisi a l'impression, imprime tout en bas du document. */
  endText?: string;
  /**
   * Cartouches de signature. Deux entrées ⇒ la 1re à GAUCHE (« LE CLIENT ») et
   * la 2de à DROITE (« SIGNATURE »), comme sur le modèle papier.
   */
  signatures?: string[];
  /** Nom du fichier / onglet d'impression. */
  fileName: string;
  /** En-tête réduit au logo + raison sociale (bon de livraison). */
  minimalHeader?: boolean;
}

/* ------------------------------------------------------------------ helpers */

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)
  );
}

/** « VERSEMENT DE 600 000,00 DA LE 09/06/2026 » — ligne de pied de document. */
export function versementLine(amount: number, date: string): string {
  return `VERSEMENT DE ${formatCurrency(amount)} LE ${formatDate(date)}`;
}

/* ---------------------------------------------------------------- feuille */

/**
 * Palette reprise de l'application (thème clair) : or / ambre sur ardoise.
 * Elle est partagée avec `reportPrint.ts` et `barcodeUtils.ts` pour que TOUS
 * les documents imprimés portent la même identité visuelle.
 */
export const BRAND = {
  // Papeterie identity: ink black + signal red on white paper
  ink: '#0a0a0a',
  inkSoft: '#3f3f46',
  gold: '#dc2626',      // accent (red)
  goldDark: '#991b1b',  // dark accent (deep red)
  goldLight: '#ef4444',
  wash: '#fafafa',      // light panel
  tint: '#fee2e2',      // table header tint (pale red)
  strong: '#fecaca',    // grand-total highlight
  grid: '#0a0a0a',
};

/** Base commune (corps, barre d'outils) partagée par tous les documents. */
export const BRAND_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: 'Segoe UI', Inter, system-ui, 'Helvetica Neue', Arial, sans-serif;
    color: ${BRAND.ink}; background: #e4e4e7; padding: 18px;
    font-size: 14px; font-weight: 600; line-height: 1.42;
  }
  .toolbar { max-width: 880px; margin: 0 auto 14px; display: flex; justify-content: flex-end; gap: 9px; }
  .toolbar button {
    font: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
    border: 1.5px solid ${BRAND.goldDark}; border-radius: 8px; padding: 9px 24px;
    background: linear-gradient(135deg, ${BRAND.goldLight} 0%, ${BRAND.gold} 55%, ${BRAND.goldDark} 100%);
    color: #fff; letter-spacing: .3px;
  }
  .toolbar button.ghost { background: #fff; color: ${BRAND.goldDark}; }
`;

/** En-tête officiel — identique sur les documents et sur les comptes rendus.
 *  Logo à GAUCHE, raison sociale + activité puis coordonnées alignées à DROITE. */
export const HEAD_CSS = `
  .head {
    border: 1.6px solid ${BRAND.grid}; border-top: 6px solid ${BRAND.gold};
    background: ${BRAND.wash}; padding: 12px 16px;
  }
  .head .row { display: flex; align-items: center; gap: 18px; }
  .head .logo-box { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-start; }
  .head .logo { width: 138px; height: 138px; object-fit: contain; display: block; }
  .head .right { flex: 1 1 auto; min-width: 0; text-align: right; }
  .head .brand {
    font-size: 26px; font-weight: 900; letter-spacing: .6px; line-height: 1.15;
    text-transform: uppercase; color: ${BRAND.ink};
  }
  .head .activity {
    font-size: 14px; font-weight: 800; letter-spacing: .3px; margin-top: 3px;
    line-height: 1.25; text-transform: uppercase; color: ${BRAND.goldDark};
  }
  .head .rule { margin: 7px 0 7px auto; width: 100%; border-top: 2.5px solid ${BRAND.gold}; }
  .head .info {
    display: grid; grid-template-columns: auto auto; justify-content: end;
    column-gap: 20px; row-gap: 2px;
    font-size: 11.5px; font-weight: 800; line-height: 1.45;
    color: ${BRAND.ink}; text-transform: uppercase;
  }
  .head .info .it { text-align: right; overflow-wrap: anywhere; }
  .head .info .it b { color: ${BRAND.goldDark}; font-weight: 900; }
  .head .info .full { grid-column: 1 / -1; }
  .head.mini .brand { font-size: 28px; }
  .city { text-align: right; font-size: 14px; font-weight: 700; font-style: italic; text-transform: uppercase; margin: 8px 2px 0; }
  .doc-title {
    text-align: center; font-size: 22px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 2px; margin: 12px 0 14px; color: ${BRAND.goldDark};
  }
  .doc-title span { border-bottom: 3px solid ${BRAND.gold}; padding: 0 14px 5px; }
`;

const CSS = `
  ${BRAND_CSS}
  ${HEAD_CSS}

  .sheet {
    max-width: 880px; margin: 0 auto; background: #fff;
    border: 2px solid ${BRAND.goldDark}; border-radius: 4px;
    padding: 14px 16px 18px;
  }

  /* ---- Bandeau DOIT (à gauche) / références du document (à droite) ---- */
  .party { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; margin: 0 2px 9px; }
  .party .doit { font-size: 16px; font-weight: 800; text-transform: uppercase; }
  .party .doit .lbl { color: ${BRAND.goldDark}; border-bottom: 2px solid ${BRAND.gold}; padding-bottom: 1px; }
  .party .doit .sub { display: block; font-size: 12.5px; font-weight: 700; color: ${BRAND.inkSoft}; margin-top: 4px; line-height: 1.6; }
  .party .meta { text-align: right; font-size: 13.5px; font-weight: 700; text-transform: uppercase; line-height: 1.65; white-space: nowrap; }

  /* ---- Tableaux ---- */
  .sec-title { font-size: 15px; font-weight: 800; text-transform: uppercase; color: ${BRAND.goldDark}; border-left: 4px solid ${BRAND.gold}; padding-left: 8px; margin: 16px 0 6px 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1.2px solid ${BRAND.grid}; padding: 7px 8px; font-size: 13.5px; font-weight: 600; vertical-align: middle; }
  th {
    text-transform: uppercase; text-align: center; letter-spacing: .4px;
    background: ${BRAND.ink}; color: #fff; font-size: 12.5px; font-weight: 800;
    border-bottom: 3px solid ${BRAND.gold};
  }
  td.l, th.l { text-align: left; }
  td.c, th.c { text-align: center; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tbody td { font-weight: 700; }
  tr.group td { text-transform: uppercase; background: ${BRAND.tint}; font-weight: 800; }
  tr.subtotal td { background: ${BRAND.wash}; }
  tr { break-inside: avoid; }
  .empty { text-align: center; font-style: italic; font-weight: 700; padding: 12px; font-size: 13.5px; color: ${BRAND.inkSoft}; }

  /* ---- Totaux accrochés aux DEUX dernières colonnes ---- */
  td.tot-void { border: none; background: transparent; }
  td.tot-label { text-align: right; font-weight: 800; text-transform: uppercase; letter-spacing: .4px; background: ${BRAND.wash}; font-size: 13px; }
  td.tot-value { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; font-size: 13.5px; white-space: nowrap; }
  tr.grand td.tot-label, tr.grand td.tot-value { background: ${BRAND.gold}; color: #fff; font-size: 15px; }

  /* ---- Montant en lettres · observations ---- */
  .words, .obs { border: 1.2px solid ${BRAND.grid}; border-left: 4px solid ${BRAND.gold}; background: ${BRAND.wash}; padding: 9px 11px; font-size: 13.5px; font-weight: 700; margin: 11px 0; }
  .words b, .obs b { display: block; text-transform: uppercase; font-size: 11.5px; font-weight: 800; letter-spacing: .6px; color: ${BRAND.goldDark}; margin-bottom: 2px; }
  .words i { font-style: italic; font-weight: 700; }

  .stamps { margin: 11px 0 2px; }
  .stamp { display: inline-block; border: 1.5px solid ${BRAND.goldDark}; border-radius: 4px; padding: 3px 13px; font-size: 12.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .5px; margin: 0 8px 6px 0; color: ${BRAND.goldDark}; }
  .stamp.warn { background: ${BRAND.tint}; }

  /* ---- Pied : « LE CLIENT » à gauche, « SIGNATURE » à droite ---- */
  .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 22px; margin-top: 24px; break-inside: avoid; }
  .foot .col { min-width: 165px; }
  .foot .col.right { text-align: right; }
  .endtext { margin-top: 18px; padding-top: 8px; border-top: 1px dashed #999; font-size: 13px; white-space: pre-wrap; }
  .foot .notes { font-size: 13px; font-weight: 700; text-transform: uppercase; line-height: 1.8; margin-bottom: 14px; }
  .foot .sign { display: inline-block; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: ${BRAND.goldDark}; border-top: 2px solid ${BRAND.gold}; padding-top: 5px; margin-top: 34px; min-width: 150px; text-align: center; }

  .tag { margin-top: 16px; padding-top: 8px; border-top: 1.5px solid ${BRAND.gold}; text-align: center; font-size: 12px; font-style: italic; font-weight: 700; color: ${BRAND.inkSoft}; }

  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none !important; }
    .sheet { border: none; max-width: none; padding: 0; }
    @page { size: A4 portrait; margin: 9mm; }
  }
`;

/** Coordonnées et identifiants fiscaux de l'en-tête : [libellé, valeur, pleine largeur ?]. */
export function headerInfoItems(store: StoreSettings): [string, string, boolean][] {
  const items: [string, string, boolean][] = [
    ['LIEU D\'ACTIVITE', store.activityPlace, true],
    ['SIEGE SOCIAL', store.address, true],
    ['TEL', store.phone, false],
    ['EMAIL', store.email, false],
    ['R.C', store.rc, false],
    ['NIF', store.nif, false],
    ['NIS', store.nis, false],
    ['ART', store.article, false],
  ];
  return items.filter(([, v]) => v && v.trim());
}

/** Version texte (une ligne par information). */
export function headerInfoLines(store: StoreSettings): string[] {
  return headerInfoItems(store).map(([l, v]) => `${l} : ${v}`);
}

/** Ville de la mention « <VILLE> LE … » — réglage, sinon fin de l'adresse. */
export function headerCity(store: StoreSettings): string {
  if (store.city && store.city.trim()) return store.city.trim().toUpperCase();
  const parts = (store.address || '').split(/[,\-–]/).map((p) => p.trim()).filter(Boolean);
  return (parts[parts.length - 1] || '').toUpperCase();
}

/**
 * Bloc d'en-tête : logo à GAUCHE, raison sociale, activité et coordonnées à
 * DROITE. `minimal` (bon de livraison) n'imprime que le logo et le nom.
 */
export function headerHtml(store: StoreSettings, minimal = false): string {
  const info = minimal
    ? ''
    : `<div class="rule"></div><div class="info">${headerInfoItems(store)
        .map(([l, v, full]) => `<div class="it${full ? ' full' : ''}"><b>${esc(l)} :</b> ${esc(v)}</div>`)
        .join('')}</div>`;
  return `
    <div class="head${minimal ? ' mini' : ''}">
      <div class="row">
        <div class="logo-box">
          ${store.logo ? `<img class="logo" src="${store.logo}" alt=""/>` : ''}
        </div>
        <div class="right">
          <div class="brand">${esc(store.name || 'PAPETERIE PRODUCTION')}</div>
          ${!minimal && store.description ? `<div class="activity">${esc(store.description)}</div>` : ''}
          ${info}
        </div>
      </div>
    </div>`;
}

/** La colonne « ADRESSE (DE LIVRAISON) » n'est plus imprimée sur aucun document. */
function dropAddressColumn(t: DocTable): DocTable {
  const idx = t.columns.findIndex((c) => /^adresse/i.test(c.label.trim()));
  if (idx < 0) return t;
  return {
    ...t,
    columns: t.columns.filter((_, i) => i !== idx),
    rows: t.rows.map((r) => (r.span ? r : { ...r, cells: r.cells.filter((_, i) => i !== idx) })),
  };
}

function alignClass(a?: Align): string {
  return a === 'right' ? 'r' : a === 'center' ? 'c' : 'l';
}

function tableHtml(t: DocTable): string {
  const cols = t.columns;
  const head = `<tr>${cols
    .map((c) => `<th class="${alignClass(c.align)}"${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`)
    .join('')}</tr>`;

  const body = t.rows.length
    ? t.rows
        .map((r) => {
          const cls = r.variant && r.variant !== 'normal' ? ` class="${r.variant}"` : '';
          if (r.span) {
            const last = r.cells[r.cells.length - 1];
            return `<tr${cls}><td class="l" colspan="${cols.length - 1}">${r.cells[0]}</td><td class="${alignClass(
              cols[cols.length - 1].align
            )}">${last}</td></tr>`;
          }
          return `<tr${cls}>${r.cells
            .map((cell, i) => `<td class="${alignClass(cols[i]?.align)}">${cell}</td>`)
            .join('')}</tr>`;
        })
        .join('')
    : `<tr><td class="empty" colspan="${cols.length}">${esc(t.emptyLabel || 'Aucune ligne')}</td></tr>`;

  /* Les totaux ne tiennent que sur les DEUX dernières colonnes : la partie
     gauche du tableau s'arrête, comme sur le modèle papier. Au-delà de six
     colonnes, le libellé prend deux colonnes pour ne pas se couper en deux. */
  const labelSpan = Math.max(1, Math.min(cols.length - 1, t.totalsLabelSpan ?? (cols.length >= 6 ? 2 : 1)));
  const voidSpan = Math.max(0, cols.length - 1 - labelSpan);
  const voidCell = voidSpan > 0 ? `<td class="tot-void" colspan="${voidSpan}"></td>` : '';
  const totals = (t.totals ?? [])
    .map(
      (x) => `<tr class="tot${x.strong ? ' grand' : ''}">
        ${voidCell}
        <td class="tot-label" colspan="${labelSpan}">${esc(x.label)}</td>
        <td class="tot-value">${x.value}</td>
      </tr>`
    )
    .join('');

  /* Les totaux sont rendus comme DERNIÈRES lignes du corps du tableau, et non
     dans un <tfoot> : un <tfoot> est répété par le navigateur au bas de CHAQUE
     page quand le tableau déborde sur plusieurs feuilles, ce qui affichait le
     bloc de totaux sur toutes les pages. En corps de tableau, il n'apparaît
     qu'une seule fois, à la fin réelle du tableau (sur la dernière page). */
  return `
    ${t.title ? `<div class="sec-title">${esc(t.title)}</div>` : ''}
    <table>
      <thead>${head}</thead>
      <tbody>${body}${totals}</tbody>
    </table>
    ${t.note ? `<div class="obs">${esc(t.note)}</div>` : ''}`;
}

/**
 * Rend et ouvre un document officiel dans une fenêtre d'impression.
 * Tous les modèles de l'application passent par ici : l'entreprise a un seul
 * papier à en-tête, quel que soit le document.
 */
export function printOfficialDocument(input: DocData, store: StoreSettings) {
  const data: DocData = { ...input, tables: input.tables.map(dropAddressColumn) };
  const signs = data.signatures?.length ? data.signatures : ['Signature'];
  // Modèle papier : le premier cartouche à GAUCHE, le dernier à DROITE.
  const leftSign = signs.length > 1 ? signs[0] : '';
  const rightSign = signs[signs.length - 1];
  const city = headerCity(store);

  openPrintPreview(`<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8"/><title>${esc(data.fileName)}</title><style>${CSS}</style></head>
  <body>
    <div class="toolbar">
      <button onclick="window.print()">Imprimer</button>
      <button class="ghost" onclick="window.close()">Fermer</button>
    </div>
    <div class="sheet">
      ${headerHtml(store, data.minimalHeader)}
      <div class="city">${city ? `${esc(city)} LE ` : 'LE '}${esc(formatDate(data.docDate))}</div>
      <div class="doc-title"><span>${esc(data.title)}</span></div>
      <div class="party">
        <div class="doit">${
          data.doitName
            ? `<span class="lbl">${esc(data.doitLabel || 'DOIT')} :</span> ${esc(data.doitName)}
               ${data.doitLines?.length ? `<span class="sub">${data.doitLines.map(esc).join('<br/>')}</span>` : ''}`
            : ''
        }</div>
        <div class="meta">${(data.metaLines ?? []).map(esc).join('<br/>')}</div>
      </div>
      ${data.tables.map(tableHtml).join('')}
      ${
        data.amountInWords
          ? `<div class="words"><b>Arrêtée la présente à la somme de :</b><i>${esc(data.amountInWords)}</i></div>`
          : ''
      }
      ${data.observations ? `<div class="obs"><b>Observations</b>${esc(data.observations)}</div>` : ''}
      ${
        data.stamps?.length
          ? `<div class="stamps">${data.stamps
              .map((s) => `<span class="stamp${s.tone === 'warn' ? ' warn' : ''}">${esc(s.label)}</span>`)
              .join('')}</div>`
          : ''
      }
      <div class="foot">
        <div class="col">
          <div class="notes">${(data.footNotes ?? []).map(esc).join('<br/>')}</div>
          ${leftSign ? `<div class="sign">${esc(leftSign)}</div>` : ''}
        </div>
        <div class="col right"><div class="sign">${esc(rightSign)}</div></div>
      </div>
      ${data.endText?.trim() ? `<div class="endtext">${esc(data.endText.trim())}</div>` : ''}
      ${!data.minimalHeader && store.socialMedia ? `<div class="tag">${esc(store.socialMedia)}</div>` : ''}
    </div>
    <script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>
  </body>
</html>`, data.fileName);
}
