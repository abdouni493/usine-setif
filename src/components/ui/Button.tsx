import { forwardRef } from 'react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * Buttons — red & black industrial system.
 * Squared geometry (6px radius), uppercase-free medium-weight labels, a crisp
 * 1px border on every variant and a spring press that never shifts layout.
 */
const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 font-semibold rounded-md border select-none cursor-pointer ' +
    'transition-[background-color,border-color,color,box-shadow,filter] duration-150 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-cream ' +
    'disabled:opacity-45 disabled:pointer-events-none disabled:cursor-not-allowed whitespace-nowrap tracking-[0.01em]',
  {
    variants: {
      variant: {
        // Signal red — the single primary action of a screen
        primary: 'bg-gradient-button text-white border-red-800/60 shadow-gold hover:brightness-110',
        gold: 'bg-gradient-button text-white border-red-800/60 shadow-gold hover:brightness-110',

        // Neutral surface button
        secondary:
          'bg-chocolate text-text-primary border-[--border-input] shadow-sm hover:border-gold/60 hover:text-gold',

        // Ink black — strong secondary
        liver:
          'bg-zinc-900 text-white border-zinc-950 shadow-sm hover:bg-black dark:bg-zinc-100 dark:text-zinc-900 dark:border-white dark:hover:bg-white',

        rose: 'bg-gradient-rose text-white border-rose-900/50 shadow-sm hover:brightness-110',
        danger: 'bg-gradient-rose text-white border-rose-900/50 shadow-sm hover:brightness-110',

        // Graphite (formerly purple)
        lavender: 'bg-gradient-lavender text-white border-zinc-800 shadow-sm hover:brightness-125',

        // Success / confirm
        mint: 'bg-gradient-mint text-white border-green-900/40 shadow-sm hover:brightness-110',

        ghost: 'bg-transparent border-transparent text-text-secondary hover:bg-gold/10 hover:text-gold',

        outline: 'bg-transparent border-gold/70 text-gold hover:bg-gold hover:text-white',
      },
      size: {
        sm: 'text-xs px-3 h-8',
        md: 'text-sm px-4 h-10',
        lg: 'text-base px-6 h-12',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'ref'>,
    VariantProps<typeof buttonVariants> {}

const PRESS = { type: 'spring', stiffness: 520, damping: 30, mass: 0.6 } as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, children, ...props }, ref) => {
    const reduce = useReducedMotion();
    return (
      <motion.button
        ref={ref}
        whileHover={reduce ? undefined : { y: -1 }}
        whileTap={reduce ? undefined : { scale: 0.96, y: 0 }}
        transition={PRESS}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);
Button.displayName = 'Button';
