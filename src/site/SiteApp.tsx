import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, Link, NavLink, useNavigate, useSearchParams, useLocation, Outlet } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ShoppingBag, Menu, X, Plus, Minus, Trash2, Search, Phone, Mail, MapPin, Facebook, Instagram,
  MessageCircle, Music2, ArrowRight, Check, LogOut, LogIn, Package, Globe2, Lock,
} from 'lucide-react';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/800.css';
import './site.css';
import { useSite, useT, type SiteProduct, type SiteText } from './siteStore';
import { siteSupabase } from './siteClient';
import type { SiteLang } from './i18n';

const SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const;

/* ============================================================================
 *  SITE PUBLIC — /site/*
 *  Accueil · Offres · À propos / Contacts · Commande (panier) · Connexion
 * ========================================================================== */
export default function SiteApp() {
  const { loaded, load, settings, lang, error } = useSite();

  useEffect(() => { void load(); }, [load]);
  // la session du site (connexion / déconnexion / rafraîchissement) recharge les données
  useEffect(() => {
    const { data } = siteSupabase.auth.onAuthStateChange((e) => {
      if (e === 'SIGNED_OUT' || e === 'TOKEN_REFRESHED') void load();
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  // titre de l'onglet + favicon choisis dans « Réglages du site »
  useEffect(() => {
    if (!settings) return;
    const prevTitle = document.title;
    document.title = settings.site_name || settings.company_name || 'Site';
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    const prevIcon = link?.href;
    if (settings.favicon_url || settings.logo) {
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = (settings.favicon_url || settings.logo) as string;
    }
    return () => { document.title = prevTitle; if (link && prevIcon) link.href = prevIcon; };
  }, [settings]);

  return (
    <div className="site site-grain" dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang}>
      {!loaded ? (
        <div className="min-h-dvh flex items-center justify-center">
          <span className="h-10 w-10 rounded-full border-4 border-red-200 border-t-red-600 animate-spin" />
        </div>
      ) : error && !settings ? (
        <div className="min-h-dvh flex items-center justify-center p-6 text-center">
          <p className="max-w-md text-[var(--ink-soft)]">Le site n'est pas encore disponible. ({error})</p>
        </div>
      ) : (
        <Routes>
          <Route path="connexion" element={<LoginPage />} />
          <Route element={<Shell />}>
            <Route index element={<Gate><Landing /></Gate>} />
            <Route path="offres" element={<Gate><Offers /></Gate>} />
            <Route path="contact" element={<Gate><Contacts /></Gate>} />
            <Route path="commande" element={<Gate><OrderPage /></Gate>} />
          </Route>
          <Route path="*" element={<Navigate to="/site" replace />} />
        </Routes>
      )}
    </div>
  );
}

/** Site privé sans connexion → page de connexion. */
function Gate({ children }: { children: ReactNode }) {
  const open = useSite((s) => s.open);
  const loc = useLocation();
  if (!open) return <Navigate to={`/site/connexion?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/* ------------------------------------------------------------------ SHELL */
function Brand({ light }: { light?: boolean }) {
  const s = useSite((x) => x.settings);
  return (
    <Link to="/site" className="flex items-center gap-2.5 min-w-0" aria-label={s?.company_name}>
      {s?.logo
        ? <img src={s.logo} alt="" className="h-10 w-10 rounded-lg object-contain bg-white border border-black/10 p-0.5" />
        : <span className="h-10 w-10 rounded-lg bg-[var(--red)] text-white flex items-center justify-center"><Package size={20} /></span>}
      <span className={`font-serif-display text-lg font-extrabold truncate ${light ? 'text-white' : 'text-[var(--ink)]'}`}>
        {s?.company_name || s?.site_name}
      </span>
    </Link>
  );
}

function LangSwitch() {
  const { lang, setLang } = useSite();
  const langs: { id: SiteLang; label: string }[] = [{ id: 'fr', label: 'FR' }, { id: 'ar', label: 'ع' }, { id: 'en', label: 'EN' }];
  return (
    <div className="flex items-center rounded-full border border-black/10 bg-white p-0.5" role="group" aria-label="Langue">
      {langs.map((l) => (
        <button key={l.id} onClick={() => setLang(l.id)} aria-pressed={lang === l.id}
          className={`relative h-9 min-w-9 px-2 rounded-full text-xs font-bold transition-colors ${lang === l.id ? 'text-white' : 'text-[var(--ink-soft)] hover:text-[var(--red)]'}`}>
          {lang === l.id && <motion.span layoutId="lang-pill" transition={SPRING} className="absolute inset-0 rounded-full bg-[var(--ink)]" />}
          <span className="relative">{l.label}</span>
        </button>
      ))}
    </div>
  );
}

function CartButton() {
  const t = useT();
  const count = useSite((s) => s.cart.length);
  return (
    <Link to="/site/commande" aria-label={t('cart')}
      className="relative h-11 w-11 inline-flex items-center justify-center rounded-full bg-[var(--ink)] text-white hover:bg-black transition-colors">
      <ShoppingBag size={19} />
      <AnimatePresence>
        {count > 0 && (
          <motion.span key={count} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={SPRING}
            className="absolute -top-1 -end-1 min-w-5 h-5 px-1 rounded-full bg-[var(--red)] text-[11px] font-bold flex items-center justify-center ring-2 ring-[var(--paper)]">
            {count}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}

function Shell() {
  const t = useT();
  const { client, signOut } = useSite();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMenu(false); window.scrollTo({ top: 0 }); }, [loc.pathname]);
  const isLanding = loc.pathname === '/site' || loc.pathname === '/site/';
  const links = [
    { to: '/site', label: t('home'), end: true },
    { to: '/site/offres', label: t('products') },
    { to: '/site/contact', label: t('about') },
  ];
  return (
    <div className="relative z-[1] flex min-h-dvh flex-col">
      <header className={`sticky top-0 z-40 ${isLanding ? 'bg-[var(--paper)]/80' : 'bg-[var(--paper)]/90'} backdrop-blur-md border-b border-black/[0.07]`}>
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-3">
          <Brand />
          <nav className="hidden md:flex items-center gap-1" aria-label="Navigation">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}
                className={({ isActive }) => `relative px-4 py-2 text-sm font-semibold rounded-full transition-colors ${isActive ? 'text-[var(--red)]' : 'text-[var(--ink-soft)] hover:text-[var(--ink)]'}`}>
                {({ isActive }) => (<>
                  {l.label}
                  {isActive && <motion.span layoutId="nav-underline" transition={SPRING} className="absolute inset-x-4 -bottom-0.5 h-0.5 rounded bg-[var(--red)]" />}
                </>)}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block"><LangSwitch /></div>
            {client
              ? <button onClick={() => void signOut()} title={t('logout')} aria-label={t('logout')}
                  className="hidden sm:inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white hover:text-[var(--red)]"><LogOut size={18} /></button>
              : <Link to="/site/connexion" title={t('login')} aria-label={t('login')}
                  className="hidden sm:inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white hover:text-[var(--red)]"><LogIn size={18} /></Link>}
            <CartButton />
            <button onClick={() => setMenu(!menu)} aria-label="Menu" aria-expanded={menu}
              className="md:hidden h-11 w-11 inline-flex items-center justify-center rounded-full border border-black/10 bg-white">
              {menu ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {menu && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}
              className="md:hidden border-t border-black/[0.07] bg-[var(--paper)] px-4 py-3 space-y-1">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end}
                  className={({ isActive }) => `block rounded-lg px-3 py-3 font-semibold ${isActive ? 'bg-[var(--red-soft)] text-[var(--red-dark)]' : 'text-[var(--ink)]'}`}>
                  {l.label}
                </NavLink>
              ))}
              <div className="flex items-center justify-between pt-2">
                <LangSwitch />
                {client && <button onClick={() => void signOut()} className="site-btn site-btn-ghost !min-h-10 text-sm"><LogOut size={16} /> {t('logout')}</button>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      {client && (
        <div className="bg-[var(--ink)] text-white text-xs text-center py-1.5 px-4">{t('welcome')}, <strong>{client.name}</strong></div>
      )}
      <main className="flex-1"><PageFade><Outlet /></PageFade></main>
      <Footer />
    </div>
  );
}

function PageFade({ children }: { children: ReactNode }) {
  // fondu d'entree en CSS (site.css) : rejoue a chaque page, ne bloque jamais l'affichage
  const loc = useLocation();
  return <div key={loc.pathname} className="site-page-in">{children}</div>;
}

function socials(s: ReturnType<typeof useSite.getState>['settings']) {
  if (!s) return [];
  const wa = (s.whatsapp || '').replace(/[^\d]/g, '');
  const href = (v?: string | null, base = '') => (v ? (/^https?:\/\//.test(v) ? v : base + v.replace(/^@/, '')) : '');
  return [
    s.facebook && { key: 'facebook', label: 'Facebook', href: href(s.facebook, 'https://facebook.com/'), icon: <Facebook size={18} /> },
    s.instagram && { key: 'instagram', label: 'Instagram', href: href(s.instagram, 'https://instagram.com/'), icon: <Instagram size={18} /> },
    s.tiktok && { key: 'tiktok', label: 'TikTok', href: href(s.tiktok, 'https://tiktok.com/@'), icon: <Music2 size={18} /> },
    wa && { key: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${wa}`, icon: <MessageCircle size={18} /> },
  ].filter(Boolean) as { key: string; label: string; href: string; icon: JSX.Element }[];
}

function Footer() {
  const t = useT();
  const s = useSite((x) => x.settings);
  const list = socials(s);
  return (
    <footer className="mt-16 bg-[var(--ink)] text-white">
      <div className="mx-auto max-w-7xl px-4 py-10 grid gap-8 md:grid-cols-3">
        <div className="space-y-3">
          <Brand light />
          <p className="text-sm text-white/70 max-w-xs">{s?.site_description}</p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-bold uppercase tracking-wider text-xs text-white/60">{t('contactUs')}</p>
          {s?.phone && <a href={`tel:${s.phone}`} className="flex items-center gap-2 hover:text-red-400"><Phone size={15} /> <span dir="ltr">{s.phone}</span></a>}
          {s?.phone2 && <a href={`tel:${s.phone2}`} className="flex items-center gap-2 hover:text-red-400"><Phone size={15} /> <span dir="ltr">{s.phone2}</span></a>}
          {s?.email && <a href={`mailto:${s.email}`} className="flex items-center gap-2 hover:text-red-400"><Mail size={15} /> {s.email}</a>}
          {s?.address && <p className="flex items-center gap-2 text-white/80"><MapPin size={15} /> {s.address}</p>}
        </div>
        {list.length > 0 && (
          <div className="space-y-3">
            <p className="font-bold uppercase tracking-wider text-xs text-white/60">{t('follow')}</p>
            <div className="flex gap-2">
              {list.map((x) => (
                <a key={x.key} href={x.href} target="_blank" rel="noreferrer" aria-label={x.label}
                  className="h-11 w-11 rounded-full bg-white/10 hover:bg-[var(--red)] flex items-center justify-center transition-colors">{x.icon}</a>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-white/50">
        © {new Date().getFullYear()} {s?.company_name} — {t('rights')}
      </div>
    </footer>
  );
}

function TextBlocks({ location, className = '' }: { location: SiteText['location']; className?: string }) {
  const all = useSite((s) => s.texts);
  const texts = useMemo(() => all.filter((x) => x.location === location), [all, location]);
  if (texts.length === 0) return null;
  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${className}`}>
      {texts.map((x, i) => (
        <motion.article key={x.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          transition={{ delay: i * 0.05, duration: 0.3 }} className="paper-card p-5">
          {x.title && <h3 className="font-serif-display text-xl font-bold mb-2">{x.title}</h3>}
          <p className="text-[var(--ink-soft)] whitespace-pre-line leading-relaxed">{x.content}</p>
        </motion.article>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- LANDING */
function Landing() {
  const t = useT();
  const { settings: s, products } = useSite();
  const reduce = useReducedMotion();
  const featured = products.filter((p) => p.image).slice(0, 4);
  const words = (s?.site_name || s?.company_name || '').split(' ');
  return (
    <>
      <section className="relative isolate overflow-hidden">
        {s?.background_url && (
          <motion.img src={s.background_url} alt="" aria-hidden
            initial={reduce ? false : { scale: 1.12 }} animate={{ scale: 1 }} transition={{ duration: 1.6, ease: 'easeOut' }}
            className="absolute inset-0 -z-20 h-full w-full object-cover" />
        )}
        <div className={`absolute inset-0 -z-10 ${s?.background_url ? 'bg-gradient-to-b from-black/75 via-black/55 to-black/80' : 'bg-[radial-gradient(800px_400px_at_80%_10%,rgba(220,38,38,0.18),transparent),linear-gradient(160deg,#111113,#0b0b0c)]'}`} />
        <div className="mx-auto max-w-5xl px-4 min-h-[78dvh] flex flex-col items-center justify-center text-center text-white py-20">
          {s?.logo && (
            <motion.img src={s.logo} alt={s.company_name} initial={{ opacity: 0, y: -10, rotate: -6 }} animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={SPRING} className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl bg-white p-2 object-contain shadow-2xl mb-6" />
          )}
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
            className="uppercase tracking-[0.3em] text-xs sm:text-sm font-bold text-red-400 mb-4">{s?.company_name}</motion.p>
          <h1 className="font-serif-display text-4xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.05]">
            {words.map((w, i) => (
              <motion.span key={i} className="inline-block me-[0.25em]"
                initial={reduce ? false : { opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.08, ...SPRING }}>{w}</motion.span>
            ))}
          </h1>
          <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            className="mt-5 max-w-2xl text-base sm:text-lg text-white/85 leading-relaxed">{s?.site_description}</motion.p>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}
            className="mt-9 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Link to="/site/offres" className="site-btn site-btn-red !min-h-[52px] !px-8 text-base">{t('ourProducts')} <ArrowRight size={18} className="rtl:rotate-180" /></Link>
            <Link to="/site/contact" className="site-btn !min-h-[52px] !px-8 text-base bg-white/10 text-white border border-white/40 hover:bg-white hover:text-[var(--ink)]">{t('aboutUs')}</Link>
          </motion.div>
        </div>
        {/* bord déchiré de la feuille */}
        <svg className="absolute bottom-0 left-0 w-full h-6 text-[var(--paper)]" viewBox="0 0 1200 24" preserveAspectRatio="none" aria-hidden>
          <path fill="currentColor" d="M0 24V12l40 6 50-9 60 8 45-10 55 9 50-6 60 8 40-11 55 9 45-6 60 9 50-8 45 7 60-9 50 8 45-6 55 9 50-8 40 6 60-9 45 8 55-7 50 9 40-6 50 8V24z" />
        </svg>
      </section>

      <section className="mx-auto max-w-7xl px-4 mt-12 space-y-12">
        <TextBlocks location="landing" />
        {featured.length > 0 && (
          <div>
            <div className="flex items-end justify-between mb-6">
              <h2 className="font-serif-display text-3xl font-extrabold">{t('ourProducts')}</h2>
              <Link to="/site/offres" className="text-sm font-bold text-[var(--red)] hover:underline inline-flex items-center gap-1">{t('browse')} <ArrowRight size={15} className="rtl:rotate-180" /></Link>
            </div>
            <ProductGrid products={featured} />
          </div>
        )}
      </section>
    </>
  );
}

/* ----------------------------------------------------------------- OFFRES */
function ProductCard({ p, index, onOpen }: { p: SiteProduct; index: number; onOpen: () => void }) {
  const t = useT();
  const add = useSite((s) => s.addToCart);
  const navigate = useNavigate();
  const [added, setAdded] = useState(false);
  const reduce = useReducedMotion();
  const addIt = () => { add(p.id); setAdded(true); window.setTimeout(() => setAdded(false), 1200); };
  return (
    <motion.div layout
      initial={reduce ? false : { opacity: 0, y: 24, rotate: index % 2 ? 1.5 : -1.5 }}
      whileInView={{ opacity: 1, y: 0, rotate: 0 }} viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: (index % 8) * 0.04, ...SPRING }}
      className="paper-card flex flex-col overflow-visible">
      <span className="paper-corner" aria-hidden />
      <button onClick={onOpen} className="text-start flex-1 flex flex-col cursor-pointer" aria-label={`${t('details')} — ${p.name}`}>
        <div className="m-2 mb-0 aspect-[4/3] sm:aspect-square rounded overflow-hidden bg-[var(--paper-2)] border border-black/[0.06]">
          {p.image
            ? <img src={p.image} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" />
            : <div className="h-full flex items-center justify-center text-black/25"><Package size={40} /></div>}
        </div>
        <div className="px-3 pt-2.5 pb-1 flex-1 flex flex-col">
          {p.category && <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[var(--red)] truncate">{p.category}</span>}
          <h3 className="font-semibold text-sm sm:text-base leading-snug line-clamp-2">{p.name}</h3>
          {p.unit && <p className="mt-auto pt-1.5 text-[11px] font-medium text-[var(--ink-muted)]">{p.unit}</p>}
        </div>
      </button>
      <div className="grid grid-cols-[44px_1fr] sm:grid-cols-2 gap-1.5 p-2 pt-1">
        <button onClick={addIt} aria-label={t('addToCart')} title={t('addToCart')}
          className={`site-btn !px-0 sm:!px-3 !rounded-lg text-xs sm:text-sm ${added ? 'site-btn-ink' : 'site-btn-ghost'}`}>
          {added ? <Check size={16} /> : <ShoppingBag size={16} />}<span className="hidden sm:inline">{added ? t('added') : t('cart')}</span>
        </button>
        <button onClick={() => { add(p.id); navigate('/site/commande'); }} className="site-btn site-btn-red !px-2 !rounded-lg text-xs sm:text-sm">
          {t('orderNow')}
        </button>
      </div>
    </motion.div>
  );
}

function ProductGrid({ products }: { products: SiteProduct[] }) {
  const [open, setOpen] = useState<SiteProduct | null>(null);
  return (
    <>
      {/* 2 colonnes sur mobile : 4 cartes visibles par écran */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-5 sm:gap-x-6 sm:gap-y-8">
        {products.map((p, i) => <ProductCard key={p.id} p={p} index={i} onOpen={() => setOpen(p)} />)}
      </div>
      <ProductSheet p={open} onClose={() => setOpen(null)} />
    </>
  );
}

function ProductSheet({ p, onClose }: { p: SiteProduct | null; onClose: () => void }) {
  const t = useT();
  const add = useSite((s) => s.addToCart);
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  useEffect(() => { setQty(1); }, [p]);
  useEffect(() => {
    if (!p) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [p, onClose]);
  return (
    <AnimatePresence>
      {p && (
        <motion.div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-label={p.name}
            initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={SPRING}
            className="relative w-full sm:max-w-3xl max-h-[92dvh] overflow-y-auto bg-[var(--sheet)] rounded-t-2xl sm:rounded-xl shadow-2xl grid sm:grid-cols-2">
            <button onClick={onClose} aria-label={t('back')} className="absolute top-3 end-3 z-10 h-11 w-11 rounded-full bg-white/90 border border-black/10 flex items-center justify-center"><X size={20} /></button>
            <div className="bg-[var(--paper-2)] aspect-square sm:aspect-auto">
              {p.image ? <img src={p.image} alt={p.name} className="h-full w-full object-cover" />
                : <div className="h-full min-h-60 flex items-center justify-center text-black/25"><Package size={64} /></div>}
            </div>
            <div className="p-6 flex flex-col gap-4">
              {p.category && <span className="text-xs font-bold uppercase tracking-wider text-[var(--red)]">{p.category}</span>}
              <h2 className="font-serif-display text-2xl sm:text-3xl font-extrabold leading-tight">{p.name}</h2>
              {p.unit && <p className="text-sm font-medium text-[var(--ink-muted)]">{p.unit}</p>}
              {p.description && <p className="ruled text-[var(--ink-soft)] whitespace-pre-line">{p.description}</p>}
              <div className="mt-auto space-y-3">
                <QtyControl value={qty} onChange={setQty} />
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { add(p.id, qty); onClose(); }} className="site-btn site-btn-ghost"><ShoppingBag size={17} /> {t('addToCart')}</button>
                  <button onClick={() => { add(p.id, qty); onClose(); navigate('/site/commande'); }} className="site-btn site-btn-red">{t('orderNow')}</button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QtyControl({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const t = useT();
  return (
    <div className="inline-flex items-center rounded-full border border-black/15 bg-white" role="group" aria-label={t('quantity')}>
      <button onClick={() => onChange(Math.max(1, value - 1))} aria-label="-1" className="h-11 w-11 flex items-center justify-center rounded-full hover:text-[var(--red)]"><Minus size={16} /></button>
      <input type="number" inputMode="decimal" min={1} value={value} aria-label={t('quantity')}
        onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
        className="w-16 text-center font-bold bg-transparent tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <button onClick={() => onChange(value + 1)} aria-label="+1" className="h-11 w-11 flex items-center justify-center rounded-full hover:text-[var(--red)]"><Plus size={16} /></button>
    </div>
  );
}

function Offers() {
  const t = useT();
  const products = useSite((s) => s.products);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [sort, setSort] = useState<'name' | 'asc' | 'desc'>('name');
  const cats = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(), [products]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = products.filter((p) => (!cat || p.category === cat) && (!s || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(s)));
    if (sort === 'asc') r.sort((a, b) => a.price - b.price);
    if (sort === 'desc') r.sort((a, b) => b.price - a.price);
    return r;
  }, [products, q, cat, sort]);
  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:pt-12">
      <h1 className="font-serif-display text-3xl sm:text-5xl font-extrabold">{t('ourProducts')}</h1>
      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={18} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} aria-label={t('search')} className="site-input !ps-10 !rounded-full" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Tri" className="site-input sm:!w-52 !rounded-full">
          <option value="name">A → Z</option>
        </select>
      </div>
      {cats.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 [scrollbar-width:none]">
          {['', ...cats].map((c) => (
            <button key={c || 'all'} onClick={() => setCat(c)} aria-pressed={cat === c}
              className={`relative shrink-0 h-10 px-4 rounded-full text-sm font-semibold border transition-colors ${cat === c ? 'text-white border-transparent' : 'border-black/15 bg-white text-[var(--ink-soft)] hover:border-[var(--red)]'}`}>
              {cat === c && <motion.span layoutId="cat-pill" transition={SPRING} className="absolute inset-0 rounded-full bg-[var(--red)]" />}
              <span className="relative">{c || t('all')}</span>
            </button>
          ))}
        </div>
      )}
      <TextBlocks location="offers" className="mt-6" />
      <div className="mt-8">
        {list.length === 0
          ? <p className="py-20 text-center text-[var(--ink-muted)]">{t('noProducts')}</p>
          : <ProductGrid products={list} />}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- CONTACTS */
function Contacts() {
  const t = useT();
  const { settings: s, products } = useSite();
  const gallery = products.filter((p) => p.image).slice(0, 8);
  const list = socials(s);
  const items = [
    s?.phone && { icon: <Phone size={20} />, label: t('phone'), value: s.phone, href: `tel:${s.phone}` },
    s?.phone2 && { icon: <Phone size={20} />, label: t('phone'), value: s.phone2, href: `tel:${s.phone2}` },
    s?.email && { icon: <Mail size={20} />, label: t('email'), value: s.email, href: `mailto:${s.email}` },
    s?.address && { icon: <MapPin size={20} />, label: t('address'), value: s.address, href: `https://maps.google.com/?q=${encodeURIComponent(s.address)}` },
  ].filter(Boolean) as { icon: JSX.Element; label: string; value: string; href: string }[];
  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:pt-12 space-y-12">
      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] items-start">
        <div>
          <p className="uppercase tracking-[0.25em] text-xs font-bold text-[var(--red)] mb-3">{t('aboutUs')}</p>
          <h1 className="font-serif-display text-3xl sm:text-5xl font-extrabold leading-tight">{s?.company_name}</h1>
          {s?.site_description && <p className="mt-4 text-lg text-[var(--ink-soft)]">{s.site_description}</p>}
          {s?.about_text && <p className="mt-6 text-[var(--ink-soft)] leading-relaxed whitespace-pre-line max-w-prose">{s.about_text}</p>}
        </div>
        <div className="paper-card p-6 space-y-3">
          <h2 className="font-serif-display text-2xl font-bold mb-1">{t('contactUs')}</h2>
          {items.map((x, i) => (
            <a key={i} href={x.href} target={x.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer"
              className="flex items-center gap-3 rounded-lg p-3 hover:bg-[var(--red-soft)] transition-colors">
              <span className="h-11 w-11 shrink-0 rounded-full bg-[var(--ink)] text-white flex items-center justify-center">{x.icon}</span>
              <span className="min-w-0"><span className="block text-xs text-[var(--ink-muted)]">{x.label}</span><span className="block font-semibold break-words" dir="auto">{x.value}</span></span>
            </a>
          ))}
          {list.length > 0 && (
            <div className="pt-3 border-t border-black/10">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-2">{t('follow')}</p>
              <div className="flex flex-wrap gap-2">
                {list.map((x) => (
                  <a key={x.key} href={x.href} target="_blank" rel="noreferrer" className="site-btn site-btn-ghost !min-h-11 text-sm">{x.icon} {x.label}</a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <TextBlocks location="contacts" />
      {gallery.length > 0 && (
        <div>
          <h2 className="font-serif-display text-3xl font-extrabold mb-6">{t('gallery')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">
            {gallery.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, scale: 0.94 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
                transition={{ delay: i * 0.04 }} className="paper-card p-1.5">
                <Link to={`/site/commande?produit=${p.id}`} className="block">
                  <img src={p.image as string} alt={p.name} loading="lazy" className="aspect-square w-full object-cover rounded" />
                  <p className="px-1 py-2 text-sm font-semibold truncate">{p.name}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      )}
      <div className="text-center">
        <Link to="/site/offres" className="site-btn site-btn-red !px-8">{t('ourProducts')} <ArrowRight size={18} className="rtl:rotate-180" /></Link>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- COMMANDE */
const emptyInfo = { client_name: '', client_phone: '', client_address: '', client_note: '', rc: '', nif: '', nis: '', article: '', notes: '' };

function OrderPage() {
  const t = useT();
  const { products, cart, setQty, removeFromCart, addToCart, clearCart, client } = useSite();
  const [params, setParams] = useSearchParams();
  const [info, setInfo] = useState(emptyInfo);
  const [showFiscal, setShowFiscal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ reference: string; total: number } | null>(null);
  const [q, setQ] = useState('');

  // lien « copier le lien » d'un produit : il est ajouté au panier automatiquement
  useEffect(() => {
    const id = params.get('produit');
    if (!id) return;
    if (products.some((p) => p.id === id) && !useSite.getState().cart.some((l) => l.id === id)) addToCart(id);
    params.delete('produit');
    setParams(params, { replace: true });
  }, [params, products, addToCart, setParams]);

  useEffect(() => { if (client) setInfo((i) => ({ ...i, client_address: i.client_address || client.address || '' })); }, [client]);

  const lines = cart.map((l) => ({ ...l, p: products.find((p) => p.id === l.id) })).filter((l) => l.p) as
    { id: string; quantity: number; p: SiteProduct }[];
  const suggestions = q.trim()
    ? products.filter((p) => `${p.name} ${p.category}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!client && (!info.client_name.trim() || !info.client_phone.trim())) { setError(t('required')); return; }
    setBusy(true);
    const { data, error: err } = await siteSupabase.rpc('website_place_order', {
      p_payload: { ...info, items: lines.map((l) => ({ id: l.id, quantity: l.quantity })) },
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone({ reference: data.reference, total: Number(data.total) || 0 });
    clearCart();
    setInfo(emptyInfo);
  };

  if (done) {
    return (
      <section className="mx-auto max-w-lg px-4 pt-16 text-center">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={SPRING}
          className="mx-auto h-20 w-20 rounded-full bg-[var(--red)] text-white flex items-center justify-center shadow-xl"><Check size={40} /></motion.div>
        <h1 className="mt-6 font-serif-display text-3xl font-extrabold">{t('orderSent')}</h1>
        <p className="mt-2 text-[var(--ink-soft)]">{t('orderThanks')}</p>
        <div className="paper-card mt-6 p-5 text-start space-y-1">
          <p className="flex justify-between"><span>{t('orderRef')}</span><strong className="font-mono">{done.reference}</strong></p>
        </div>
        <Link to="/site/offres" className="site-btn site-btn-red mt-8">{t('continueShopping')}</Link>
      </section>
    );
  }

  const field = (k: keyof typeof info, label: string, opts: { type?: string; required?: boolean; auto?: string } = {}) => (
    <div>
      <label className="site-label" htmlFor={`f-${k}`}>{label}{opts.required && <span className="text-[var(--red)]"> *</span>}</label>
      <input id={`f-${k}`} className="site-input" type={opts.type ?? 'text'} autoComplete={opts.auto} value={info[k]}
        onChange={(e) => setInfo({ ...info, [k]: e.target.value })} required={opts.required} />
    </div>
  );

  return (
    <section className="mx-auto max-w-7xl px-4 pt-8 sm:pt-12">
      <h1 className="font-serif-display text-3xl sm:text-5xl font-extrabold">{t('cart')}</h1>
      <TextBlocks location="order" className="mt-6" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.4fr_1fr] items-start">
        <div className="space-y-4">
          {/* recherche pour ajouter d'autres produits */}
          <div className="relative">
            <Search size={18} className="absolute start-3.5 top-[23px] -translate-y-1/2 text-[var(--ink-muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('addMore')} aria-label={t('addMore')} className="site-input !ps-10 !rounded-full" />
            {suggestions.length > 0 && (
              <div className="absolute z-20 mt-2 w-full rounded-xl border border-black/10 bg-white shadow-xl overflow-hidden">
                {suggestions.map((p) => (
                  <button key={p.id} onClick={() => { addToCart(p.id); setQ(''); }}
                    className="w-full flex items-center gap-3 p-2.5 text-start hover:bg-[var(--red-soft)]">
                    <span className="h-11 w-11 rounded bg-[var(--paper-2)] overflow-hidden shrink-0">{p.image && <img src={p.image} alt="" className="h-full w-full object-cover" />}</span>
                    <span className="flex-1 min-w-0 font-semibold truncate">{p.name}</span>
                    <Plus size={18} className="text-[var(--red)]" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="paper-card p-10 text-center">
              <ShoppingBag size={40} className="mx-auto text-black/25" />
              <p className="mt-3 text-[var(--ink-soft)]">{t('emptyCart')}</p>
              <Link to="/site/offres" className="site-btn site-btn-red mt-5">{t('browse')}</Link>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {lines.map((l) => (
                <motion.div key={l.id} layout initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
                  transition={SPRING} className="paper-card p-3 flex flex-wrap sm:flex-nowrap items-center gap-3">
                  <div className="h-20 w-20 shrink-0 rounded overflow-hidden bg-[var(--paper-2)]">
                    {l.p.image ? <img src={l.p.image} alt="" className="h-full w-full object-cover" /> : <Package className="m-auto mt-6 text-black/25" />}
                  </div>
                  <div className="flex-1 min-w-[8rem]">
                    <p className="font-semibold leading-snug">{l.p.name}</p>
                    {l.p.unit && <p className="text-sm text-[var(--ink-muted)]">{l.p.unit}</p>}
                  </div>
                  <QtyControl value={l.quantity} onChange={(v) => setQty(l.id, v)} />
                  <button onClick={() => removeFromCart(l.id)} aria-label={t('remove')} className="h-11 w-11 rounded-full flex items-center justify-center text-[var(--ink-muted)] hover:bg-[var(--red-soft)] hover:text-[var(--red)]"><Trash2 size={18} /></button>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>

        <form onSubmit={submit} className="paper-card p-5 sm:p-6 space-y-4 lg:sticky lg:top-24">
          <h2 className="font-serif-display text-2xl font-bold">{t('yourInfo')}</h2>
          {client ? (
            <div className="rounded-lg bg-[var(--paper-2)] p-3 text-sm">
              <p className="text-[var(--ink-muted)]">{t('loggedAs')}</p>
              <p className="font-bold">{client.name}</p>
              {client.phone && <p dir="ltr" className="text-start">{client.phone}</p>}
            </div>
          ) : (
            <>
              {field('client_name', t('name'), { required: true, auto: 'name' })}
              {field('client_phone', t('phone'), { type: 'tel', required: true, auto: 'tel' })}
            </>
          )}
          {field('client_address', t('address'), { auto: 'street-address' })}
          {!client && (
            <>
              <button type="button" onClick={() => setShowFiscal(!showFiscal)} aria-expanded={showFiscal}
                className="text-sm font-semibold text-[var(--red)] hover:underline">{t('fiscal')} {showFiscal ? '−' : '+'}</button>
              <AnimatePresence initial={false}>
                {showFiscal && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="grid grid-cols-2 gap-3 overflow-hidden">
                    {field('rc', 'R.C')}{field('nif', 'NIF')}{field('nis', 'NIS')}{field('article', 'Article')}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
          <div>
            <label className="site-label" htmlFor="f-notes">{t('message')}</label>
            <textarea id="f-notes" rows={3} className="site-input" value={info.notes} onChange={(e) => setInfo({ ...info, notes: e.target.value })} />
          </div>
          <div className="border-t border-dashed border-black/20 pt-4 space-y-1.5">
            {lines.map((l) => (
              <p key={l.id} className="flex justify-between gap-3 text-sm text-[var(--ink-soft)]">
                <span className="truncate">{l.p.name}</span><span className="tabular-nums">× {l.quantity}</span>
              </p>
            ))}
          </div>
          {error && <p role="alert" className="rounded-lg bg-[var(--red-soft)] text-[var(--red-dark)] text-sm p-3">{error}</p>}
          <button type="submit" disabled={busy || lines.length === 0} className="site-btn site-btn-red w-full !min-h-[52px] text-base">
            {busy ? t('sending') : t('placeOrder')}
          </button>
        </form>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- CONNEXION */
function LoginPage() {
  const t = useT();
  const { settings: s, client, open, signIn } = useSite();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = params.get('next') || '/site';
  if (client) return <Navigate to={next} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await signIn(email, password);
    setBusy(false);
    if (r === 'ok') navigate(next, { replace: true });
    else setError(r === 'bad' ? t('badLogin') : t('notClient'));
  };

  return (
    <div className="relative min-h-dvh flex items-center justify-center p-4 isolate">
      {s?.background_url && <img src={s.background_url} alt="" aria-hidden className="absolute inset-0 -z-20 h-full w-full object-cover" />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-black/80 to-black/60" />
      <div className="absolute top-4 end-4"><LangSwitch /></div>
      <motion.form onSubmit={submit} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}
        className="paper-card w-full max-w-md p-7 space-y-5">
        <span className="paper-corner" aria-hidden />
        <div className="text-center space-y-2">
          {s?.logo && <img src={s.logo} alt="" className="mx-auto h-16 w-16 object-contain" />}
          <h1 className="font-serif-display text-2xl font-extrabold">{s?.site_name || s?.company_name}</h1>
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--red)]"><Lock size={14} /> {t('privateSite')}</p>
          <p className="text-sm text-[var(--ink-muted)]">{t('privateHint')}</p>
        </div>
        <div>
          <label className="site-label" htmlFor="l-email">{t('email')}</label>
          <input id="l-email" type="email" autoComplete="email" required className="site-input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="site-label" htmlFor="l-pass">{t('password')}</label>
          <input id="l-pass" type="password" autoComplete="current-password" required className="site-input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-lg bg-[var(--red-soft)] text-[var(--red-dark)] text-sm p-3">{error}</p>}
        <button type="submit" disabled={busy} className="site-btn site-btn-red w-full !min-h-[52px]"><LogIn size={18} /> {busy ? t('loading') : t('signIn')}</button>
        {open && <Link to="/site" className="block text-center text-sm font-semibold text-[var(--ink-soft)] hover:text-[var(--red)]"><Globe2 size={14} className="inline me-1" />{t('home')}</Link>}
      </motion.form>
    </div>
  );
}
