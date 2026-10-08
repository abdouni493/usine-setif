import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cardVariants } from '@/lib/animations';
import { cn } from '@/lib/utils';

interface CardProps {
  children: ReactNode;
  className?: string;
  index?: number;
  hoverable?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, index = 0, hoverable = false, onClick }: CardProps) {
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      whileHover={hoverable ? 'hover' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-xl bg-gradient-card border border-black/[0.06] dark:border-white/[0.06] shadow-card p-5',
        hoverable && 'cursor-pointer hover:shadow-hover hover:border-gold/40 transition-[box-shadow,border-color]',
        className
      )}
    >
      {children}
    </motion.div>
  );
}
