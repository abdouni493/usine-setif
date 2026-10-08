import { motion, useReducedMotion } from 'framer-motion';
import { Anvil } from 'lucide-react';
import { useSettingsStore } from '@/store/settingsStore';

interface LogoBadgeProps {
  size?: number;
  icon?: number;
  className?: string;
}

/**
 * Brand mark — ink-black steel tile with a red hazard-striped flange.
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
          <Anvil size={icon} className="text-white" strokeWidth={1.75} />
        </div>
      )}
      {/* red hazard-striped flange (steel beam) */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0"
        style={{
          height: Math.max(3, Math.round(fold / 3)),
          background: 'repeating-linear-gradient(135deg, #dc2626 0 5px, #0a0a0b 5px 9px)',
        }}
      />
    </motion.div>
  );
}
