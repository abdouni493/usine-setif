import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock, User, Eye, EyeOff, UserPlus, Sun, Moon, LogIn, Layers, ScrollText, ShieldCheck, Globe } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLanguage } from '@/hooks/useLanguage';
import { useThemeStore } from '@/store/themeStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useSettingsStore } from '@/store/settingsStore';
import { LogoBadge } from '@/components/shared/LogoBadge';
import { hydrateFromSupabase } from '@/lib/sync';

export default function Login() {
  const navigate = useNavigate();
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useThemeStore();
  const login = useAuthStore((s) => s.login);
  const createAccount = useAuthStore((s) => s.createAccount);
  const adminExists = useAuthStore((s) => s.adminExists);
  const store = useSettingsStore((s) => s.settings);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);

  // Admin Account Creation state
  const [isRegistering, setIsRegistering] = useState(false);
  const [regName, setRegName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [creating, setCreating] = useState(false);
  /** null while unknown — the button only appears once we know there is no admin */
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);

  // The factory is created empty: the first administrator is registered from
  // here. As soon as one exists (public.admin_account_exists()) the button
  // disappears — workers are then created by the administrator from /workers.
  useEffect(() => {
    let cancelled = false;
    adminExists().then((exists) => {
      if (!cancelled) setHasAdmin(exists);
    });
    return () => {
      cancelled = true;
    };
  }, [adminExists]);

  // Signs in against Supabase Auth, then loads every module from the database.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const ok = await login({ identifier, password });
      if (ok) {
        await hydrateFromSupabase();
        toast.success(t('welcome'));
        navigate('/', { replace: true });
      } else {
        setShake(true);
        setTimeout(() => setShake(false), 500);
        toast.error(t('invalidCredentials'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName || !regUsername || !regEmail || !regPassword) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }
    if (regPassword.length < 6) {
      toast.error('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }
    setCreating(true);
    try {
      const res = await createAccount({
        name: regName,
        username: regUsername,
        email: regEmail,
        password: regPassword,
      });
      if (res.ok) {
        toast.success('Compte Administrateur créé avec succès ! Connectez-vous.');
        // the factory now has its administrator: the button is not offered again
        setHasAdmin(true);
        setIdentifier(regUsername);
        setPassword(regPassword);
        setIsRegistering(false);
        setRegName('');
        setRegUsername('');
        setRegEmail('');
        setRegPassword('');
      } else {
        toast.error(res.error || 'Erreur lors de la création du compte');
        if (/administrateur existe/i.test(res.error || '')) {
          setHasAdmin(true);
          setIsRegistering(false);
        }
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-[1.05fr_1fr] bg-cream">
      {/* ---------------- Brand panel (always ink-black) ---------------- */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-[#0a0a0b] text-white p-12">
        <div className="absolute inset-0 paper-grain opacity-60" />
        {[0, 1, 2].map((k) => (
          <motion.div
            key={k}
            aria-hidden
            className="absolute right-[-80px] bottom-[-60px] h-[420px] w-[320px] rounded-sm border border-white/10 bg-white/[0.03]"
            style={{ rotate: -14 + k * 9 }}
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: k * -18 }}
            transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.15 + k * 0.12 }}
          />
        ))}
        <motion.div
          aria-hidden
          className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-red-600/25 blur-3xl"
          animate={{ opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        />

        <div className="relative flex items-center gap-3">
          <LogoBadge size={48} icon={26} />
          <div>
            <p className="text-lg font-bold leading-tight">{store.name || 'Papeterie Production'}</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-red-500 font-semibold">
              {store.description || 'Production de papier'}
            </p>
          </div>
        </div>

        <div className="relative max-w-md">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            className="h-1 w-16 bg-red-600 origin-left mb-6"
          />
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 24, delay: 0.25 }}
            className="text-4xl font-extrabold leading-[1.1] tracking-tight"
          >
            Gestion de l&apos;usine de <span className="text-red-500">production de papier</span>.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="mt-4 text-sm text-zinc-400 leading-relaxed"
          >
            Matières premières, fabrication, stock, ventes, commandes, caisse et personnel — dans une seule
            interface sécurisée.
          </motion.p>
        </div>

        <div className="relative flex items-center gap-6 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
          <span className="inline-flex items-center gap-2"><Layers size={14} className="text-red-500" /> Production</span>
          <span className="inline-flex items-center gap-2"><ScrollText size={14} className="text-red-500" /> Facturation</span>
          <span className="inline-flex items-center gap-2"><ShieldCheck size={14} className="text-red-500" /> Accès sécurisé</span>
        </div>
      </div>

      {/* ---------------- Form panel ---------------- */}
      <div className="relative flex items-center justify-center p-5 sm:p-10 bg-gradient-hero">
        <div className="absolute top-5 right-5 z-20 flex gap-2">
          <a
            href="/site" target="_blank" rel="noreferrer" title="Ouvrir le site web"
            className="h-10 px-3 inline-flex items-center gap-2 rounded-md border border-[--border-input] bg-chocolate text-sm font-semibold text-text-secondary hover:border-gold/60 hover:text-gold transition-colors"
          >
            <Globe size={16} /> Site web
          </a>
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
            className="h-10 w-10 inline-flex items-center justify-center rounded-md border border-[--border-input] bg-chocolate text-text-secondary hover:border-gold/60 hover:text-gold transition-colors"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {(['fr', 'ar'] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLanguage(l)}
              className={`h-10 px-3 rounded-md text-sm font-bold border transition-colors ${
                language === l
                  ? 'bg-gold text-white border-gold'
                  : 'bg-chocolate text-text-secondary border-[--border-input] hover:border-gold/60'
              }`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={shake ? { x: [0, -10, 10, -8, 8, -4, 4, 0] } : { opacity: 1, y: 0 }}
          transition={shake ? { duration: 0.4 } : { type: 'spring', stiffness: 260, damping: 26 }}
          className="relative z-10 w-full max-w-[420px]"
        >
          <div className="rounded-xl bg-chocolate border border-black/[0.07] dark:border-white/[0.07] shadow-2xl overflow-hidden">
            <div className="h-1 w-full bg-gradient-to-r from-red-700 via-red-500 to-red-700" />
            <div className="p-8">
              <div className="flex items-center gap-3 mb-7 lg:hidden">
                <LogoBadge size={44} icon={24} />
                <div>
                  <p className="font-bold text-text-primary">{store.name}</p>
                  <p className="text-xs text-text-muted">{store.description}</p>
                </div>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-gold">Espace sécurisé</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-text-primary">Connexion</h1>
              <p className="mt-1 mb-6 text-sm text-text-muted">
                Identifiez-vous avec votre compte administrateur ou employé.
              </p>

              <form onSubmit={handleLogin} className="space-y-4">
                <Input
                  label="Identifiant / Email *"
                  icon={<User size={18} />}
                  placeholder={t('emailOrUsername')}
                  value={identifier}
                  autoComplete="username"
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
                <Input
                  label="Mot de passe *"
                  icon={<Lock size={18} />}
                  type={showPwd ? 'text' : 'password'}
                  placeholder={t('password')}
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  suffix={
                    <button
                      type="button"
                      aria-label={showPwd ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                      onClick={() => setShowPwd(!showPwd)}
                      className="text-text-muted hover:text-gold"
                    >
                      {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  }
                />
                <Button type="submit" variant="gold" size="lg" disabled={busy} className="w-full">
                  {busy ? (
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  ) : (
                    <LogIn size={18} />
                  )}
                  {busy ? 'Connexion…' : t('login')}
                </Button>
              </form>

              {/* Create Admin Account — only while the factory has no administrator */}
              <AnimatePresence>
                {hasAdmin === false && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-6 pt-5 border-t border-black/[0.07] dark:border-white/[0.07]">
                      <Button type="button" variant="liver" className="w-full" onClick={() => setIsRegistering(true)}>
                        <UserPlus size={16} /> Créer le compte Administrateur
                      </Button>
                      <p className="mt-2 text-[11px] text-center text-text-muted">
                        Première utilisation : ce bouton disparaît dès que l&apos;administrateur est créé.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Modal: Create Admin Account */}
      <Modal open={isRegistering} onClose={() => setIsRegistering(false)} title="Créer le compte Administrateur" size="sm">
        <form onSubmit={handleCreateAdmin} className="space-y-4">
          <Input label="Nom Complet *" value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Ex: Ahmed Benali" required />
          <Input label="Nom d'utilisateur *" value={regUsername} onChange={(e) => setRegUsername(e.target.value)} placeholder="Ex: admin" required />
          <Input label="Adresse Email *" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="admin@papeterie.dz" required />
          <Input label="Mot de Passe *" type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="••••••••" required />
          <div className="flex justify-end gap-2 pt-3 border-t border-black/[0.07] dark:border-white/[0.07]">
            <Button type="button" variant="secondary" onClick={() => setIsRegistering(false)} disabled={creating}>
              Annuler
            </Button>
            <Button type="submit" variant="gold" disabled={creating}>
              {creating ? 'Création…' : 'Créer Administrateur'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
