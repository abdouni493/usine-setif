import { useAuthStore } from '@/store/authStore';
import { AR_DICTIONARY } from '@/lib/arDictionary';

/* ============================================================================
 *  TRADUCTION AUTOMATIQUE DE L'INTERFACE EN ARABE
 * ----------------------------------------------------------------------------
 *  La plupart des textes de l'application sont écrits en français directement
 *  dans les écrans. Quand la langue choisie est l'arabe, ce module traduit tout
 *  ce qui est affiché — textes, boutons, titres, placeholders, infobulles,
 *  notifications et boîtes de confirmation — grâce au dictionnaire
 *  `arDictionary.ts`. Le texte français d'origine est mémorisé : repasser en
 *  français le restaure instantanément.
 *
 *  Les documents imprimés (aperçu d'impression) sont eux aussi traduits et
 *  mis en page de droite à gauche (voir `translateDocumentHtml`).
 * ========================================================================== */

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'svg']);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Forme « souple » d'un texte : majuscules, sans accents, apostrophes unifiées.
 * Elle garde la MÊME longueur que le texte (un caractère pour un caractère) :
 * une phrase trouvée dans la forme souple se remplace au même endroit du texte
 * d'origine. Ainsi « BON DE COMMANDE », « Reste a payer » ou « Total general »
 * (textes des documents imprimés) retrouvent « Bon de commande », « Reste à
 * payer » et « Total général » du dictionnaire.
 */
function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    let c = ch === '’' || ch === '‘' || ch === '`' ? "'" : ch;
    const base = c.normalize('NFD')[0];
    if (base && base.length === c.length) c = base;
    const up = c.toUpperCase();
    out += up.length === c.length ? up : c;
  }
  return out;
}

const dict = new Map<string, string>();
const loose = new Map<string, string>();
for (const [fr, ar] of Object.entries(AR_DICTIONARY)) {
  const k = norm(fr);
  dict.set(k, ar);
  const f = fold(k);
  if (!loose.has(f)) loose.set(f, ar);
}

/** Phrases connues, les plus longues d'abord, pour traduire un texte composé. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrases = [...loose.keys()]
  .filter((k) => ((k.length >= 3 && /[A-Z]{2}/.test(k)) || k === 'DA' || k === 'N°'))
  .sort((a, b) => b.length - a.length);
const phraseRe = new RegExp(
  `(?<![A-Za-zÀ-ÿ0-9])(?:${phrases.map(escape).join('|')})(?![A-Za-zÀ-ÿ0-9])`,
  'g',
);

/**
 * Petits mots français restés seuls entre deux expressions traduites
 * (« Aucune livraison SUR LA période ») : traduits ou retirés pour qu'aucun
 * mot français ne reste au milieu d'une phrase arabe.
 */
const GLUE: Record<string, string> = {
  DE: '', DU: '', DES: '', LA: '', LE: '', LES: '', "L'": '', "D'": '', UN: '', UNE: '',
  AU: 'إلى', AUX: 'إلى', SUR: 'على', DANS: 'في', EN: 'في',
  ET: 'و', OU: 'أو', NI: 'ولا', POUR: 'لـ', PAR: 'بواسطة', AVEC: 'مع', SANS: 'بدون',
  CE: 'هذا', CET: 'هذا', CETTE: 'هذه', CES: 'هذه', SON: '', SA: '', SES: '',
  EST: '', SONT: '', PAS: 'لا', NE: '', "N'": '', 'QUI': 'الذي', 'QUE': '',
};
const glueRe = /(^|[\s(«])((?:[A-Za-zÀ-ÿ]+'?)|(?:[LDNldn]'))(?=[\s)»,.:;!?]|$)/g;
const ARABIC = /[؀-ۿ]/;

const cache = new Map<string, string>();

