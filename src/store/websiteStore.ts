/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useFicheTechnicStore } from './ficheTechnicStore';
import { useClientStore } from './clientStore';
import { useCommandStore } from './commandStore';

/* ============================================================================
 *  SITE WEB — côté application de gestion
 * ----------------------------------------------------------------------------
 *  Réglages du site, textes variables, présentation des produits (offres) et
 *  commandes reçues depuis le site. Tout est écrit dans Supabase
 *  (supabase/parts/08_site_web.sql) ; le site public lit `website_public()`.
 * ========================================================================== */

export type WebsiteTextLocation = 'landing' | 'order' | 'contacts' | 'offers';

export interface WebsiteSettings {
  siteName: string;
  siteDescription: string;
  aboutText: string;
  backgroundUrl: string;
  faviconUrl: string;
  isPublic: boolean;
  facebook: string;
  instagram: string;
  tiktok: string;
  whatsapp: string;
  phone: string;
  phone2: string;
  email: string;
  address: string;
}

export interface WebsiteText {
  id: string;
  title: string;
  content: string;
  location: WebsiteTextLocation;
  position: number;
}

export interface WebsiteOrderItem {
  id?: string;
  ficheTechnicId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  sellUnit?: string;
}

export type WebsiteOrderStatus = 'pending' | 'accepted' | 'cancelled';

export interface WebsiteOrder {
  id: string;
  reference: string;
  clientId?: string;
  detectedClientId?: string;
  isAccount: boolean;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  clientNote: string;
  rc: string; nif: string; nis: string; article: string;
  notes: string;
  totalAmount: number;
  status: WebsiteOrderStatus;
  commandId?: string;
  cancelReason?: string;
  acceptedAt?: string;
  cancelledAt?: string;
  handledBy?: string;
  createdAt: string;
  items: WebsiteOrderItem[];
}

export interface WebsiteOrderEdit {
  clientId?: string | null;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  clientNote: string;
  rc: string; nif: string; nis: string; article: string;
  notes: string;
  items: WebsiteOrderItem[];
}

export const TEXT_LOCATIONS: { value: WebsiteTextLocation; label: string }[] = [
  { value: 'landing', label: "Page d'accueil" },
  { value: 'offers', label: 'Page des offres' },
  { value: 'order', label: 'Page de commande' },
  { value: 'contacts', label: 'Page contacts / à propos' },
];

export const ORDER_STATUS_LABEL: Record<WebsiteOrderStatus, string> = {
  pending: 'En attente', accepted: 'Acceptée', cancelled: 'Annulée',
};

const defaultSettings: WebsiteSettings = {
  siteName: '', siteDescription: '', aboutText: '', backgroundUrl: '', faviconUrl: '',
  isPublic: true, facebook: '', instagram: '', tiktok: '', whatsapp: '',
  phone: '', phone2: '', email: '', address: '',
};

const num = (v: any) => Number(v ?? 0) || 0;
const s = (v: any) => (v ?? '') as string;

const toSettings = (r: any): WebsiteSettings => ({
  siteName: s(r.site_name), siteDescription: s(r.site_description), aboutText: s(r.about_text),
  backgroundUrl: s(r.background_url), faviconUrl: s(r.favicon_url), isPublic: r.is_public ?? true,
  facebook: s(r.facebook), instagram: s(r.instagram), tiktok: s(r.tiktok), whatsapp: s(r.whatsapp),
  phone: s(r.phone), phone2: s(r.phone2), email: s(r.email), address: s(r.address),
});

