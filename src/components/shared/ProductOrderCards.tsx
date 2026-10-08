import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Boxes, CheckCircle2, ClipboardList, Factory, PackageCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cardVariants } from '@/lib/animations';
import { formatNumber } from '@/lib/utils';
import type { FicheOrderStats } from '@/lib/readyStock';

/** Quantité lisible : 1 250 · 74,5. */
const q = (n: number) => formatNumber(Math.round(n * 1000) / 1000);

/**
 * SUIVI DES COMMANDES PAR PRODUIT — une carte par fiche technique.
 *
 * Le grand chiffre est le RESTE À LIVRER : il baisse à chaque livraison. La
 * carte rappelle le total commandé, ce qui est déjà livré, le STOCK PRÊT
 * (produit fini pas encore livré) et ce qu'il faudra encore produire.
 */
export function ProductOrderCards({ stats, onDeliver }: { stats: FicheOrderStats[]; onDeliver: () => void }) {
  const [showAll, setShowAll] = useState(false);

  const active = useMemo(
    () => stats.filter((s) => s.ordered > 0 || s.ready > 0),
    [stats]
  );
  const list = useMemo(() => {
    const base = showAll || active.length === 0 ? stats : active;
    return [...base].sort(
      (a, b) => b.remaining - a.remaining || b.ready - a.ready || a.fiche.name.localeCompare(b.fiche.name)
    );
  }, [stats, active, showAll]);

  const totals = useMemo(() => ({
    remaining: active.reduce((s, x) => s + x.remaining, 0),
    ready: active.reduce((s, x) => s + x.ready, 0),
    toProduce: active.reduce((s, x) => s + x.toProduce, 0),
  }), [active]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-display font-semibold text-text-primary flex items-center gap-2">
            <ClipboardList size={18} className="text-gold" /> Commandes par produit
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            Le reste à livrer baisse à chaque bon de livraison — le stock prêt est le produit fini pas encore livré.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SummaryChip icon={<Truck size={13} />} label="Reste à livrer" value={q(totals.remaining)} tone="text-gold-dark" />
          <SummaryChip icon={<PackageCheck size={13} />} label="Stock prêt" value={q(totals.ready)} tone="text-pistachio" />
          <SummaryChip icon={<Factory size={13} />} label="À produire" value={q(totals.toProduce)} tone="text-caramel" />
          {active.length > 0 && active.length < stats.length && (
            <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Produits commandés' : `Tous les produits (${stats.length})`}
            </Button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gold/25 bg-vanilla/30 px-4 py-8 text-center text-sm text-text-muted">
          Aucune fiche technique : créez vos produits dans Production › Fiches techniques.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {list.map((s, i) => (
            <ProductCard key={s.fiche.id} s={s} index={i} onDeliver={onDeliver} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProductCard({ s, index, onDeliver }: { s: FicheOrderStats; index: number; onDeliver: () => void }) {
  const u = s.unit ? ` ${s.unit}` : '';
  const done = s.ordered > 0 && s.remaining <= 0.0005;
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover="hover"
      className="relative overflow-hidden rounded-xl bg-gradient-card border border-black/[0.06] dark:border-white/[0.06] shadow-card flex flex-col"
    >
      <div className={`absolute left-0 top-0 h-full w-[3px] ${done ? 'bg-green-600' : s.remaining > 0 ? 'bg-red-600' : 'bg-zinc-400'}`} />

      {/* En-tête : photo, nom, catégorie */}
      <div className="flex items-center gap-3 px-4 pt-4">
        {s.fiche.imageUrl ? (
          <img src={s.fiche.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover border border-gold/20" />
        ) : (
          <div className="h-11 w-11 shrink-0 rounded-md bg-zinc-950 text-white flex items-center justify-center">
            <Boxes size={20} />
          </div>
        )}
        <div className="min-w-0">
          <p className="font-bold text-text-primary truncate" title={s.fiche.name}>{s.fiche.name}</p>
          <p className="text-[11px] text-text-muted truncate">
            {s.fiche.categoryName || 'Sans catégorie'}{s.unit ? ` · vendu en ${s.unit}` : ''}
          </p>
        </div>
      </div>

      {/* Reste à livrer — baisse à chaque livraison */}
      <div className="px-4 pt-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Reste à livrer</p>
            <p className={`text-3xl font-extrabold tabular leading-tight ${done ? 'text-pistachio' : 'text-text-primary'}`}>
              {q(s.remaining)}<span className="text-sm font-semibold text-text-muted">{u}</span>
            </p>
          </div>
          <span className={`mb-1 rounded px-1.5 py-0.5 text-[11px] font-bold tabular ${done ? 'bg-pistachio/15 text-pistachio' : 'bg-gold/10 text-gold-dark'}`}>
            {s.percent.toFixed(0)} % livré
          </span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-vanilla overflow-hidden border border-gold/10">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${s.percent}%` }}
            transition={{ duration: 0.7, delay: Math.min(index, 10) * 0.04 }}
            className={`h-full rounded-full ${done ? 'bg-gradient-mint' : 'bg-gradient-button'}`}
          />
        </div>
      </div>

      {/* Commandé · livré · prêt · à produire */}
      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <Mini label="Total commandé" value={`${q(s.ordered)}${u}`} />
        <Mini label="Total livré" value={`${q(s.delivered)}${u}`} tone="text-pistachio" />
        <Mini label="Stock prêt (non livré)" value={`${q(s.ready)}${u}`} tone="text-gold-dark" />
        <Mini label="À produire" value={`${q(s.toProduce)}${u}`} tone={s.toProduce > 0 ? 'text-caramel' : 'text-text-muted'} />
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-gold/10 px-4 py-2.5">
        <p className="text-[11px] text-text-muted">
          {done ? (
            <span className="inline-flex items-center gap-1 font-semibold text-pistachio">
              <CheckCircle2 size={12} /> Toutes les commandes sont livrées
            </span>
          ) : s.openCommands > 0 ? (
            `${s.openClients} client(s) · ${s.openCommands} commande(s) en attente`
          ) : (
            'Aucune commande en cours'
          )}
        </p>
        {s.remaining > 0 && (
          <Button size="sm" variant="ghost" onClick={onDeliver}>
            Livrer <ArrowRight size={13} />
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function Mini({ label, value, tone = 'text-text-primary' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-gold/10 bg-vanilla/40 px-2.5 py-2">
      <p className="text-[10px] leading-tight text-text-muted">{label}</p>
      <p className={`text-sm font-bold tabular mt-0.5 ${tone}`}>{value}</p>
    </div>
  );
}

function SummaryChip({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-gold/20 bg-gradient-card px-2.5 py-1.5 text-xs">
      <span className={tone}>{icon}</span>
      <span className="text-text-muted">{label}</span>
      <span className={`font-bold tabular ${tone}`}>{value}</span>
    </span>
  );
}
