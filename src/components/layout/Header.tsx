import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Languages, Sun, Moon, Globe } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { useThemeStore } from '@/store/themeStore';

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const user = useAuthStore((s) => s.user);
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useThemeStore();

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const today = new Date().toLocaleDateString(language === 'ar' ? 'ar-DZ' : 'fr-FR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });

  return (
    <header className="sticky top-0 z-20 h-16 bg-chocolate/85 backdrop-blur-md border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between px-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          aria-label="Ouvrir le menu"
          className="lg:hidden h-10 w-10 inline-flex items-center justify-center rounded-md text-text-secondary hover:bg-gold/10 hover:text-gold"
        >
          <Menu size={20} />
        </button>
        <p className="hidden md:block text-xs font-semibold uppercase tracking-[0.14em] text-text-muted capitalize">
          {today}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* Site web public — nouvel onglet */}
        <a
          href="/site" target="_blank" rel="noreferrer" title="Ouvrir le site web"
          className="h-10 px-3 inline-flex items-center gap-2 rounded-md border border-[--border-input] bg-chocolate text-sm font-semibold text-text-secondary hover:border-gold/60 hover:text-gold transition-colors"
        >
          <Globe size={16} /> <span className="hidden sm:inline">Site web</span>
        </a>
        {/* Theme toggle — icon swaps with a rotate/fade */}
        <button
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
          className="relative h-10 w-10 inline-flex items-center justify-center rounded-md border border-[--border-input] bg-chocolate text-text-secondary hover:border-gold/60 hover:text-gold transition-colors overflow-hidden"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ y: 14, opacity: 0, rotate: -60 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ y: -14, opacity: 0, rotate: 60 }}
              transition={{ type: 'spring', stiffness: 420, damping: 26 }}
              className="inline-flex"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </motion.span>
          </AnimatePresence>
        </button>

        <button
          onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')}
          aria-label="Changer de langue"
          className="h-10 inline-flex items-center gap-1.5 px-3 rounded-md border border-[--border-input] bg-chocolate text-sm font-semibold text-text-secondary hover:border-gold/60 hover:text-gold transition-colors"
        >
          <Languages size={16} />
          {language === 'fr' ? 'FR' : 'AR'}
        </button>

        <div className="mx-1 h-8 w-px bg-black/10 dark:bg-white/10" />

        <div className="flex items-center gap-2.5">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-semibold text-text-primary leading-tight">{user?.name}</p>
            <p className="text-[11px] text-text-muted">{user?.role === 'admin' ? 'Administrateur' : 'Employé'}</p>
          </div>
          <div className="h-9 w-9 rounded-md bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 flex items-center justify-center text-white text-sm font-bold ring-2 ring-red-600/80 ring-offset-2 ring-offset-chocolate">
            {initials || 'U'}
          </div>
        </div>
      </div>
    </header>
  );
}
