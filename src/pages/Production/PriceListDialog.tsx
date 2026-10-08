import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Package, Printer, Square, Tags } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { SearchBar } from '@/components/ui/SearchBar';
import { toast } from '@/components/ui/Toast';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useSettingsStore } from '@/store/settingsStore';
import { printPriceList } from '@/lib/documents';
import { formatCurrency, DEFAULT_TVA_RATE } from '@/lib/utils';

/**
 * LISTE DES PRIX — tous les produits des fiches techniques sont cochés ;
 * l'opérateur décoche ceux qu'il ne veut pas imprimer puis lance l'impression
 * sur le papier à en-tête de l'entreprise (photo, description, prix).
 */
export function PriceListDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fiches = useFicheTechnicStore((s) => s.ficheTechnics);
  const settings = useSettingsStore((s) => s.settings);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('LISTE DES PRIX');
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [showImages, setShowImages] = useState(true);
  const [showTtc, setShowTtc] = useState(false);
  const [tvaRate, setTvaRate] = useState(DEFAULT_TVA_RATE);
  const [note, setNote] = useState('');

  // à chaque ouverture : tous les produits cochés
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(fiches.map((f) => f.id)));
    setSearch('');
    // les fiches rechargées en arrière-plan ne doivent pas annuler les décochages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...fiches]
      .filter((f) => !term || f.name.toLowerCase().includes(term) || (f.categoryName || '').toLowerCase().includes(term))
      .sort((a, b) => (a.categoryName || '').localeCompare(b.categoryName || '') || a.name.localeCompare(b.name));
  }, [fiches, search]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const handlePrint = () => {
    const items = fiches
      .filter((f) => selected.has(f.id))
      .map((f) => ({
        name: f.name,
        description: f.description,
        category: f.categoryName,
        unit: f.sellByUnit ? f.sellUnit : 'Unité',
        price: f.unitPrice,
        imageUrl: f.imageUrl,
      }));
    if (items.length === 0) { toast.error('Cochez au moins un produit'); return; }
    printPriceList(items, settings, {
      title, groupByCategory, showImages, showTtc, tvaRate, note,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Imprimer la liste des prix"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
          <Button variant="gold" onClick={handlePrint} disabled={selected.size === 0}>
            <Printer size={16} /> Imprimer ({selected.size} produit{selected.size > 1 ? 's' : ''})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[200px] flex-1">
            <SearchBar value={search} onChange={setSearch} placeholder="Filtrer les produits…" />
          </div>
          <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(fiches.map((f) => f.id)))}>
            <CheckSquare size={14} /> Tout cocher
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
            <Square size={14} /> Tout décocher
          </Button>
        </div>

        <div className="max-h-[340px] overflow-y-auto rounded-xl border border-gold/15">
          {visible.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">Aucune fiche technique.</p>
          )}
          {visible.map((f) => {
            const on = selected.has(f.id);
            return (
              <label
                key={f.id}
                className={`flex cursor-pointer items-center gap-3 border-b border-gold/10 px-3 py-2 last:border-0 transition-colors ${on ? 'bg-gold/5' : 'opacity-60 hover:opacity-100'}`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(f.id)} className="h-4 w-4 shrink-0 accent-[#B91C1C]" />
                {f.imageUrl
                  ? <img src={f.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover border border-gold/20" />
                  : <span className="h-10 w-10 shrink-0 rounded-md bg-zinc-900 text-white flex items-center justify-center"><Package size={16} /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text-primary">{f.name}</span>
                  <span className="block truncate text-[11px] text-text-muted">
                    {f.categoryName || 'Sans catégorie'}{f.description ? ` · ${f.description}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-bold tabular text-gold-dark">
                  {formatCurrency(f.unitPrice)}{f.sellByUnit && f.sellUnit ? ` / ${f.sellUnit}` : ''}
                </span>
              </label>
            );
          })}
        </div>

        <div className="space-y-3 rounded-2xl border border-gold/15 bg-vanilla/20 p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-dark">
            <Tags size={14} /> Présentation
          </p>
          <Input label="Titre du document" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Check label="Regrouper par catégorie" checked={groupByCategory} onChange={setGroupByCategory} />
            <Check label="Afficher les photos" checked={showImages} onChange={setShowImages} />
            <Check label="Ajouter le prix T.T.C" checked={showTtc} onChange={setShowTtc} />
            {showTtc && (
              <span className="flex items-center gap-1.5">
                <input
                  type="number" step="any" min={0} max={100}
                  value={tvaRate}
                  onChange={(e) => setTvaRate(Math.max(0, Number(e.target.value)))}
                  className="h-8 w-16 rounded-md border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm font-semibold"
                />
                <span className="text-xs font-semibold text-text-secondary">% TVA</span>
              </span>
            )}
          </div>
          <Textarea
            label="Mention imprimée (facultatif)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ex : prix valables jusqu'au 31/12, livraison incluse à partir de…"
            rows={2}
          />
        </div>
      </div>
    </Modal>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 font-semibold text-text-primary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#B91C1C]" />
      {label}
    </label>
  );
}
