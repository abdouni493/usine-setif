import type { Client } from '@/types';

/* ============================================================================
 *  N° DES CLIENTS (01, 02, 03 …)
 * ----------------------------------------------------------------------------
 *  Chaque client porte un numéro séquentiel (`clients.client_no`, voir
 *  supabase/11_client_numbers.sql). Il s'affiche sur l'écran des clients, sert
 *  à la recherche partout où l'on cherche un client, et s'imprime sur les
 *  documents. Tant que la colonne n'existe pas en base, les clients sont
 *  numérotés ici dans leur ordre de création.
 * ========================================================================== */

/** N° affiché : au moins deux chiffres (1 → « 01 », 125 → « 125 »). */
export function formatClientCode(code?: number | null): string {
  return code == null ? '' : String(code).padStart(2, '0');
}

/** Donne un N° aux clients qui n'en ont pas, à la suite des N° existants. */
export function withClientCodes(clients: Client[]): Client[] {
  if (clients.every((c) => c.code != null)) return clients;
  let next = clients.reduce((m, c) => Math.max(m, c.code ?? 0), 0);
  const missing = clients
    .filter((c) => c.code == null)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
  const assigned = new Map(missing.map((c) => [c.id, ++next]));
  return clients.map((c) => (c.code != null ? c : { ...c, code: assigned.get(c.id) }));
}

/** Tri par N° croissant (01 en premier). */
export function byClientCode(a: Client, b: Client): number {
  return (a.code ?? Infinity) - (b.code ?? Infinity) || a.name.localeCompare(b.name);
}

/**
 * Le client correspond-il à la recherche ? Nom, téléphone, adresse ou N°
 * (« 7 », « 07 », « #07 » trouvent le client N° 07).
 */
export function clientMatches(
  c: Pick<Client, 'name' | 'phone' | 'code'> & { address?: string },
  query: string,
): boolean {
  const raw = query.trim();
  if (!raw) return true;
  const q = raw.toLowerCase();
  if (c.name.toLowerCase().includes(q)) return true;
  if ((c.address || '').toLowerCase().includes(q)) return true;
  const digits = raw.replace(/\s/g, '');
  if (digits && (c.phone || '').replace(/\s/g, '').includes(digits)) return true;
  return clientCodeMatches(c.code, raw);
}

/** La recherche désigne-t-elle ce N° de client (« 7 », « 07 », « #07 », « N° 07 ») ? */
export function clientCodeMatches(code: number | null | undefined, query: string): boolean {
  if (code == null) return false;
  const idQuery = query.trim().replace(/^(#|n°|no|id)\s*/i, '');
  if (!/^\d+$/.test(idQuery)) return false;
  return Number(idQuery) === code || formatClientCode(code).startsWith(idQuery);
}

/** « N° 07 — Nom » : nom d'un client précédé de son N°. */
export function clientLabel(c: Pick<Client, 'name' | 'code'>): string {
  const code = formatClientCode(c.code);
  return code ? `N° ${code} — ${c.name}` : c.name;
}
