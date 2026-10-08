import { motion, useReducedMotion } from 'framer-motion';
import { ScrollText } from 'lucide-react';
import { useSettingsStore } from '@/store/settingsStore';

interface LogoBadgeProps {
  size?: number;
  icon?: number;
  className?: string;
}

/**
 * Brand mark — ink-black tile with a red corner fold (a sheet of paper).
 * Shows the uploaded store logo when there is one.
 */
export function LogoBadge({ size = 44, icon = 24, className = '' }: LogoBadgeProps) {
  const logo = useSettingsStore((s) => s.settings.logo);
  const reduce = useReducedMotion();
  const fold = Math.round(size * 0.3);

  return (
    <motion.div
      className={`relative shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-white/10 shadow-gold ${className}`}
      style={{ width: size, height: size }}
      initial={reduce ? false : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
    >
      {logo ? (
        <img src={logo} alt="logo" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ScrollText size={icon} className="text-white" strokeWidth={1.75} />
        </div>
      )}
      {/* red folded corner */}
      <span
        aria-hidden
        className="absolute right-0 top-0"
        style={{
          width: fold, height: fold,
          background: 'linear-gradient(225deg, #dc2626 50%, rgba(0,0,0,0) 50%)',
        }}
      />
    </motion.div>
  );
}
