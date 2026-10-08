import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { LogOut, PanelLeftClose, ShieldCheck, UserRound } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { usePermissions } from '@/hooks/usePermissions';
import { useSettingsStore } from '@/store/settingsStore';
import { LogoBadge } from '@/components/shared/LogoBadge';
import { sidebarItemVariants } from '@/lib/animations';
import { navItems, navGroups } from './navItems';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Carbon-black navigation rail (identical in light & dark mode).
 * The active route is marked by a red bar that glides between items through a
 * shared `layoutId`, so moving between screens reads as one continuous motion.
 */
export function Sidebar({ open, onClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const { t, isRTL } = useLanguage();
  const { canView, isAdmin } = usePermissions();
  const store = useSettingsStore((s) => s.settings);
  const reduce = useReducedMotion();

  // Only the interfaces the administrator granted are displayed.
  const visibleItems = navItems.filter((item) => canView(item.module));

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  let index = 0;

  return (
    <>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        style={{ background: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}
        className={`fixed lg:sticky top-0 z-40 h-screen w-[264px] flex flex-col shrink-0 transition-transform duration-300 ease-out ${
          isRTL ? 'right-0 border-l' : 'left-0 border-r'
        } ${open ? 'translate-x-0' : isRTL ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* top red rule */}
        <div className="h-[3px] w-full bg-gradient-to-r from-red-700 via-red-500 to-red-700" />

        {/* Brand */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
          <div className="flex items-center gap-3 min-w-0">
            <LogoBadge size={42} icon={22} />
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold leading-tight truncate" style={{ color: 'var(--sidebar-text-strong)' }}>
                {store.name || 'Papeterie Production'}
              </h2>
              <p className="text-[10.5px] uppercase tracking-[0.14em] truncate text-red-500 font-semibold">
                {store.description || 'Production de papier'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer le menu"
            className="lg:hidden h-9 w-9 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/5"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-3">
          {navGroups.map((group) => {
            const items = visibleItems.filter((i) => i.group === group.id);
            if (items.length === 0) return null;
            return (
              <div key={group.id} className="mt-3 first:mt-0">
                <p className="px-3 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon;
                    const i = index++;
                    const active = location.pathname === item.to || location.pathname.startsWith(item.to + '/');
                    return (
                      <motion.div key={item.to} custom={i} variants={sidebarItemVariants} initial="hidden" animate="visible">
                        <NavLink
                          to={item.to}
                          onClick={onClose}
                          className={`group relative flex items-center gap-3 px-3 h-10 rounded-md text-[13.5px] font-medium transition-colors ${
                            active ? 'text-white bg-white/[0.06]' : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="sidebar-active"
                              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }}
                              className={`absolute top-1.5 bottom-1.5 w-[3px] rounded-full bg-red-600 shadow-[0_0_12px_rgba(220,38,38,0.8)] ${
                                isRTL ? 'right-0' : 'left-0'
                              }`}
                            />
                          )}
                          <Icon
                            size={18}
                            strokeWidth={1.85}
                            className={`shrink-0 transition-colors ${active ? 'text-red-500' : 'text-zinc-500 group-hover:text-zinc-200'}`}
                          />
                          <span className="truncate">{t(item.key)}</span>
                        </NavLink>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {visibleItems.length === 0 && (
            <p className="px-3 py-4 text-xs text-zinc-500">Aucune interface autorisée pour ce compte.</p>
          )}
        </nav>

        {/* Account + logout */}
        <div className="p-3 space-y-2 border-t" style={{ borderColor: 'var(--sidebar-border)' }}>
          {user && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
              <span className="h-8 w-8 shrink-0 rounded-md bg-red-600 text-white inline-flex items-center justify-center">
                {isAdmin ? <ShieldCheck size={16} /> : <UserRound size={16} />}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{user.name}</p>
                <p className="text-[10px] text-zinc-500 truncate">
                  {isAdmin ? 'Administrateur' : `Employé · ${visibleItems.length} interface(s)`}
                </p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 h-10 rounded-md text-[13.5px] font-medium text-zinc-400 hover:bg-red-600/15 hover:text-red-400 transition-colors"
          >
            <LogOut size={18} strokeWidth={1.85} />
            {t('logout')}
          </button>
        </div>
      </aside>
    </>
  );
}
