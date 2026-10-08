import { useState } from 'react';
import { Package, Ruler, Boxes, Coins, CalendarClock, ImagePlus, X, Loader2 } from 'lucide-react';
import { Input, Textarea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { UnitSelect } from '@/components/shared/UnitSelect';
import { formatCurrency } from '@/lib/utils';
import { uploadImage } from '@/lib/storage';
import { toast } from '@/components/ui/Toast';
import type { Product } from '@/types';

interface ProductFormProps {
  initial?: Product | null;
  onSubmit: (data: Omit<Product, 'id' | 'createdAt'>) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Création / modification d'un produit de stock.
 *
 * Le formulaire ne demande plus ni code-barres, ni catégorie, ni marque : le
 * produit est décrit par son nom, sa description et surtout son UNITÉ
 * (sac, tonne, m³ …) que l'utilisateur choisit ou crée directement ici.
 * En modification, TOUTES les informations sont éditables manuellement —
 * y compris les quantités.
 */
export function ProductForm({ initial, onSubmit, onCancel }: ProductFormProps) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    description: initial?.description || '',
    unit: initial?.unit || '',
    principalQuantity: initial?.principalQuantity ?? 0,
    currentQuantity: initial?.currentQuantity ?? 0,
    minAlertQuantity: initial?.minAlertQuantity ?? 0,
    purchasePrice: initial?.purchasePrice ?? 0,
    expirationEnabled: initial?.expirationEnabled ?? false,
    expirationDate: initial?.expirationDate || '',
    imageUrl: initial?.imageUrl || '',
  });
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const u = form.unit ? ` (${form.unit})` : '';
  const stockValue = Number(form.currentQuantity || 0) * Number(form.purchasePrice || 0);

  const handleImage = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Choisissez une image (PNG, JPG, WEBP)'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("L'image dépasse 5 Mo"); return; }
    setUploading(true);
    try {
      set('imageUrl', await uploadImage('product-images', file, 'products'));
    } catch {
      toast.error("Impossible d'envoyer l'image");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Nom requis';
    if (!form.unit.trim()) errs.unit = "Choisissez ou créez l'unité du produit";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        description: form.description,
        // legacy columns kept empty — they are no longer part of the form
        barcode: initial?.barcode || '',
        marqueId: initial?.marqueId || '',
        categoryId: initial?.categoryId || '',
        principalQuantity: Number(
          initial ? form.principalQuantity : form.currentQuantity
        ) || 0,
        currentQuantity: Number(form.currentQuantity) || 0,
        minAlertQuantity: Number(form.minAlertQuantity) || 0,
        purchasePrice: Number(form.purchasePrice) || 0,
        unitEnabled: true,
        unit: form.unit.trim(),
        expirationEnabled: form.expirationEnabled,
        expirationDate: form.expirationEnabled ? form.expirationDate || null : null,
        imageUrl: form.imageUrl || '',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* 1 — Identité du produit */}
      <section className="rounded-2xl border border-gold/15 bg-vanilla/30 p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-display font-semibold text-text-primary text-sm">
          <Package size={16} className="text-gold" /> 1. Identité du produit
        </h3>
        <Input
          label="Nom du produit *"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="Ex : Rond à béton HA12, Treillis soudé, Fil recuit, Tôle 2 mm…"
          autoFocus
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Précisions utiles : nuance d'acier, diamètre, longueur, provenance…"
        />
        <div>
          <p className="text-xs font-medium text-text-secondary mb-1.5">Image du produit</p>
          <div className="flex items-center gap-3">
            <div className="relative h-24 w-24 shrink-0 rounded-xl border border-gold/20 bg-vanilla/50 overflow-hidden flex items-center justify-center">
              {form.imageUrl
                ? <img src={form.imageUrl} alt="" className="h-full w-full object-cover" />
                : <Package size={28} className="text-text-muted/50" />}
              {uploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-white" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label className="inline-flex items-center gap-2 cursor-pointer rounded-md border border-gold/30 px-3 py-1.5 text-xs font-semibold text-text-primary hover:border-gold/60 hover:text-gold transition-colors">
                <ImagePlus size={14} /> {form.imageUrl ? "Changer l'image" : 'Télécharger une image'}
                <input
                  type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
                  onChange={(e) => { void handleImage(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
              {form.imageUrl && (
                <button type="button" onClick={() => set('imageUrl', '')}
                  className="inline-flex items-center gap-1 text-xs text-rose-deep hover:underline">
                  <X size={12} /> Retirer l'image
                </button>
              )}
              <p className="text-[10px] text-text-muted">PNG, JPG ou WEBP — 5 Mo max.</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2 — Unité */}
      <section className="rounded-2xl border border-gold/25 bg-gold/5 p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-display font-semibold text-text-primary text-sm">
          <Ruler size={16} className="text-gold" /> 2. Unité du produit *
        </h3>
        <p className="text-xs text-text-muted">
          Toutes les quantités et le prix d'achat de ce produit seront exprimés dans cette unité.
          Choisissez-en une existante ou créez-la avec le bouton <span className="font-semibold">+</span>.
        </p>
        <UnitSelect value={form.unit} onChange={(v) => set('unit', v)} className="max-w-sm" />
        {errors.unit && <p className="text-xs text-rose-deep font-medium">{errors.unit}</p>}
      </section>

      {/* 3 — Quantités & prix (tout est modifiable) */}
      <section className="rounded-2xl border border-gold/15 bg-vanilla/30 p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-display font-semibold text-text-primary text-sm">
          <Boxes size={16} className="text-gold" /> 3. Quantités &amp; prix
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={`Quantité actuelle en stock${u}`}
            type="number" step="any"
            value={form.currentQuantity}
            onChange={(e) => set('currentQuantity', e.target.value)}
          />
          <Input
            label={`Seuil d'alerte${u}`}
            type="number" step="any"
            value={form.minAlertQuantity}
            onChange={(e) => set('minAlertQuantity', e.target.value)}
          />
          {initial && (
            <Input
              label={`Quantité totale entrée${u}`}
              type="number" step="any"
              value={form.principalQuantity}
              onChange={(e) => set('principalQuantity', e.target.value)}
            />
          )}
          <Input
            label={form.unit ? `Prix d'achat / ${form.unit} (DA)` : "Prix d'achat (DA)"}
            type="number" step="any"
            value={form.purchasePrice}
            onChange={(e) => set('purchasePrice', e.target.value)}
            icon={<Coins size={15} />}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/15 bg-gradient-card px-4 py-2.5">
          <span className="text-xs text-text-muted">Valeur du stock pour ce produit</span>
          <span className="text-base font-bold tabular text-gold-dark">{formatCurrency(stockValue)}</span>
        </div>
      </section>

      {/* 4 — Péremption (optionnelle) */}
      <section className="rounded-2xl border border-gold/15 bg-vanilla/30 p-4 space-y-3">
        <h3 className="flex items-center gap-2 font-display font-semibold text-text-primary text-sm">
          <CalendarClock size={16} className="text-gold" /> 4. Date de péremption (optionnel)
        </h3>
        <div className="flex flex-wrap items-center gap-4">
          <Switch
            checked={form.expirationEnabled}
            onChange={(v) => set('expirationEnabled', v)}
            label="Ce produit périme"
          />
          {form.expirationEnabled && (
            <Input
              type="date"
              value={form.expirationDate}
              onChange={(e) => set('expirationDate', e.target.value)}
              className="max-w-[200px]"
            />
          )}
        </div>
      </section>

      <div className="flex justify-end gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>Annuler</Button>
        <Button type="submit" variant="gold" disabled={saving || uploading}>
          {saving ? 'Enregistrement…' : initial ? 'Mettre à jour' : 'Créer le produit'}
        </Button>
      </div>
    </form>
  );
}