/** Traduit une chaîne française ; renvoie la chaîne telle quelle si rien n'est connu. */
export function toArabic(text: string): string {
  if (!text || !/[A-Za-zÀ-ÿ]/.test(text)) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const lead = text.match(/^\s*/)![0];
  const trail = text.slice(lead.length).match(/\s*$/)![0];
  const core = norm(text);
  const folded = fold(core);
  let out = dict.get(core) ?? loose.get(folded);
  if (out === undefined) {
    // remplace chaque phrase connue à sa place dans le texte d'origine
    let res = '';
    let last = 0;
    phraseRe.lastIndex = 0;
    for (let m = phraseRe.exec(folded); m; m = phraseRe.exec(folded)) {
      res += core.slice(last, m.index) + (loose.get(m[0]) ?? core.substr(m.index, m[0].length));
      last = m.index + m[0].length;
    }
    out = res + core.slice(last);
    // les petits mots restés en français au milieu d'une phrase traduite
    if (out !== core && ARABIC.test(out)) {
      out = out
        .replace(glueRe, (all, pre: string, w: string) => {
          const g = GLUE[fold(w)];
          return g === undefined ? all : pre + g;
        })
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
  }
  const res = out === core ? text : lead + out + trail;
  if (cache.size > 20000) cache.clear();
  cache.set(text, res);
  return res;
}

/** La langue de l'interface est-elle l'arabe ? */
export function isArabicUi(): boolean {
  return useAuthStore.getState().language === 'ar';
}

/** Feuille de style ajoutée aux documents imprimés en arabe (mise en page miroir). */
const PRINT_RTL_CSS = `
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; }
  td.l, th.l { text-align: right; }
  td.r, th.r, td.tot-label, td.tot-value { text-align: left; }
  .city, .party .meta, .head .right, .head .info .it, .foot .col.right { text-align: left; }
  .sec-title { border-left: 0; padding-left: 0; border-right: 4px solid currentColor; padding-right: 8px; }
  .words, .obs { border-left-width: 1.2px; border-right-width: 4px; }
  * { letter-spacing: 0 !important; }
`;

/**
 * Traduit un document HTML complet (aperçu d'impression) en arabe : textes,
 * titres, infobulles, puis sens de lecture de droite à gauche. Les scripts et
 * styles du document ne sont pas touchés.
 */
export function translateDocumentHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const alreadyRtl = doc.documentElement.getAttribute('dir') === 'rtl';
  const tw = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const p = n.parentElement;
      if (p && (SKIP_TAGS.has(p.tagName) || p.closest('[data-no-translate],.notranslate'))) continue;
      const t = n as Text;
      const next = toArabic(t.data);
      if (next !== t.data) t.data = next;
    } else {
      const el = n as Element;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (v) el.setAttribute(a, toArabic(v));
      }
    }
  }
  doc.title = toArabic(doc.title);
  doc.documentElement.setAttribute('lang', 'ar');
  doc.documentElement.setAttribute('dir', 'rtl');
  if (!alreadyRtl) {
    const style = doc.createElement('style');
    style.textContent = PRINT_RTL_CSS;
    doc.head.appendChild(style);
  }
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

/* ---- état des nœuds -------------------------------------------------------- */
const origText = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const origAttrs = new WeakMap<Element, Record<string, string>>();
const appliedAttrs = new WeakMap<Element, Record<string, string>>();

let active = false;

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName)) return true;
    if (e.hasAttribute('data-no-translate') || e.classList.contains('notranslate')) return true;
    if ((e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function handleText(node: Text) {
  const current = node.data;
  // React a réécrit le texte : c'est le nouveau texte d'origine
  if (appliedText.get(node) !== current) origText.set(node, current);
  const original = origText.get(node) ?? current;
  const next = active && !skipped(node.parentElement) ? toArabic(original) : original;
  appliedText.set(node, next);
  if (next !== current) node.data = next;
}

function handleAttrs(el: Element) {
  let orig = origAttrs.get(el);
  let applied = appliedAttrs.get(el);
  for (const a of ATTRS) {
    const current = el.getAttribute(a);
    if (current == null) continue;
    if (!orig) { orig = {}; origAttrs.set(el, orig); }
    if (!applied) { applied = {}; appliedAttrs.set(el, applied); }
    if (applied[a] !== current) orig[a] = current;
    const original = orig[a] ?? current;
    const next = active && !skipped(el) ? toArabic(original) : original;
    applied[a] = next;
    if (next !== current) el.setAttribute(a, next);
  }
  // valeur affichée des boutons <input type="button|submit">
  if (el instanceof HTMLInputElement && (el.type === 'button' || el.type === 'submit') && el.value) {
    const o = (orig ??= {});
    origAttrs.set(el, o);
    const ap = (applied ??= {});
    appliedAttrs.set(el, ap);
    if (ap.value !== el.value) o.value = el.value;
    const next = active ? toArabic(o.value) : o.value;
    ap.value = next;
    if (el.value !== next) el.value = next;
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { handleText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    if (SKIP_TAGS.has((root as Element).tagName)) return;
    handleAttrs(root as Element);
  }
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) handleText(n as Text);
    else handleAttrs(n as Element);
  }
}

/* ---- boîtes natives -------------------------------------------------------- */
function patchDialogs() {
  const w = window as Window & { __arDialogs?: boolean };
  if (w.__arDialogs) return;
  w.__arDialogs = true;
  const { alert, confirm, prompt } = window;
  const tr = (m?: unknown) => (active && typeof m === 'string' ? toArabic(m) : m);
  window.alert = (m?: unknown) => alert.call(window, tr(m));
  window.confirm = (m?: string) => confirm.call(window, tr(m) as string);
  window.prompt = (m?: string, d?: string) => prompt.call(window, tr(m) as string, d);
}

let installed = false;
let origTitle = '';

export function installAutoTranslate() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  patchDialogs();

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') handleText(m.target as Text);
      else if (m.type === 'attributes') handleAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });

  const apply = (lang: string) => {
    active = lang === 'ar';
    walk(document.body);
    if (!origTitle) origTitle = document.title;
    document.title = active ? toArabic(origTitle) : origTitle;
  };

  const start = () => {
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: [...ATTRS, 'value'],
    });
    apply(useAuthStore.getState().language);
    useAuthStore.subscribe((s, prev) => {
      if (s.language !== prev.language) apply(s.language);
    });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}
