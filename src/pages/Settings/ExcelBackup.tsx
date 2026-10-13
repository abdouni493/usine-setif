import { useMemo, useState } from 'react';
import { FileSpreadsheet, Download, CheckSquare, Square, Clock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/Toast';
import {
  BACKUP_PARTS, downloadExcelBackup, loadBackupSelection, saveBackupSelection,
  isAutoBackupOn, setAutoBackup, lastAutoBackup,
} from '@/lib/excelBackup';
import { formatDate } from '@/lib/utils';

/** Sauvegarde Excel : choix des parties (toutes cochées par défaut) + sauvegarde quotidienne. */
export function ExcelBackup() {
  const [selected, setSelected] = useState<string[]>(loadBackupSelection);
  const [auto, setAuto] = useState(isAutoBackupOn);
  const [busy, setBusy] = useState('');

  const groups = useMemo(() => {
    const m = new Map<string, typeof BACKUP_PARTS>();
    BACKUP_PARTS.forEach((p) => m.set(p.group, [...(m.get(p.group) ?? []), p]));
    return [...m];
  }, []);

  const update = (ids: string[]) => { setSelected(ids); saveBackupSelection(ids); };
  const toggle = (id: string) => update(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleGroup = (ids: string[]) => {
    const all = ids.every((id) => selected.includes(id));
    update(all ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])]);
  };
  const allOn = selected.length === BACKUP_PARTS.length;

  const run = async () => {
    if (!selected.length) { toast.error('Choisissez au moins une partie à sauvegarder'); return; }
    setBusy('…');
    try {
      const r = await downloadExcelBackup(selected, (label) => setBusy(label));
      toast.success(`Sauvegarde Excel téléchargée — ${r.sheets} feuilles, ${r.rows} lignes`);
      if (r.failed.length) toast.error(`Non sauvegardé : ${r.failed.join(', ')}`);
    } catch (e) {
      toast.error(`Sauvegarde impossible : ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const last = lastAutoBackup();

  return (
    <Card index={2} className="md:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-pistachio">
          <FileSpreadsheet size={20} />
          <h3 className="font-display font-semibold text-text-primary">Sauvegarde Excel</h3>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => update(allOn ? [] : BACKUP_PARTS.map((p) => p.id))}>
            {allOn ? <Square size={14} /> : <CheckSquare size={14} />} {allOn ? 'Tout décocher' : 'Tout cocher'}
          </Button>
          <Button variant="gold" onClick={run} disabled={!!busy}>
            <Download size={16} /> {busy ? `Sauvegarde… ${busy}` : `Télécharger (.xlsx) — ${selected.length} parties`}
          </Button>
        </div>
      </div>
      <p className="mb-4 text-sm text-text-muted">
        Choisissez les parties de l'application à exporter. Chaque partie devient une feuille du classeur
        (avec ses lignes de détail dans des feuilles séparées). Toutes les parties sont cochées par défaut.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map(([group, parts]) => {
          const ids = parts.map((p) => p.id);
          const count = ids.filter((id) => selected.includes(id)).length;
          return (
            <div key={group} className="rounded-xl border border-gold/20 bg-vanilla/40 p-3">
              <button
                type="button"
                onClick={() => toggleGroup(ids)}
                className="mb-2 flex w-full items-center justify-between text-xs font-bold uppercase tracking-wider text-gold-dark"
              >
                <span>{group}</span>
                <span className="text-text-muted">{count}/{ids.length}</span>
              </button>
              <div className="space-y-1.5">
                {parts.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[rgb(var(--c-gold))]"
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-pistachio/30 bg-pistachio/8 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-sm text-text-primary">
          <Clock size={16} className="text-pistachio" />
          <span>
            Sauvegarde automatique chaque jour (à la première connexion de l'administrateur)
            {last && <span className="text-text-muted"> — dernière : {formatDate(last)}</span>}
          </span>
        </div>
        <Switch checked={auto} onChange={(v: boolean) => { setAuto(v); setAutoBackup(v); }} />
      </div>
    </Card>
  );
}
