import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="flex flex-wrap items-center justify-between gap-4 mb-6 pb-4 border-b border-black/[0.07] dark:border-white/[0.07]"
    >
      <div className="flex items-center gap-3">
        {icon && (
          <motion.div
            initial={{ scale: 0.8, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.05 }}
            className="relative h-11 w-11 rounded-lg bg-zinc-950 dark:bg-zinc-900 ring-1 ring-black/10 dark:ring-white/10 flex items-center justify-center text-white"
          >
            {icon}
            <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-sm bg-red-600" />
          </motion.div>
        )}
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">{title}</h1>
          {subtitle && <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </motion.div>
  );
}
