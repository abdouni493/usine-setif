import { useMemo, useState } from 'react';
import { Eye, Pencil, Trash2, History } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchBar } from '@/components/ui/SearchBar';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/Toast';
import { useFicheTechnicStore, type FicheTechnic } from '@/store/ficheTechnicStore';
import { useProductionStore } from '@/store/productionStore';
import { useCommandStore } from '@/store/commandStore';
import { usePermissions } from '@/hooks/usePermissions';
import { readyByFiche } from '@/lib/readyStock';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { FicheTechnicDetails, FicheTechnicForm } from '@/pages/Production';
import { FicheHistory } from './FicheHistory';

/**
 * « Gestion de stock » › Produits de production : les produits fabriqués à
 * partir des fiches techniques, avec leur stock prêt, les mêmes actions que
 * l'écran Production (voir, modifier, supprimer) et leur historique.
 */
export function ProductionProducts() {
  const { can } = usePermissions();
  const { ficheTechnics, deleteFicheTechnic } = useFicheTechnicStore();
  const productions = useProductionStore((s) => s.productions);
  const deliveries = useCommandStore((s) => s.deliveries);
  const recoveries = useCommandStore((s) => s.recoveries);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [viewing, setViewing] = useState<FicheTechnic | null>(null);
  const [editing, setEditing] = useState<FicheTechnic | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [historyOf, setHistoryOf] = useState<FicheTechnic | null>(null);

  const ready = useMemo(() => readyByFiche(productions, deliveries, recoveries), [productions, deliveries, recoveries]);
  const producedOf = useMemo(() => {
    const m = new Map<string, number>();
    productions.forEach((p) => { if (p.ficheTechnicId) m.set(p.ficheTechnicId, (m.get(p.ficheTechnicId) ?? 0) + p.outputQuantity); });
    return m;
  }, [productions]);

  const categories = useMemo(() => [...new Set(ficheTechnics.map((f) => f.categoryName).filter(Boolean))], [ficheTechnics]);
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ficheTechnics
      .filter((f) => (!category || f.categoryName === category) && (!q || f.name.toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ficheTechnics, search, category]);

  const totalReady = list.reduce((s, f) => s + Math.max(0, ready.get(f.id) ?? 0) * f.costPerUnit, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un produit de production…" />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Toutes les catégories"
          options={categories.map((c) => ({ value: c, label: c }))} className="max-w-[220px]" />
        <span className="text-xs font-semibold text-text-muted">
          {list.length} produit(s) · stock prêt valorisé {formatCurrency(totalReady)}
        </span>
      </div>

      {list.length === 0 ? <EmptyState message="Aucune fiche technique enregistrée" /> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((ft, i) => {
            const u = ft.sellByUnit && ft.sellUnit ? ` ${ft.sellUnit}` : '';
            const r = Math.max(0, ready.get(ft.id) ?? 0);
            return (
              <Card key={ft.id} index={i} hoverable className="flex flex-col border border-gold/10 hover:border-gold/30">
                {ft.imageUrl && (
                  <img src={ft.imageUrl} alt={ft.name} className="-mx-5 -mt-5 mb-3 h-32 w-[calc(100%+2.5rem)] max-w-none rounded-t-xl border-b border-gold/10 object-cover" />
                )}
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="font-display text-base font-semibold text-text-primary">{ft.name}</h3>
                  {ft.categoryName && <Badge variant="warning" className="border-0 bg-caramel/10 text-caramel">{ft.categoryName}</Badge>}
                </div>
                {ft.description && <p className="mb-2 line-clamp-2 text-xs text-text-muted">{ft.description}</p>}
                <div className="mb-3 space-y-1.5 rounded-xl bg-vanilla/40 p-3 text-xs">
                  <Line label="Stock prêt (non livré)" value={`${formatNumber(r)}${u}`} accent={r > 0 ? 'text-pistachio font-bold' : 'text-rose-deep font-bold'} />
                  <Line label="Total produit" value={`${formatNumber(producedOf.get(ft.id) ?? 0)}${u}`} />
                  <Line label="Prix de vente" value={formatCurrency(ft.unitPrice)} accent="text-gold-dark font-semibold" />
                  <Line label="Coût par unité" value={formatCurrency(ft.costPerUnit)} accent="text-rose-deep font-semibold" />
                  <Line label="Gain par unité" value={formatCurrency(ft.gainsPerUnit)} accent="text-pistachio font-semibold" />
                  <Line label="Ingrédients" value={String(ft.usedProducts.length)} />
                </div>
                <div className="mt-auto flex gap-2 border-t border-gold/5 pt-2">
                  <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={() => setViewing(ft)}><Eye size={13} /> Voir</Button>
                  <Button size="sm" variant="secondary" className="flex-1 text-xs" onClick={() => setHistoryOf(ft)}><History size={13} /> Historique</Button>
                  {can('production', 'edit') && (
                    <Button size="sm" variant="secondary" className="px-2.5" onClick={() => setEditing(ft)} title="Modifier"><Pencil size={13} /></Button>
                  )}
                  {can('production', 'delete') && (
                    <Button size="sm" variant="ghost" className="px-2.5 hover:bg-rose-deep/5" onClick={() => setDeleteId(ft.id)} title="Supprimer"><Trash2 size={13} className="text-rose-deep" /></Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name} size="md">
        {viewing && <FicheTechnicDetails fiche={viewing} />}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Modifier Fiche Technique" size="lg">
        {editing && <FicheTechnicForm initial={editing} onClose={() => setEditing(null)} />}
      </Modal>
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) void deleteFicheTechnic(deleteId).then(() => toast.success('Fiche technique supprimée')); }} />
      <FicheHistory fiche={historyOf} onClose={() => setHistoryOf(null)} />
    </div>
  );
}

function Line({ label, value, accent = 'text-text-primary' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <span className={`tabular ${accent}`}>{value}</span>
    </div>
  );
}

