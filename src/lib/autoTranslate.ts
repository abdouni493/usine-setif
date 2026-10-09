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
 *  Les documents imprimés (fenêtres d'impression) ne sont pas concernés : ils
 *  restent en français, langue des documents officiels.
 * ========================================================================== */

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE', 'svg']);

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const dict = new Map<string, string>();
for (const [fr, ar] of Object.entries(AR_DICTIONARY)) dict.set(norm(fr), ar);

/** Phrases connues, les plus longues d'abord, pour traduire un texte composé. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrases = [...dict.keys()]
  .filter((k) => (k.length >= 3 || k === 'DA') && /[A-Za-zÀ-ÿ]{2}/.test(k))
  .sort((a, b) => b.length - a.length);
const phraseRe = new RegExp(
  `(?<![A-Za-zÀ-ÿ0-9])(?:${phrases.map(escape).join('|')})(?![A-Za-zÀ-ÿ0-9])`,
  'g',
);

const cache = new Map<string, string>();

/** Traduit une chaîne française ; renvoie la chaîne telle quelle si rien n'est connu. */
export function toArabic(text: string): string {
  if (!text || !/[A-Za-zÀ-ÿ]/.test(text)) return text;
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const lead = text.match(/^\s*/)![0];
  const trail = text.slice(lead.length).match(/\s*$/)![0];
  const core = norm(text);
  let out = dict.get(core);
  if (out === undefined) {
    out = core.replace(phraseRe, (m) => dict.get(m) ?? m);
  }
  const res = out === core ? text : lead + out + trail;
  if (cache.size > 20000) cache.clear();
  cache.set(text, res);
  return res;
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