const toOrder = (r: any): WebsiteOrder => ({
  id: r.id, reference: r.reference,
  clientId: r.client_id ?? undefined, detectedClientId: r.detected_client_id ?? undefined,
  isAccount: !!r.auth_user_id,
  clientName: s(r.client_name), clientPhone: s(r.client_phone), clientAddress: s(r.client_address),
  clientNote: s(r.client_note), rc: s(r.rc), nif: s(r.nif), nis: s(r.nis), article: s(r.article),
  notes: s(r.notes), totalAmount: num(r.total_amount), status: r.status,
  commandId: r.command_id ?? undefined, cancelReason: r.cancel_reason ?? undefined,
  acceptedAt: r.accepted_at ?? undefined, cancelledAt: r.cancelled_at ?? undefined,
  handledBy: r.handled_by ?? undefined, createdAt: r.created_at,
  items: ((r.website_order_items ?? []) as any[])
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((i) => ({
      id: i.id, ficheTechnicId: i.fiche_technic_id ?? undefined, productName: i.product_name,
      quantity: num(i.quantity), unitPrice: num(i.unit_price), totalPrice: num(i.total_price),
      sellUnit: i.sell_unit ?? undefined,
    })),
});

async function rpc<T = any>(fn: string, args: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const missing = (m: string) => /does not exist|schema cache|PGRST20[05]|42P01|42703/i.test(m);

interface WebsiteState {
  settings: WebsiteSettings;
  texts: WebsiteText[];
  orders: WebsiteOrder[];
  /** false tant que 08_site_web.sql n'a pas été exécuté. */
  ready: boolean;
  load: () => Promise<void>;
  loadOrders: () => Promise<void>;
  saveSettings: (data: Partial<WebsiteSettings>) => Promise<void>;
  addText: (t: Omit<WebsiteText, 'id' | 'position'>) => Promise<void>;
  updateText: (id: string, t: Partial<WebsiteText>) => Promise<void>;
  deleteText: (id: string) => Promise<void>;
  updateProduct: (
    ficheId: string,
    data: { webName?: string; webDescription?: string; webPrice?: number | null; webImageUrl?: string; webHidden?: boolean },
  ) => Promise<void>;
  updateOrder: (id: string, data: WebsiteOrderEdit) => Promise<void>;
  acceptOrder: (id: string, clientId?: string | null) => Promise<{ clientCreated: boolean }>;
  cancelOrder: (id: string, reason?: string) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  setClientAccount: (clientId: string, email: string, password?: string) => Promise<void>;
  removeClientAccount: (clientId: string) => Promise<void>;
}

export const useWebsiteStore = create<WebsiteState>()((set, get) => ({
  settings: defaultSettings,
  texts: [],
  orders: [],
  ready: true,

  load: async () => {
    const [st, tx] = await Promise.all([
      supabase.from('website_settings').select('*').maybeSingle(),
      supabase.from('website_texts').select('*').order('position').order('created_at'),
    ]);
    if (st.error) {
      if (missing(st.error.message)) { set({ ready: false }); return; }
      throw new Error(st.error.message);
    }
    set({
      ready: true,
      settings: st.data ? toSettings(st.data) : defaultSettings,
      texts: (tx.data ?? []).map((r: any) => ({
        id: r.id, title: s(r.title), content: s(r.content), location: r.location, position: num(r.position),
      })),
    });
    await get().loadOrders();
  },

  loadOrders: async () => {
    const { data, error } = await supabase
      .from('website_orders').select('*, website_order_items(*)').order('created_at', { ascending: false });
    if (error) {
      if (missing(error.message)) { set({ ready: false, orders: [] }); return; }
      throw new Error(error.message);
    }
    set({ orders: (data ?? []).map(toOrder) });
  },

  saveSettings: async (data) => {
    const next = { ...get().settings, ...data };
    const row = {
      id: true,
      site_name: next.siteName, site_description: next.siteDescription, about_text: next.aboutText,
      background_url: next.backgroundUrl || null, favicon_url: next.faviconUrl || null, is_public: next.isPublic,
      facebook: next.facebook, instagram: next.instagram, tiktok: next.tiktok, whatsapp: next.whatsapp,
      phone: next.phone, phone2: next.phone2, email: next.email, address: next.address,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('website_settings').upsert(row);
    if (error) throw new Error(error.message);
    set({ settings: next });
  },

  addText: async (t) => {
    const position = get().texts.length;
    const { data, error } = await supabase.from('website_texts')
      .insert({ title: t.title, content: t.content, location: t.location, position }).select().single();
    if (error) throw new Error(error.message);
    set({ texts: [...get().texts, { id: data.id, title: t.title, content: t.content, location: t.location, position }] });
  },

  updateText: async (id, t) => {
    const row: Record<string, any> = {};
    if (t.title !== undefined) row.title = t.title;
    if (t.content !== undefined) row.content = t.content;
    if (t.location !== undefined) row.location = t.location;
    const { error } = await supabase.from('website_texts').update(row).eq('id', id);
    if (error) throw new Error(error.message);
    set({ texts: get().texts.map((x) => (x.id === id ? { ...x, ...t } : x)) });
  },

  deleteText: async (id) => {
    const { error } = await supabase.from('website_texts').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set({ texts: get().texts.filter((x) => x.id !== id) });
  },

  updateProduct: async (ficheId, d) => {
    const payload: Record<string, any> = {};
    if (d.webName !== undefined) payload.web_name = d.webName;
    if (d.webDescription !== undefined) payload.web_description = d.webDescription;
    if (d.webPrice !== undefined) payload.web_price = d.webPrice === null ? '' : String(d.webPrice);
    if (d.webImageUrl !== undefined) payload.web_image_url = d.webImageUrl;
    if (d.webHidden !== undefined) payload.web_hidden = d.webHidden;
    await rpc('website_update_product', { p_id: ficheId, p_payload: payload });
    const fs = useFicheTechnicStore.getState();
    useFicheTechnicStore.setState({
      ficheTechnics: fs.ficheTechnics.map((f) => (f.id === ficheId
        ? {
            ...f,
            ...(d.webName !== undefined ? { webName: d.webName } : {}),
            ...(d.webDescription !== undefined ? { webDescription: d.webDescription } : {}),
            ...(d.webPrice !== undefined ? { webPrice: d.webPrice ?? undefined } : {}),
            ...(d.webImageUrl !== undefined ? { webImageUrl: d.webImageUrl } : {}),
            ...(d.webHidden !== undefined ? { webHidden: d.webHidden } : {}),
          }
        : f)),
    });
  },

  updateOrder: async (id, d) => {
    await rpc('website_update_order', {
      p_id: id,
      p_payload: {
        client_id: d.clientId ?? '',
        client_name: d.clientName, client_phone: d.clientPhone, client_address: d.clientAddress,
        client_note: d.clientNote, rc: d.rc, nif: d.nif, nis: d.nis, article: d.article, notes: d.notes,
        items: d.items.map((i) => ({
          fiche_technic_id: i.ficheTechnicId ?? '', product_name: i.productName,
          quantity: i.quantity, unit_price: i.unitPrice, sell_unit: i.sellUnit ?? null,
        })),
      },
    });
    await get().loadOrders();
  },

  acceptOrder: async (id, clientId) => {
    const res = await rpc<any>('website_accept_order', { p_id: id, p_client_id: clientId ?? null });
    // la commande rejoint l'écran Commandes et les totaux du tableau de bord
    await Promise.all([
      get().loadOrders(),
      useCommandStore.getState().load(),
      useClientStore.getState().load(),
    ]);
    return { clientCreated: !!res?.client_created };
  },

  cancelOrder: async (id, reason) => {
    await rpc('website_cancel_order', { p_id: id, p_reason: reason || null });
    await get().loadOrders();
  },

  deleteOrder: async (id) => {
    const { error } = await supabase.from('website_orders').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set({ orders: get().orders.filter((o) => o.id !== id) });
  },

  setClientAccount: async (clientId, email, password) => {
    await rpc('admin_set_client_account', { p_client_id: clientId, p_email: email, p_password: password || null });
    const cs = useClientStore.getState();
    useClientStore.setState({
      clients: cs.clients.map((c) => (c.id === clientId ? { ...c, loginEmail: email.trim().toLowerCase() } : c)),
    });
  },

  removeClientAccount: async (clientId) => {
    await rpc('admin_remove_client_account', { p_client_id: clientId });
    const cs = useClientStore.getState();
    useClientStore.setState({
      clients: cs.clients.map((c) => (c.id === clientId ? { ...c, loginEmail: '' } : c)),
    });
  },
}));
