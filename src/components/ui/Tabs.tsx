import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface Tab {
  id: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={cn('inline-flex gap-1 rounded-lg bg-chocolate p-1 border border-black/10 dark:border-white/10', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative px-4 py-2 text-sm font-semibold rounded-md transition-colors',
            active === tab.id ? 'text-white' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {active === tab.id && (
            <motion.div
              layoutId="tab-active"
              className="absolute inset-0 bg-gradient-button rounded-md shadow-gold"
              transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            />
          )}
          <span className="relative z-10">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
