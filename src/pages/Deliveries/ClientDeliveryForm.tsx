import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Factory, Hash, MapPin, Package, PackageCheck, Percent, PiggyBank,
  Receipt, Search, Truck, User, UserPlus, UserRound, Wallet, X,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { useClientStore } from '@/store/clientStore';
import { useCommandStore, type ClientDeliveryInput } from '@/store/commandStore';
import { useFicheTechnicStore } from '@/store/ficheTechnicStore';
import { useProductionStore } from '@/store/productionStore';
import { useStockStore } from '@/store/stockStore';
import { useSalesStore } from '@/store/salesStore';
import {
  readyByFiche, openLinesOfClient, allocateQuantity, ficheOfLine, recoveredOnLine,
  type AllocationPart,
} from '@/lib/readyStock';
import { commandAdvanceAvailable, deliveryPaymentSplit } from '@/lib/commandBilling';
import { stockRequirementsForDelivery } from '@/lib/ficheStock';
import { formatCurrency, formatNumber, DEFAULT_TVA_RATE } from '@/lib/utils';
import type { Client, CommandDelivery } from '@/types';
import { NewClientModal } from '@/components/shared/NewClientModal';

interface Props {
  open: boolean;
  /** Bon à modifier — absent : nouvelle livraison. */
  editing?: CommandDelivery | null;
  onClose: () => void;
  /** Bons créés (un par commande servie) ou bon modifié. */
  onSaved: (deliveries: CommandDelivery[]) => void;
}

interface Line {
  key: string;
  ficheId: string;
  productName: string;
  quantity: number;
  /** Prix unitaire de la partie livrée hors commande (vente directe). */
  unitPrice: number;
}

const isPassager = (c: Client) => c.name.toLowerCase().startsWith('client passager');

const r3 = (n: number) => Math.round((n || 0) * 1000) / 1000;
const q = (n: number) => formatNumber(r3(n));

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return nowLocal();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * NOUVELLE LIVRAISON — client → produit → quantité.
 *
 * Pour chaque produit choisi, l'écran rappelle ce que CE client a commandé et
 * n'a pas encore reçu, ainsi que le STOCK PRÊT du produit. La quantité livrée
 * peut dépasser le stock prêt : la différence est produite automatiquement
 * (production lancée, matières déduites du stock) puis livrée.
 *
 * Les quantités sont imputées sur les commandes du client, la plus ancienne
 * d'abord ; un bon de livraison est créé par commande servie. Le bon vaut
 * vente : facture, encaissement, dette et historique du client.
 */
