import {
  Gauge, PackageSearch, Cog, ShoppingBasket, ReceiptText, ScanBarcode,
  Contact, ClipboardCheck, Container, UsersRound, HandCoins, Vault,
  ChartNoAxesCombined, SlidersHorizontal, Truck, FileText, Globe, ShoppingCart,
} from 'lucide-react';
import type { PermissionModule } from '@/types';
import type { TranslationKey } from '@/lib/i18n';

export interface NavItem {
  to: string;
  key: TranslationKey;
  module: PermissionModule;
  icon: typeof Gauge;
  /** Sidebar group heading the item belongs to. */
  group: 'pilotage' | 'production' | 'commercial' | 'gestion';
}

/**
 * The application menu — shared by the sidebar and by the router so a worker
 * always lands on a screen he is allowed to open.
 * « Dettes Clients » is gone: it now lives inside the Clients interface.
 */
export const navItems: NavItem[] = [
  { to: '/dashboard', key: 'dashboard', module: 'dashboard', icon: Gauge, group: 'pilotage' },
  { to: '/stock', key: 'stock', module: 'stock', icon: PackageSearch, group: 'production' },
  { to: '/production', key: 'production', module: 'production', icon: Cog, group: 'production' },
  { to: '/purchase', key: 'purchase', module: 'purchase', icon: ShoppingBasket, group: 'production' },
  { to: '/sales', key: 'sales', module: 'sales', icon: ReceiptText, group: 'commercial' },
  { to: '/pos', key: 'pos', module: 'pos', icon: ScanBarcode, group: 'commercial' },
  { to: '/clients', key: 'clients', module: 'clients', icon: Contact, group: 'commercial' },
  { to: '/commands', key: 'commands', module: 'clients', icon: ClipboardCheck, group: 'commercial' },
  { to: '/livraisons', key: 'deliveries', module: 'clients', icon: Truck, group: 'commercial' },
  { to: '/factures-non-comptabilisees', key: 'freeInvoices', module: 'sales', icon: FileText, group: 'commercial' },
  { to: '/site-web', key: 'website', module: 'website', icon: Globe, group: 'commercial' },
  { to: '/commandes-site', key: 'websiteCommands', module: 'website', icon: ShoppingCart, group: 'commercial' },
  { to: '/suppliers', key: 'suppliers', module: 'suppliers', icon: Container, group: 'production' },
  { to: '/workers', key: 'workers', module: 'workers', icon: UsersRound, group: 'gestion' },
  { to: '/expenses', key: 'expenses', module: 'expenses', icon: HandCoins, group: 'gestion' },
  { to: '/caisse', key: 'caisse', module: 'caisse', icon: Vault, group: 'gestion' },
  { to: '/reports', key: 'reports', module: 'reports', icon: ChartNoAxesCombined, group: 'pilotage' },
  { to: '/settings', key: 'settings', module: 'settings', icon: SlidersHorizontal, group: 'gestion' },
];

export const navGroups: { id: NavItem['group']; label: string }[] = [
  { id: 'pilotage', label: 'Pilotage' },
  { id: 'production', label: 'Production & Achats' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'gestion', label: 'Gestion' },
];
