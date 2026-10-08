import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cardVariants } from '@/lib/animations';
import { useCountUp } from '@/hooks/useCountUp';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: number;
  icon: ReactNode;
  format?: 'currency' | 'number';
  accent?: 'gold' | 'rose' | 'pistachio' | 'caramel' | 'lavender';
  index?: number;
  suffix?: string;
}

const accents = {
  gold: 'bg-red-600 text-white',
  rose: 'bg-red-800 text-white',
  pistachio: 'bg-green-700 text-white',
  caramel: 'bg-zinc-900 text-white dark:bg-zinc-200 dark:text-zinc-900',
  lavender: 'bg-zinc-600 text-white',
};
const bars = {
  gold: 'bg-red-600', rose: 'bg-red-800', pistachio: 'bg-green-600',
  caramel: 'bg-zinc-900 dark:bg-zinc-300', lavender: 'bg-zinc-500',
};

export function StatCard({ label, value, icon, format = 'number', accent = 'gold', index = 0, suffix }: StatCardProps) {
  const animated = useCountUp(value, 1200);
  const display = format === 'currency' ? formatCurrency(animated) : formatNumber(Math.round(animated));

  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover="hover"
      className="rounded-xl bg-gradient-card border border-black/5 dark:border-white/5 shadow-card p-5 relative overflow-hidden"
    >
      <div className={cn('absolute left-0 top-0 h-full w-[3px]', bars[accent])} />
      <div className="flex items-start justify-between mb-3">
        <div className={cn('h-10 w-10 rounded-md flex items-center justify-center shadow-sm', accents[accent])}>
          {icon}
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">{label}</p>
      <p className="text-2xl font-bold text-text-primary tabular">
        {display}
        {suffix && <span className="text-base font-medium text-text-muted ml-1">{suffix}</span>}
      </p>
    </motion.div>
  );
}