export function ClientDeliveryForm({ open, editing, onClose, onSaved }: Props) {
  const clients = useClientStore((s) => s.clients);
  const commands = useCommandStore((s) => s.commands);
  const deliveries = useCommandStore((s) => s.deliveries);
  const recoveries = useCommandStore((s) => s.recoveries);
  const addClientDelivery = useCommandStore((s) => s.addClientDelivery);
  const updateClientDelivery = useCommandStore((s) => s.updateClientDelivery);
  const fiches = useFicheTechnicStore((s) => s.ficheTechnics);
  const productions = useProductionStore((s) => s.productions);
  const products = useStockStore((s) => s.products);
  const sales = useSalesStore((s) => s.sales);
  const getOrCreatePassager = useClientStore((s) => s.getOrCreatePassager);
  const [newClientOpen, setNewClientOpen] = useState(false);

  const [client, setClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [deliveredAt, setDeliveredAt] = useState(nowLocal());
  const [location, setLocation] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPlate, setDriverPlate] = useState('');
  const [notes, setNotes] = useState('');
  const [tvaEnabled, setTvaEnabled] = useState(false);
  const [tvaRate, setTvaRate] = useState(DEFAULT_TVA_RATE);
  const [tvaTouched, setTvaTouched] = useState(false);
  const [useAdvance, setUseAdvance] = useState(true);
  /** -1 = tout l'acompte libre utilisable. */
  const [creditApplied, setCreditApplied] = useState(-1);
  const [cashPaid, setCashPaid] = useState(0);
  const [saving, setSaving] = useState(false);

  const editingCommand = editing ? commands.find((c) => c.id === editing.commandId) : undefined;

  /* ---------------------------------------------------------------- reset */
  useEffect(() => {
    if (!open) return;
    setClientSearch('');
    setProductSearch('');
    setSaving(false);
    if (editing) {
      const cmd = commands.find((c) => c.id === editing.commandId);
      const cli = clients.find((c) => c.id === cmd?.clientId) ?? null;
      setClient(cli);
      const grouped = new Map<string, Line>();
      editing.items.forEach((it) => {
        const cmdItem = cmd?.items.find((x) => x.id === it.commandItemId);
        const fiche = (it.ficheTechnicId && fiches.find((f) => f.id === it.ficheTechnicId))
          || ficheOfLine({ ficheTechnicId: cmdItem?.ficheTechnicId, productName: it.productName }, fiches);
        if (!fiche) return;
        const cur = grouped.get(fiche.id);
        if (cur) cur.quantity = r3(cur.quantity + it.quantity);
        else grouped.set(fiche.id, { key: fiche.id, ficheId: fiche.id, productName: fiche.name, quantity: it.quantity, unitPrice: fiche.unitPrice });
      });
      setLines([...grouped.values()]);
      setDeliveredAt(toLocal(editing.deliveredAt));
      setLocation(editing.location ?? '');
      setDriverName(editing.driverName ?? '');
      setDriverPlate(editing.driverPlate ?? '');
      setNotes(editing.notes ?? '');
      setTvaEnabled(!!editing.tvaEnabled);
      setTvaRate(editing.tvaRate || cmd?.tvaRate || DEFAULT_TVA_RATE);
      setTvaTouched(true);
      setUseAdvance((editing.advanceApplied ?? 0) > 0.004);
      // l'argent du compte du client reste imputé, l'encaissement reste encaissé
      const split = deliveryPaymentSplit(sales.find((s) => s.id === editing.saleId));
      setCreditApplied(split.credit);
      setCashPaid(split.cash);
    } else {
      setClient(null);
      setLines([]);
      setDeliveredAt(nowLocal());
      setLocation('');
      setDriverName('');
      setDriverPlate('');
      setNotes('');
      setTvaEnabled(false);
      setTvaRate(DEFAULT_TVA_RATE);
      setTvaTouched(false);
      setUseAdvance(true);
      setCreditApplied(-1);
      setCashPaid(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  /* ------------------------------------------------------- données client */
  const clientResults = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return [];
    return clients
      .filter((c) => c.name.toLowerCase().includes(term) || (c.phone || '').replace(/\s/g, '').includes(term.replace(/\s/g, '')))
      .slice(0, 8);
  }, [clients, clientSearch]);

  /** Quantités du bon modifié : la base les remet « à livrer » avant de le refaire. */
  const editExtra = useMemo(() => {
    const m = new Map<string, number>();
    editing?.items.forEach((it) => {
      if (it.commandItemId) m.set(it.commandItemId, (m.get(it.commandItemId) ?? 0) + it.quantity);
    });
    return m;
  }, [editing]);

  const openLines = useMemo(
    // client passager : chaque livraison est une vente directe — les commandes
    // ouvertes d'autres passagers ne sont jamais servies
    () => (client && (editing || !isPassager(client))
      ? openLinesOfClient(client.id, commands, fiches, editing ? editExtra : undefined)
      : []),
    [client, commands, fiches, editing, editExtra]
  );

  const remainingByFiche = useMemo(() => {
    const m = new Map<string, number>();
    openLines.forEach((l) => { if (l.ficheId) m.set(l.ficheId, r3((m.get(l.ficheId) ?? 0) + l.left)); });
    return m;
  }, [openLines]);

  /** Stock prêt ; en modification, ce que le bon avait pris dans le stock y revient. */
  const readyMap = useMemo(() => {
    const m = readyByFiche(productions, deliveries, recoveries);
    editing?.items.forEach((it) => {
      if (it.readyApplied && it.ficheTechnicId) {
        m.set(it.ficheTechnicId, r3((m.get(it.ficheTechnicId) ?? 0) + (it.fromReady ?? 0)));
      }
    });
    return m;
  }, [productions, deliveries, recoveries, editing]);

  const clientCommandsOpen = useMemo(
    () => new Set(openLines.map((l) => l.commandId)).size,
    [openLines]
  );

  /* ------------------------------------------------------------- produits */
  const productResults = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    const list = fiches.filter((f) => !term || f.name.toLowerCase().includes(term));
    return list
      .map((f) => ({ fiche: f, remaining: remainingByFiche.get(f.id) ?? 0, ready: Math.max(0, readyMap.get(f.id) ?? 0) }))
      .sort((a, b) => b.remaining - a.remaining || a.fiche.name.localeCompare(b.fiche.name))
      .slice(0, 12);
  }, [fiches, productSearch, remainingByFiche, readyMap]);

  const addProduct = (ficheId: string) => {
    const f = fiches.find((x) => x.id === ficheId);
    if (!f) return;
    setProductSearch('');
    if (lines.some((l) => l.ficheId === ficheId)) {
      toast.info(`« ${f.name} » est déjà sur cette livraison`);
      return;
    }
    const remaining = remainingByFiche.get(ficheId) ?? 0;
    setLines((ls) => [...ls, {
      key: `${ficheId}-${Date.now()}`, ficheId, productName: f.name,
      quantity: remaining > 0.0005 ? remaining : 1, unitPrice: f.unitPrice || 0,
    }]);
  };

  const setPrice = (key: string, value: number) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, unitPrice: Math.max(0, value) } : l)));

  const setQty = (key: string, value: number) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, quantity: Math.max(0, value) } : l)));

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  /* ------------------------------------------------------------- calculs */
  const preferEdit = useMemo(
    () => (editing
      ? { items: editing.items.map((i) => i.commandItemId).filter(Boolean) as string[], commandId: editing.commandId }
      : {}),
    [editing]
  );

  /** Produit d'une ligne du bon modifié (sa fiche, sinon celle de la ligne de commande). */
  const ficheIdOfItem = (it: CommandDelivery['items'][number]) => {
    if (it.ficheTechnicId) return it.ficheTechnicId;
    const cmdItem = editingCommand?.items.find((x) => x.id === it.commandItemId);
    return ficheOfLine({ ficheTechnicId: cmdItem?.ficheTechnicId, productName: it.productName }, fiches)?.id;
  };

  const rows = useMemo(() => lines.map((l) => {
    const fiche = fiches.find((f) => f.id === l.ficheId);
    const remaining = remainingByFiche.get(l.ficheId) ?? 0;
    const ready = Math.max(0, readyMap.get(l.ficheId) ?? 0);
    // hors modification, ce qui dépasse le reste commandé est une VENTE DIRECTE :
    // une commande est créée pour cette partie, au prix saisi
    const direct = editing ? 0 : r3(Math.max(0, l.quantity - remaining));
    const alloc = allocateQuantity(openLines, l.ficheId, r3(l.quantity - direct), preferEdit);
    const value = alloc.parts.reduce((s, p) => s + p.take * p.unitPrice, 0) + direct * l.unitPrice;
    const fromReady = Math.min(l.quantity, ready);
    const toProduce = r3(Math.max(0, l.quantity - ready));
    // en modification : un produit déjà récupéré ne peut pas descendre plus bas
    const minQty = editing
      ? editing.items
          .filter((it) => it.commandItemId && ficheIdOfItem(it) === l.ficheId)
          .reduce((s, it) => s + recoveredOnLine(recoveries, editing.id, it.commandItemId), 0)
      : 0;
    const unit = fiche?.sellByUnit ? fiche.sellUnit : undefined;
    return { ...l, fiche, unit, remaining, ready, alloc, direct, value, fromReady, toProduce, minQty };
  }), [lines, fiches, remainingByFiche, readyMap, openLines, preferEdit, editing, recoveries, editingCommand]);

  /** Commandes servies, dans l'ordre où la base créera les bons. */
  const touched = useMemo(() => {
    const order: string[] = [];
    const parts = new Map<string, AllocationPart[]>();
    rows.forEach((r) => r.alloc.parts.forEach((p) => {
      if (!parts.has(p.commandId)) { parts.set(p.commandId, []); order.push(p.commandId); }
      parts.get(p.commandId)!.push(p);
    }));
    return order.map((id) => ({
      command: commands.find((c) => c.id === id),
      parts: parts.get(id)!,
    }));
  }, [rows, commands]);

  // TVA proposée : celle de la première commande servie (tant qu'on n'y a pas touché)
  const firstCommand = touched[0]?.command;
  useEffect(() => {
    if (tvaTouched || !firstCommand) return;
    setTvaEnabled(!!firstCommand.tvaEnabled);
    setTvaRate(firstCommand.tvaRate || DEFAULT_TVA_RATE);
  }, [firstCommand, tvaTouched]);

  const money = useMemo(() => {
    const rate = tvaEnabled ? tvaRate : 0;
    let ht = 0; let tva = 0; let adv = 0; let advAvailable = 0;
    touched.forEach(({ command, parts }) => {
      const htC = Math.round(parts.reduce((s, p) => s + p.take * p.unitPrice, 0) * 100) / 100;
      const tvaC = rate ? Math.round(htC * rate) / 100 : 0;
      const ttcC = htC + tvaC;
      let availC = command ? commandAdvanceAvailable(command, deliveries) : 0;
      if (editing && command?.id === editing.commandId) availC += editing.advanceApplied ?? 0;
      ht += htC; tva += tvaC; advAvailable += availC;
      if (useAdvance) adv += Math.min(availC, ttcC);
    });
    // vente directe (hors commande) : nouvelle commande, sans acompte
    const htD = Math.round(rows.reduce((s, r) => s + r.direct * r.unitPrice, 0) * 100) / 100;
    ht += htD;
    tva += rate ? Math.round(htD * rate) / 100 : 0;
    const gross = ht + tva;
    const sale = editing ? sales.find((s) => s.id === editing.saleId) : undefined;
    // en modification, ce que le compte du client payait sur ce bon lui revient d'abord
    const freed = editing ? deliveryPaymentSplit(sale).credit : 0;
    // marchandise déjà récupérée sur ce bon : la facture ne la compte plus, et
    // l'argent déjà rendu au client ne la paie plus
    const recoveredTtc = editing
      ? recoveries.filter((r) => r.deliveryId === editing.id).reduce((s, r) => s + r.totalTtc, 0)
      : 0;
    const refunded = sale?.refundedAmount ?? 0;
    const ttc = Math.max(0, gross - recoveredTtc);
    const absorbable = Math.max(0, ttc + refunded);
    const credit = Math.max(0, (client?.creditAmount ?? 0) + freed);
    const maxCredit = Math.max(0, Math.min(credit, absorbable - adv));
    const creditUsed = creditApplied < 0 ? maxCredit : Math.max(0, Math.min(creditApplied, maxCredit));
    const maxCash = Math.max(0, absorbable - adv - creditUsed);
    const cash = Math.max(0, Math.min(cashPaid, maxCash));
    const paid = Math.max(0, adv + creditUsed + cash - refunded);
    return {
      ht, tva, ttc, adv, advAvailable, credit, maxCredit, creditUsed, maxCash, cash, paid,
      rest: Math.max(0, ttc - paid),
    };
  }, [touched, rows, tvaEnabled, tvaRate, deliveries, useAdvance, editing, sales, client, creditApplied, cashPaid, recoveries]);

  /** Matières à déduire pour la partie produite automatiquement. */
  const requirements = useMemo(() => {
    const toMake = rows.filter((r) => r.toProduce > 0.0005).map((r) => ({
      ficheTechnicId: r.ficheId, productName: r.productName, quantity: r.toProduce,
    }));
    return toMake.length ? stockRequirementsForDelivery(toMake, fiches, products) : [];
  }, [rows, fiches, products]);
  const shortages = requirements.filter((r) => r.shortage);
  const totalQty = rows.reduce((s, r) => s + r.quantity, 0);
  const totalToProduce = rows.reduce((s, r) => s + r.toProduce, 0);

  /* ------------------------------------------------------------ validation */
  const handleSave = async () => {
    if (!client) { toast.error('Sélectionnez un client'); return; }
    const active = rows.filter((r) => r.quantity > 0);
    if (active.length === 0) { toast.error('Saisissez au moins une quantité à livrer'); return; }
    const noOrder = editing && active.find((r) => r.remaining <= 0.0005);
    if (noOrder) {
      toast.error(`« ${noOrder.productName} » : ce client n'a aucune commande en attente pour ce produit`);
      return;
    }
    const over = editing && active.find((r) => r.alloc.missing > 0.0005);
    if (over) {
      toast.error(`« ${over.productName} » : la quantité dépasse le reste commandé par ce client (${q(over.remaining)})`);
      return;
    }
    const under = active.find((r) => r.quantity + 0.0005 < r.minQty);
    if (under) {
      toast.error(`« ${under.productName} » : ${q(under.minQty)} ont déjà été récupérés sur ce bon — la quantité ne peut pas descendre plus bas`);
      return;
    }
    if (editing && touched.length > 1) {
      toast.error("Les quantités dépassent le reste d'une seule commande : enregistrez le surplus dans une nouvelle livraison");
      return;
    }
    const input: ClientDeliveryInput = {
      clientId: client.id,
      deliveredAt: new Date(deliveredAt).toISOString(),
      notes: notes.trim(),
      driverName: driverName.trim() || undefined,
      driverPlate: driverPlate.trim() || undefined,
      location: location.trim() || undefined,
      tvaEnabled,
      tvaRate,
      cashPaid: money.cash,
      useAdvance,
      creditUsed: money.creditUsed,
      lines: active.map((r) => ({ ficheTechnicId: r.ficheId, productName: r.productName, quantity: r3(r.quantity - r.direct) })),
      directLines: active.filter((r) => r.direct > 0.0005).map((r) => ({
        ficheTechnicId: r.ficheId, productName: r.productName, quantity: r.direct, unitPrice: r.unitPrice,
        sellByUnit: !!r.fiche?.sellByUnit, sellUnit: r.fiche?.sellByUnit ? r.fiche.sellUnit : undefined,
      })),
    };
    setSaving(true);
    try {
      if (editing) {
        const d = await updateClientDelivery(editing.id, input);
        toast.success('Livraison modifiée — facture, commande, stock prêt et caisse mis à jour');
        onSaved(d ? [d] : []);
      } else {
        const list = await addClientDelivery(input);
        toast.success(
          list.length > 1
            ? `${list.length} bons de livraison créés (un par commande servie)`
            : `Bon de livraison ${list[0]?.reference ?? ''} créé`
        );
        onSaved(list);
      }
    } catch {
      /* message déjà affiché */
    } finally {
      setSaving(false);
    }
  };

  /* -------------------------------------------------------------- rendu */
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Modifier la livraison ${editing.reference}` : 'Nouvelle livraison'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Annuler</Button>
          <Button variant="gold" onClick={handleSave} disabled={saving || !client || totalQty <= 0}>
            <Truck size={16} /> {saving ? 'Enregistrement…' : editing ? 'Enregistrer les modifications' : 'Valider la livraison'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* ---------------------------------------------------------- client */}
        <Section icon={<UserRound size={14} />} title="1. Client">
          {client ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gold/20 bg-gradient-card px-4 py-3">
              <div className="min-w-0">
                <p className="font-bold text-text-primary">{client.name}</p>
                <p className="text-xs text-text-muted">
                  {client.phone ? `📞 ${client.phone}` : 'Sans téléphone'}
                  {client.address ? ` · ${client.address}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={clientCommandsOpen > 0 ? 'warning' : 'neutral'}>
                  {clientCommandsOpen} commande(s) en attente
                </Badge>
                {(client.creditAmount ?? 0) > 0.004 && (
                  <Badge variant="success">Acompte {formatCurrency(client.creditAmount ?? 0)}</Badge>
                )}
                {!editing && (
                  <Button size="sm" variant="secondary" onClick={() => { setClient(null); setLines([]); setTvaTouched(false); }}>
                    Changer
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="relative">
              <div className="flex flex-wrap gap-2">
                <div className="min-w-[220px] flex-1">
                  <Input
                    autoFocus
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Rechercher le client par nom ou numéro de téléphone…"
                    icon={<Search size={16} />}
                  />
                </div>
                <Button variant="secondary" className="h-11" onClick={() => setNewClientOpen(true)}>
                  <UserPlus size={16} /> Nouveau client
                </Button>
                <Button
                  variant="secondary"
                  className="h-11"
                  onClick={async () => {
                    try {
                      const p = await getOrCreatePassager();
                      setClient(p); setClientSearch(''); setLines([]); setTvaTouched(false);
                    } catch { /* message déjà affiché */ }
                  }}
                >
                  <User size={16} /> Client passager
                </Button>
              </div>
              {clientResults.length > 0 && (
                <div className="mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-lg">
                  {clientResults.map((c) => {
                    const n = new Set(openLinesOfClient(c.id, commands, fiches).map((l) => l.commandId)).size;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setClient(c); setClientSearch(''); setLines([]); setTvaTouched(false); }}
                        className="flex w-full items-center justify-between gap-3 border-b border-gold/5 px-4 py-2.5 text-left text-sm last:border-0 hover:bg-gold/10"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold text-text-primary truncate">{c.name}</span>
                          <span className="block text-xs text-text-muted">{c.phone || '—'}</span>
                        </span>
                        <Badge variant={n > 0 ? 'warning' : 'neutral'}>{n} en attente</Badge>
                      </button>
                    );
                  })}
                </div>
              )}
              {clientSearch.trim() && clientResults.length === 0 && (
                <p className="mt-1 text-xs text-rose-deep">Aucun client ne correspond à « {clientSearch} ».</p>
              )}
            </div>
          )}
        </Section>

        {/* -------------------------------------------------------- produits */}
        {client && (
          <Section icon={<Package size={14} />} title="2. Produits à livrer">
            <div className="relative">
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Rechercher un produit (fiche technique)…"
                icon={<Search size={16} />}
              />
              {productSearch.trim() && (
                <div className="mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-gold/20 bg-[--surface-dropdown] shadow-lg">
                  {productResults.length === 0 && (
                    <p className="px-4 py-3 text-xs text-text-muted">Aucune fiche technique ne correspond.</p>
                  )}
                  {productResults.map(({ fiche, remaining, ready }) => {
                    const u = fiche.sellByUnit && fiche.sellUnit ? ` ${fiche.sellUnit}` : '';
                    return (
                      <button
                        key={fiche.id}
                        type="button"
                        onClick={() => addProduct(fiche.id)}
                        className="flex w-full items-center justify-between gap-3 border-b border-gold/5 px-4 py-2.5 text-left text-sm last:border-0 hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          {fiche.imageUrl
                            ? <img src={fiche.imageUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                            : <span className="h-8 w-8 shrink-0 rounded bg-zinc-900 text-white flex items-center justify-center"><Package size={14} /></span>}
                          <span className="truncate font-semibold text-text-primary">{fiche.name}</span>
                        </span>
                        <span className="shrink-0 text-right text-[11px] leading-tight">
                          {remaining > 0.0005
                            ? <span className="block font-bold text-gold-dark">Reste commandé : {q(remaining)}{u}</span>
                            : <span className="block text-text-muted">Vente directe (hors commande)</span>}
                          <span className="block text-pistachio">Stock prêt : {q(ready)}{u}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gold/20 bg-vanilla/30 px-4 py-6 text-center text-sm text-text-muted">
                Recherchez un produit ci-dessus : le reste commandé par ce client et le stock prêt s'afficheront.
              </p>
            ) : (
              <div className="space-y-3">
                {rows.map((r) => {
                  const u = r.unit ? ` ${r.unit}` : '';
                  return (
                    <div key={r.key} className={`rounded-xl border p-3 ${r.toProduce > 0 ? 'border-caramel/40 bg-caramel/5' : 'border-gold/15 bg-gradient-card'}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          {r.fiche?.imageUrl
                            ? <img src={r.fiche.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover border border-gold/20" />
                            : <span className="h-10 w-10 shrink-0 rounded-md bg-zinc-900 text-white flex items-center justify-center"><Package size={16} /></span>}
                          <div className="min-w-0">
                            <p className="font-bold text-text-primary truncate">{r.productName}</p>
                            <p className="text-[11px] text-text-muted">
                              {[
                                ...r.alloc.parts.map((p) => `${p.commandReference} : ${q(p.take)}${u} × ${formatCurrency(p.unitPrice)}`),
                                ...(r.direct > 0.0005 ? [`Vente directe : ${q(r.direct)}${u} × ${formatCurrency(r.unitPrice)}`] : []),
                              ].join(' · ') || 'Aucune commande servie'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(r.key)}
                          className="rounded-lg p-1.5 text-rose-deep hover:bg-rose-deep/10"
                          title="Retirer ce produit"
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <Info label="Reste commandé (non livré)" value={`${q(r.remaining)}${u}`} tone={r.remaining > 0 ? 'text-gold-dark' : 'text-rose-deep'} />
                        <Info label="Stock prêt actuel" value={`${q(r.ready)}${u}`} tone="text-pistachio" />
                        <div>
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-text-muted">Quantité à livrer</p>
                          <div className="flex gap-1.5">
                            <input
                              type="number" step="any" min={0}
                              value={r.quantity}
                              onChange={(e) => setQty(r.key, Number(e.target.value))}
                              className="h-9 w-full min-w-0 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm font-bold tabular text-text-primary focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
                            />
                            <button
                              type="button"
                              onClick={() => setQty(r.key, r.remaining)}
                              className="h-9 shrink-0 rounded-lg border border-gold/25 px-2 text-[11px] font-semibold text-text-muted hover:bg-gold/10 hover:text-gold-dark"
                              title="Livrer tout le reste commandé"
                            >
                              Max
                            </button>
                          </div>
                        </div>
                        <Info label="Valeur H.T" value={formatCurrency(r.value)} tone="text-gold-dark" />
                      </div>

                      {r.direct > 0.0005 && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gold/25 bg-gold/5 px-2.5 py-2 text-xs font-semibold text-gold-dark">
                          <span>
                            {q(r.direct)}{u} hors commande : une commande sera créée automatiquement pour cette quantité. Prix unitaire :
                          </span>
                          <input
                            type="number" step="any" min={0}
                            value={r.unitPrice}
                            onChange={(e) => setPrice(r.key, Number(e.target.value))}
                            className="h-8 w-32 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-right text-sm font-bold tabular text-text-primary focus:border-gold focus:outline-none"
                          />
                        </div>
                      )}
                      {r.alloc.missing > 0.0005 && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-rose-deep">
                          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                          La quantité dépasse de {q(r.alloc.missing)}{u} le reste commandé par ce client.
                        </p>
                      )}
                      {r.toProduce > 0.0005 && r.alloc.missing <= 0.0005 && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-caramel/40 bg-caramel/10 px-2.5 py-2 text-xs font-semibold text-caramel">
                          <Factory size={13} className="mt-0.5 shrink-0" />
                          La quantité dépasse le stock prêt de {q(r.toProduce)}{u} : cette différence sera produite
                          automatiquement (production lancée, matières déduites du stock) puis utilisée pour cette
                          livraison. {q(r.fromReady)}{u} sortiront du stock prêt.
                        </p>
                      )}
                      {r.minQty > 0 && (
                        <p className="mt-2 text-[11px] text-text-muted">
                          Déjà récupéré sur ce bon : {q(r.minQty)}{u} — la quantité livrée ne peut pas descendre plus bas.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {requirements.length > 0 && (
              <div className="rounded-xl border border-caramel/30 bg-vanilla/30 overflow-hidden">
                <p className="flex items-center gap-2 border-b border-caramel/20 bg-caramel/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-caramel">
                  <Factory size={14} /> Production automatique : {q(totalToProduce)} — matières déduites du stock
                </p>
                <div className="overflow-x-auto px-2 pb-2">
                  <table className="w-full text-xs">
                    <thead className="text-text-secondary">
                      <tr>
                        <th className="px-2 py-2 text-left">Matière première</th>
                        <th className="px-2 py-2 text-right">À déduire</th>
                        <th className="px-2 py-2 text-right">Stock actuel</th>
                        <th className="px-2 py-2 text-right">Stock après</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requirements.map((m) => {
                        const u = m.unit ? ` ${m.unit}` : '';
                        return (
                          <tr key={m.productId ?? m.productName} className="border-t border-gold/10">
                            <td className="px-2 py-1.5 font-medium text-text-primary">{m.productName}</td>
                            <td className="px-2 py-1.5 text-right tabular font-semibold text-rose-deep">− {q(m.quantity)}{u}</td>
                            <td className="px-2 py-1.5 text-right tabular text-text-muted">{m.available === undefined ? '—' : `${q(m.available)}${u}`}</td>
                            <td className={`px-2 py-1.5 text-right tabular font-semibold ${m.shortage ? 'text-rose-deep' : 'text-pistachio'}`}>
                              {m.available === undefined ? '—' : `${q(m.available - m.quantity)}${u}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {shortages.length > 0 && (
                  <p className="mx-3 mb-3 rounded-lg border border-rose-deep/30 bg-rose-deep/10 px-3 py-2 text-[11px] font-semibold text-rose-deep">
                    <AlertTriangle size={12} className="mr-1 inline" />
                    Stock insuffisant pour {shortages.map((x) => x.productName).join(', ')} — la production
                    ramènera ces matières sous zéro.
                  </p>
                )}
              </div>
            )}

            {!editing && touched.length > 1 && (
              <p className="flex items-start gap-2 rounded-xl border border-gold/30 bg-gold/5 px-3 py-2 text-xs font-semibold text-gold-dark">
                <Receipt size={14} className="mt-0.5 shrink-0" />
                Les quantités sont servies sur {touched.length} commandes ({touched.map((t) => t.command?.reference).join(', ')}) :
                un bon de livraison sera créé pour chacune, la plus ancienne d'abord.
              </p>
            )}
          </Section>
        )}

        {/* ------------------------------------------------- informations */}
        {client && (
          <Section icon={<Truck size={14} />} title="3. Informations de livraison (facultatives)">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Date et heure de la livraison"
                type="datetime-local"
                value={deliveredAt}
                onChange={(e) => setDeliveredAt(e.target.value)}
                icon={<CalendarClock size={15} />}
              />
              <Input
                label="Lieu de livraison"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={firstCommand?.clientAddress || client.address || 'Adresse de la commande'}
                icon={<MapPin size={15} />}
              />
              <Input
                label="Nom du chauffeur"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder={firstCommand?.driverName || 'Chauffeur de la commande'}
                icon={<User size={15} />}
              />
              <Input
                label="Matricule"
                value={driverPlate}
                onChange={(e) => setDriverPlate(e.target.value)}
                placeholder={firstCommand?.driverPlate || 'Ex : 12345-116-09'}
                icon={<Hash size={15} />}
              />
            </div>
            <Textarea
              label="Observations"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Remarques du client, état de la marchandise…"
              rows={2}
            />
          </Section>
        )}

        {/* ---------------------------------------------------- facturation */}
        {client && rows.length > 0 && (
          <Section icon={<Receipt size={14} />} title="4. Facturation de la livraison">
            <p className="-mt-1 text-[11px] italic text-text-muted">
              La livraison vaut vente : la facture apparaît dans « Ventes », la caisse, les rapports et
              l'historique du client.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-text-primary">
                <input
                  type="checkbox"
                  checked={tvaEnabled}
                  onChange={(e) => { setTvaEnabled(e.target.checked); setTvaTouched(true); }}
                  className="h-4 w-4 accent-[#B91C1C]"
                />
                <Percent size={14} className="text-gold-dark" /> Appliquer la TVA
              </label>
              {tvaEnabled && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number" step="any" min={0} max={100}
                    value={tvaRate}
                    onChange={(e) => { setTvaRate(Math.max(0, Number(e.target.value))); setTvaTouched(true); }}
                    className="h-9 w-20 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-center text-sm font-semibold tabular text-text-primary focus:border-gold focus:outline-none"
                  />
                  <span className="text-sm font-semibold text-text-secondary">% = {formatCurrency(money.tva)}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {money.advAvailable > 0.004 && (
                <div className="rounded-xl border border-pistachio/25 bg-pistachio/5 p-3">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-text-secondary">
                    <input
                      type="checkbox"
                      checked={useAdvance}
                      onChange={(e) => setUseAdvance(e.target.checked)}
                      className="h-4 w-4 accent-[#15803d]"
                    />
                    <PiggyBank size={13} className="text-pistachio" /> Imputer l'acompte des commandes
                  </label>
                  <p className="mt-1.5 text-lg font-bold tabular text-pistachio">{formatCurrency(money.adv)}</p>
                  <p className="text-[10px] text-text-muted">
                    Disponible {formatCurrency(money.advAvailable)} — déjà encaissé, n'entre pas une seconde fois en caisse.
                  </p>
                </div>
              )}
              {money.credit > 0.004 && (
                <div className="rounded-xl border border-pistachio/25 bg-pistachio/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                    <PiggyBank size={13} className="text-pistachio" /> Acompte du client à utiliser
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    <input
                      type="number" step="any" min={0} max={money.maxCredit}
                      value={Math.round(money.creditUsed * 100) / 100}
                      onChange={(e) => setCreditApplied(Math.max(0, Number(e.target.value)))}
                      className="h-9 w-full min-w-0 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-sm font-bold tabular text-text-primary focus:border-gold focus:outline-none"
                    />
                    <button type="button" onClick={() => setCreditApplied(0)} className="h-9 shrink-0 rounded-lg border border-rose-deep/25 px-2 text-[11px] font-semibold text-rose-deep hover:bg-rose-deep/10">Non</button>
                  </div>
                  <p className="mt-1 text-[10px] text-text-muted">Disponible {formatCurrency(money.credit)}</p>
                </div>
              )}
              <div className="rounded-xl border border-gold/25 bg-gold/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
                  <Wallet size={13} className="text-gold-dark" /> Montant payé maintenant
                </p>
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    type="number" step="any" min={0} max={money.maxCash}
                    value={cashPaid}
                    onChange={(e) => setCashPaid(Math.max(0, Number(e.target.value)))}
                    className="h-9 w-full min-w-0 rounded-lg border-2 border-[--border-input] bg-[--surface-input] px-2 text-sm font-bold tabular text-text-primary focus:border-gold focus:outline-none"
                  />
                  <button type="button" onClick={() => setCashPaid(Math.round(money.maxCash * 100) / 100)} className="h-9 shrink-0 rounded-lg border border-gold/25 px-2 text-[11px] font-semibold text-text-muted hover:bg-gold/10">Tout</button>
                  <button type="button" onClick={() => setCashPaid(0)} className="h-9 shrink-0 rounded-lg border border-rose-deep/25 px-2 text-[11px] font-semibold text-rose-deep hover:bg-rose-deep/10">À crédit</button>
                </div>
                <p className="mt-1 text-[10px] text-text-muted">Entre en caisse à la date de la livraison.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Money label="Total H.T" value={formatCurrency(money.ht)} />
              <Money label={tvaEnabled ? `TVA ${tvaRate} %` : 'TVA'} value={formatCurrency(money.tva)} />
              <Money label="Net à payer" value={formatCurrency(money.ttc)} tone="text-gold-dark" />
              <Money label="Versement" value={formatCurrency(money.paid)} tone="text-pistachio" />
              <Money label="Reste (dette)" value={formatCurrency(money.rest)} tone={money.rest > 0.004 ? 'text-rose-deep' : 'text-pistachio'} />
            </div>
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
              money.rest > 0.004 ? 'border-rose-deep/40 bg-rose-deep/10 text-rose-deep' : 'border-pistachio/40 bg-pistachio/10 text-pistachio'
            }`}>
              {money.rest > 0.004 ? <AlertTriangle size={15} /> : <PackageCheck size={15} />}
              {money.rest > 0.004
                ? `${formatCurrency(money.rest)} resteront dus et seront ajoutés à la dette de ${client.name}.`
                : 'Livraison intégralement réglée : aucune dette ne sera créée.'}
            </div>
          </Section>
        )}

        {editingCommand && (
          <p className="text-[11px] text-text-muted">
            Bon rattaché à la commande {editingCommand.reference}. Enregistrer refait la facture, les quantités
            livrées de la commande, le stock prêt, la production automatique et la caisse.
          </p>
        )}
      </div>
      <NewClientModal
        open={newClientOpen}
        onClose={() => setNewClientOpen(false)}
        onCreated={(c) => { setClient(c); setClientSearch(''); setLines([]); setTvaTouched(false); }}
      />
    </Modal>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gold/15 bg-vanilla/20 p-4">
      <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-dark">{icon} {title}</h4>
      {children}
    </section>
  );
}

function Info({ label, value, tone = 'text-text-primary' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-gold/10 bg-vanilla/40 px-2.5 py-1.5">
      <p className="text-[10px] font-bold uppercase leading-tight tracking-wide text-text-muted">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${tone}`}>{value}</p>
    </div>
  );
}

function Money({ label, value, tone = 'text-text-primary' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-gold/15 bg-vanilla/40 px-3 py-2 text-center">
      <p className="text-[10px] uppercase tracking-wide text-text-muted leading-tight">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular ${tone}`}>{value}</p>
    </div>
  );
}
