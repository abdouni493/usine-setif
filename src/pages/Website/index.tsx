import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Globe, Eye, Pencil, EyeOff, Link2, ImagePlus, Save, Plus, Trash2, ExternalLink,
  Facebook, Instagram, Phone, Mail, MessageCircle, Music2, MapPin, Lock, Unlock, Type, Package,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { SearchBar } from '@/components/ui/SearchBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/Toast';
import { useFicheTechnicStore, type FicheTechnic } from '@/store/ficheTechnicStore';
import {
  useWebsiteStore, TEXT_LOCATIONS, type WebsiteSettings, type WebsiteText, type WebsiteTextLocation,
} from '@/store/websiteStore';
import { usePermissions } from '@/hooks/usePermissions';
import { uploadImage } from '@/lib/storage';
import { formatCurrency } from '@/lib/utils';
import { siteUrl } from '@/lib/siteUrl';


/** Valeurs affichées sur le site : celles du site si renseignées, sinon la fiche. */
const webView = (f: FicheTechnic) => ({
  name: f.webName || f.name,
  description: f.webDescription || f.description || '',
  price: f.webPrice ?? f.unitPrice,
  image: f.webImageUrl || f.imageUrl || '',
});

function ImageField({
  label, value, onChange, folder, hint,
}: { label: string; value: string; onChange: (url: string) => void; folder: string; hint?: string }) {
  const [busy, setBusy] = useState(false);
  const pick = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Choisissez une image (PNG, JPG, WEBP, ICO)'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("L'image dépasse 5 Mo"); return; }
    setBusy(true);
    try { onChange(await uploadImage('store-assets', file, folder)); } catch { toast.error("Impossible d'envoyer l'image"); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <p className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-1.5">{label}</p>
      <div className="flex items-center gap-3">
        <div className="h-20 w-28 shrink-0 rounded-lg border border-gold/20 bg-vanilla/40 overflow-hidden flex items-center justify-center">
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <ImagePlus size={22} className="text-text-muted" />}
        </div>
        <div className="flex flex-col gap-2">
          <label className="inline-flex items-center gap-2 cursor-pointer text-sm font-semibold text-gold hover:underline">
            <ImagePlus size={15} /> {busy ? 'Envoi…' : value ? "Changer l'image" : 'Choisir une image'}
            <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {value && (
            <button type="button" onClick={() => onChange('')} className="text-xs text-rose-deep hover:underline text-left">
              Retirer
            </button>
          )}
          {hint && <span className="text-[11px] text-text-muted">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ OFFRES */
function OffersTab() {
  const fiches = useFicheTechnicStore((s) => s.ficheTechnics);
  const updateProduct = useWebsiteStore((s) => s.updateProduct);
  const { can } = usePermissions();
  const canEdit = can('website', 'edit');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'visible' | 'hidden'>('all');
  const [viewing, setViewing] = useState<FicheTechnic | null>(null);
  const [editing, setEditing] = useState<FicheTechnic | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(fiches.map((f) => f.categoryName).filter(Boolean))).sort(),
    [fiches],
  );
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fiches.filter((f) => {
      const v = webView(f);
      if (category && f.categoryName !== category) return false;
      if (visibility === 'visible' && f.webHidden) return false;
      if (visibility === 'hidden' && !f.webHidden) return false;
      return !q || `${v.name} ${f.name} ${v.description} ${f.categoryName}`.toLowerCase().includes(q);
    });
  }, [fiches, query, category, visibility]);

  const copyLink = async (f: FicheTechnic) => {
    const url = siteUrl(`/commande?produit=${f.id}`);
    try { await navigator.clipboard.writeText(url); toast.success('Lien copié'); }
    catch { window.prompt('Copiez le lien :', url); }
  };
  const toggleHidden = async (f: FicheTechnic) => {
    try {
      await updateProduct(f.id, { webHidden: !f.webHidden });
      toast.success(f.webHidden ? 'Produit visible sur le site' : 'Produit masqué du site');
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row gap-3">
        <SearchBar value={query} onChange={setQuery} placeholder="Rechercher un produit…" className="md:max-w-sm" />
        <Select
          value={category} onChange={(e) => setCategory(e.target.value)} className="md:w-56"
          options={[{ value: '', label: 'Toutes les catégories' }, ...categories.map((c) => ({ value: c, label: c }))]}
        />
        <Select
          value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} className="md:w-48"
          options={[
            { value: 'all', label: 'Tous' }, { value: 'visible', label: 'Visibles' }, { value: 'hidden', label: 'Masqués' },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <EmptyState message="Aucun produit — créez des fiches techniques dans Production" icon={<Package size={30} />} />
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((f, i) => {
            const v = webView(f);
            return (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className={`rounded-xl border bg-gradient-card shadow-card overflow-hidden flex flex-col ${f.webHidden ? 'border-dashed border-text-muted/40 opacity-70' : 'border-gold/15'}`}
              >
                <div className="relative h-40 bg-vanilla/40">
                  {v.image
                    ? <img src={v.image} alt={v.name} className="h-full w-full object-cover" />
                    : <div className="h-full flex items-center justify-center text-text-muted"><Package size={36} /></div>}
                  <div className="absolute top-2 left-2">
                    {f.webHidden ? <Badge variant="neutral"><EyeOff size={11} /> Masqué</Badge> : <Badge variant="success"><Eye size={11} /> Visible</Badge>}
                  </div>
                </div>
                <div className="p-4 flex-1 flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-text-primary leading-tight">{v.name}</h3>
                    <ActionMenu
                      items={[
                        { label: 'Voir les détails', icon: <Eye size={15} />, onClick: () => setViewing(f) },
                        { label: 'Modifier', icon: <Pencil size={15} />, onClick: () => setEditing(f), hidden: !canEdit },
                        {
                          label: f.webHidden ? 'Afficher sur le site' : 'Masquer du site',
                          icon: f.webHidden ? <Eye size={15} /> : <EyeOff size={15} />, onClick: () => toggleHidden(f), hidden: !canEdit,
                        },
                        { label: 'Copier le lien', icon: <Link2 size={15} />, onClick: () => copyLink(f) },
                      ]}
                    />
                  </div>
                  {f.categoryName && <span className="text-[11px] uppercase tracking-wider text-text-muted">{f.categoryName}</span>}
                  <p className="text-xs text-text-secondary line-clamp-2 min-h-[2rem]">{v.description || '—'}</p>
                  <p className="mt-auto pt-2 text-lg font-bold text-gold">
                    {formatCurrency(v.price)}{f.sellUnit ? <span className="text-xs font-medium text-text-muted"> / {f.sellUnit}</span> : null}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? webView(viewing).name : ''} size="md">
        {viewing && (() => {
          const v = webView(viewing);
          return (
            <div className="space-y-4">
              {v.image && <img src={v.image} alt={v.name} className="w-full max-h-72 object-contain rounded-xl border border-gold/15 bg-vanilla/30" />}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Nom sur le site" value={v.name} />
                <Info label="Nom de la fiche" value={viewing.name} />
                <Info label="Prix sur le site" value={formatCurrency(v.price)} />
                <Info label="Prix de la fiche" value={formatCurrency(viewing.unitPrice)} />
                <Info label="Catégorie" value={viewing.categoryName || '—'} />
                <Info label="Unité de vente" value={viewing.sellUnit || viewing.productUnit || '—'} />
                <Info label="Visibilité" value={viewing.webHidden ? 'Masqué' : 'Visible'} />
                <Info label="Créé le" value={viewing.createdAt} />
              </div>
              <Info label="Description" value={v.description || '—'} />
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="secondary" onClick={() => copyLink(viewing)}><Link2 size={15} /> Copier le lien</Button>
                <Button variant="secondary" onClick={() => window.open(siteUrl(`/commande?produit=${viewing.id}`), '_blank')}>
                  <ExternalLink size={15} /> Ouvrir
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {editing && <ProductEditModal fiche={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-vanilla/40 border border-gold/10 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="text-text-primary font-medium whitespace-pre-line break-words">{value}</p>
    </div>
  );
}

function ProductEditModal({ fiche, onClose }: { fiche: FicheTechnic; onClose: () => void }) {
  const updateProduct = useWebsiteStore((s) => s.updateProduct);
  const v = webView(fiche);
  const [name, setName] = useState(v.name);
  const [description, setDescription] = useState(v.description);
  const [price, setPrice] = useState(String(v.price ?? ''));
  const [image, setImage] = useState(v.image);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) { toast.error('Nom requis'); return; }
    const p = Number(price);
    if (price !== '' && (!Number.isFinite(p) || p < 0)) { toast.error('Prix invalide'); return; }
    setBusy(true);
    try {
      await updateProduct(fiche.id, {
        // identique à la fiche = pas de valeur propre au site
        webName: name.trim() === fiche.name ? '' : name.trim(),
        webDescription: description === (fiche.description ?? '') ? '' : description,
        webPrice: price === '' || p === fiche.unitPrice ? null : p,
        webImageUrl: image === (fiche.imageUrl ?? '') ? '' : image,
      });
      toast.success('Produit mis à jour sur le site');
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Modifier — ${fiche.name}`} size="md"
      footer={<div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button onClick={submit} disabled={busy}><Save size={15} /> Enregistrer</Button>
      </div>}
    >
      <div className="space-y-4">
        <ImageField label="Image" value={image} onChange={setImage} folder="site/produits" />
        <Input label="Nom affiché *" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Prix (DA)" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Textarea label="Description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        <p className="text-[11px] text-text-muted">
          Ces valeurs ne concernent que le site : la fiche technique et ses calculs ne changent pas.
        </p>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- CONTACTS */
const CONTACT_FIELDS: { key: keyof WebsiteSettings; label: string; icon: JSX.Element; placeholder: string }[] = [
  { key: 'facebook', label: 'Facebook', icon: <Facebook size={15} />, placeholder: 'https://facebook.com/…' },
  { key: 'instagram', label: 'Instagram', icon: <Instagram size={15} />, placeholder: 'https://instagram.com/…' },
  { key: 'tiktok', label: 'TikTok', icon: <Music2 size={15} />, placeholder: 'https://tiktok.com/@…' },
  { key: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle size={15} />, placeholder: '+213 5…' },
  { key: 'phone', label: 'Téléphone', icon: <Phone size={15} />, placeholder: '0555 …' },
  { key: 'phone2', label: 'Deuxième téléphone', icon: <Phone size={15} />, placeholder: '0666 …' },
  { key: 'email', label: 'E-mail', icon: <Mail size={15} />, placeholder: 'contact@…' },
  { key: 'address', label: 'Adresse', icon: <MapPin size={15} />, placeholder: 'Zone industrielle, …' },
];

function ContactsTab() {
  const settings = useWebsiteStore((s) => s.settings);
  const saveSettings = useWebsiteStore((s) => s.saveSettings);
  const { can } = usePermissions();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(settings), [settings]);

  const submit = async () => {
    setBusy(true);
    try { await saveSettings(form); toast.success('Contacts enregistrés'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-gold/15 bg-gradient-card shadow-card p-5 space-y-4 max-w-3xl">
      <p className="text-sm text-text-secondary">Ces contacts et réseaux sociaux apparaissent sur la page « À propos » et le pied de page du site.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CONTACT_FIELDS.map((f) => (
          <Input
            key={f.key} label={f.label} icon={f.icon} placeholder={f.placeholder}
            value={String(form[f.key] ?? '')}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
          />
        ))}
      </div>
      {can('website', 'edit') && (
        <div className="flex justify-end"><Button onClick={submit} disabled={busy}><Save size={15} /> Enregistrer</Button></div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- RÉGLAGES */
function SettingsTab() {
  const settings = useWebsiteStore((s) => s.settings);
  const saveSettings = useWebsiteStore((s) => s.saveSettings);
  const { can } = usePermissions();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(settings), [settings]);

  const submit = async () => {
    setBusy(true);
    try { await saveSettings(form); toast.success('Réglages du site enregistrés'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gold/15 bg-gradient-card shadow-card p-5 space-y-5 max-w-3xl">
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg p-4 border ${form.isPublic ? 'border-pistachio/30 bg-pistachio/5' : 'border-caramel/30 bg-caramel/5'}`}>
          <div className="flex items-center gap-3">
            {form.isPublic ? <Unlock size={20} className="text-pistachio" /> : <Lock size={20} className="text-caramel" />}
            <div>
              <p className="font-semibold text-text-primary">{form.isPublic ? 'Site public' : 'Site privé'}</p>
              <p className="text-xs text-text-muted">
                {form.isPublic
                  ? "Tout le monde voit les offres ; le visiteur saisit ses informations pour commander."
                  : 'Le site s’ouvre sur la page de connexion : seuls les clients avec un accès peuvent voir et commander.'}
              </p>
            </div>
          </div>
          <Switch checked={form.isPublic} onChange={(v) => setForm({ ...form, isPublic: v })} label={form.isPublic ? 'Public' : 'Privé'} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Nom du site" value={form.siteName} placeholder="Vide = nom de la société" onChange={(e) => setForm({ ...form, siteName: e.target.value })} />
          <Input label="Description courte" value={form.siteDescription} onChange={(e) => setForm({ ...form, siteDescription: e.target.value })} />
        </div>
        <Textarea label="À propos de la société (page Contacts)" rows={4} value={form.aboutText} onChange={(e) => setForm({ ...form, aboutText: e.target.value })} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ImageField label="Image de fond" value={form.backgroundUrl} folder="site" onChange={(u) => setForm({ ...form, backgroundUrl: u })} hint="Page d'accueil — 1920×1080 conseillé" />
          <ImageField label="Favicon" value={form.faviconUrl} folder="site" onChange={(u) => setForm({ ...form, faviconUrl: u })} hint="Icône de l'onglet — carré, 64×64" />
        </div>
        <p className="text-[11px] text-text-muted">Le logo et le nom de la société viennent de Paramètres → Société.</p>
        {can('website', 'edit') && (
          <div className="flex justify-end"><Button onClick={submit} disabled={busy}><Save size={15} /> Enregistrer</Button></div>
        )}
      </div>
      <TextsSection />
    </div>
  );
}

function TextsSection() {
  const texts = useWebsiteStore((s) => s.texts);
  const { addText, updateText, deleteText } = useWebsiteStore();
  const { can } = usePermissions();
  const [editing, setEditing] = useState<Partial<WebsiteText> | null>(null);
  const [deleting, setDeleting] = useState<WebsiteText | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!editing) return;
    if (!editing.title?.trim() && !editing.content?.trim()) { toast.error('Saisissez un titre ou un texte'); return; }
    setBusy(true);
    try {
      const data = { title: editing.title?.trim() ?? '', content: editing.content ?? '', location: (editing.location ?? 'landing') as WebsiteTextLocation };
      if (editing.id) await updateText(editing.id, data); else await addText(data);
      toast.success('Texte enregistré');
      setEditing(null);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const locLabel = (l: WebsiteTextLocation) => TEXT_LOCATIONS.find((x) => x.value === l)?.label ?? l;

  return (
    <div className="rounded-xl border border-gold/15 bg-gradient-card shadow-card p-5 space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-text-primary flex items-center gap-2"><Type size={16} className="text-gold" /> Textes variables</h3>
          <p className="text-xs text-text-muted">Blocs de texte libres affichés à l'endroit choisi du site.</p>
        </div>
        {can('website', 'create') && (
          <Button size="sm" onClick={() => setEditing({ location: 'landing', title: '', content: '' })}><Plus size={14} /> Nouveau texte</Button>
        )}
      </div>
      {texts.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">Aucun texte pour le moment.</p>
      ) : (
        <div className="space-y-2">
          {texts.map((t) => (
            <div key={t.id} className="flex items-start gap-3 rounded-lg border border-gold/10 bg-vanilla/40 p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-text-primary text-sm">{t.title || 'Sans titre'}</p>
                  <Badge variant="neutral">{locLabel(t.location)}</Badge>
                </div>
                <p className="text-xs text-text-secondary line-clamp-2 whitespace-pre-line">{t.content}</p>
              </div>
              {can('website', 'edit') && <Button size="icon" variant="ghost" onClick={() => setEditing(t)} aria-label="Modifier"><Pencil size={15} /></Button>}
              {can('website', 'delete') && <Button size="icon" variant="ghost" onClick={() => setDeleting(t)} aria-label="Supprimer"><Trash2 size={15} /></Button>}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Modifier le texte' : 'Nouveau texte'} size="sm"
        footer={<div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditing(null)}>Annuler</Button>
          <Button onClick={submit} disabled={busy}><Save size={15} /> Enregistrer</Button>
        </div>}
      >
        {editing && (
          <div className="space-y-4">
            <Input label="Titre" value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <Textarea label="Texte" rows={5} value={editing.content ?? ''} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            <Select label="Afficher sur" value={editing.location ?? 'landing'}
              onChange={(e) => setEditing({ ...editing, location: e.target.value as WebsiteTextLocation })}
              options={TEXT_LOCATIONS} />
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)}
        title="Supprimer ce texte ?" message={deleting?.title || undefined}
        onConfirm={async () => {
          if (!deleting) return;
          try { await deleteText(deleting.id); toast.success('Texte supprimé'); } catch (e) { toast.error((e as Error).message); }
          setDeleting(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------- PAGE */
export default function WebsitePage() {
  const ready = useWebsiteStore((s) => s.ready);
  const [tab, setTab] = useState('offers');
  return (
    <div>
      <PageHeader
        title="Gestion du site web"
        subtitle="Offres, contacts et réglages du site de commande en ligne"
        icon={<Globe size={22} />}
        actions={<Button variant="secondary" onClick={() => window.open(siteUrl(), '_blank')}><ExternalLink size={15} /> Ouvrir le site</Button>}
      />
      {!ready && (
        <div className="mb-4 rounded-lg border border-caramel/40 bg-caramel/10 p-3 text-sm text-text-primary">
          Les tables du site n'existent pas encore : exécutez <code>supabase/parts/08_site_web.sql</code> dans Supabase.
        </div>
      )}
      <Tabs
        className="mb-5 flex-wrap"
        active={tab} onChange={setTab}
        tabs={[{ id: 'offers', label: 'Offres' }, { id: 'contacts', label: 'Contacts' }, { id: 'settings', label: 'Réglages du site' }]}
      />
      {tab === 'offers' && <OffersTab />}
      {tab === 'contacts' && <ContactsTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  );
}
