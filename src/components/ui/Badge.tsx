import type { ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide border',
  {
    variants: {
      variant: {
        success: 'bg-pistachio/10 text-pistachio border-pistachio/30',
        warning: 'bg-caramel/10 text-caramel border-caramel/30',
        danger: 'bg-gold/10 text-gold-dark border-gold/40',
        info: 'bg-zinc-900/5 text-text-primary border-black/15 dark:bg-white/5 dark:border-white/15',
        gold: 'bg-gradient-button text-white border-red-800/50',
        neutral: 'bg-black/5 text-text-secondary border-black/10 dark:bg-white/5 dark:border-white/10',
      },
    },
    defaultVariants: { variant: 'info' },
  }
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
}

export function Badge({ children, variant, className }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)}>{children}</span>;
}
