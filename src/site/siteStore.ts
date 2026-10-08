import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { siteSupabase } from './siteClient';
import { siteDict, type SiteLang, type SiteKey } from './i18n';

export interface SiteProduct {
  id: string; name: string; description: string; price: number; image?: string | null; category: string; unit: string;
}
export interface SiteText { id: string; title: string; content: string; location: 'landing' | 'order' | 'contacts' | 'offers' }
export interface SiteSettings {
  site_name: string; site_description: string; about_text: string; background_url?: string | null;
  favicon_url?: string | null; is_public: boolean; company_name: string; logo?: string | null;
  facebook?: string | null; instagram?: string | null; tiktok?: string | null; whatsapp?: string | null;
  phone?: string | null; phone2?: string | null; email?: string | null; address?: string | null;
}
export interface SiteClient { id: string; name: string; phone: string; address: string; email: string }
export interface CartLine { id: string; quantity: number }

interface SiteState {
  loaded: boolean;
  error: string;
  /** false = site privé et visiteur non connecté. */
  open: boolean;
  settings: SiteSettings | null;
  texts: SiteText[];
  products: SiteProduct[];
  client: SiteClient | null;
  cart: CartLine[];
  lang: SiteLang;
  load: () => Promise<void>;
  setLang: (l: SiteLang) => void;
  addToCart: (id: string, qty?: number) => void;
  setQty: (id: string, qty: number) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  signIn: (email: string, password: string) => Promise<'ok' | 'bad' | 'not-client'>;
  signOut: () => Promise<void>;
}

export const useSite = create<SiteState>()(persist((set, get) => ({
  loaded: false, error: '', open: true, settings: null, texts: [], products: [], client: null,
  cart: [], lang: 'fr',

  load: async () => {
    const { data, error } = await siteSupabase.rpc('website_public');
    if (error) { set({ loaded: true, error: error.message }); return; }
    const d = data as { settings: SiteSettings; open: boolean; texts: SiteText[]; products: SiteProduct[]; client: SiteClient | null };
    const products = (d.products ?? []).map((p) => ({ ...p, price: Number(p.price) || 0 }));
    set({ loaded: true, error: '', settings: d.settings, open: d.open, texts: d.texts ?? [], products, client: d.client });
    // le panier ne garde que les produits encore proposés
    if (d.open) {
      const ids = new Set(products.map((p) => p.id));
      set({ cart: get().cart.filter((l) => ids.has(l.id)) });
    }
  },
  setLang: (lang) => set({ lang }),
  addToCart: (id, qty = 1) => {
    const cart = get().cart;
    const line = cart.find((l) => l.id === id);
    set({ cart: line ? cart.map((l) => (l.id === id ? { ...l, quantity: l.quantity + qty } : l)) : [...cart, { id, quantity: qty }] });
  },
  setQty: (id, qty) => set({ cart: get().cart.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, qty) } : l)) }),
  removeFromCart: (id) => set({ cart: get().cart.filter((l) => l.id !== id) }),
  clearCart: () => set({ cart: [] }),
  signIn: async (email, password) => {
    const { data, error } = await siteSupabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error || !data.user) return 'bad';
    await get().load();
    if (!get().client) {
      await siteSupabase.auth.signOut();
      await get().load();
      return 'not-client';
    }
    return 'ok';
  },
  signOut: async () => {
    await siteSupabase.auth.signOut();
    set({ client: null });
    await get().load();
  },
}), { name: 'papeterie-site', partialize: (s) => ({ cart: s.cart, lang: s.lang }) }));

export function useT() {
  const lang = useSite((s) => s.lang);
  return (k: SiteKey) => siteDict[lang][k];
}

export const money = (v: number) =>
  `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} DA`;
