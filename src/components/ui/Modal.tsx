import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { modalVariants, EASE } from '@/lib/animations';
import { lockScroll } from '@/lib/scrollLock';
import { PresenceLayer } from './PresenceLayer';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
}

const sizes = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

/**
 * Pile des fenêtres réellement ouvertes. Une modale ouverte PAR-DESSUS une
 * autre (le choix de la TVA au-dessus du compte rendu, par exemple) doit être
 * la SEULE que la touche Échap referme.
 */
const openStack: symbol[] = [];

/* ----------------------------------------------------------------------------
 *  OUVERTURE ET FERMETURE FLUIDES — ET JAMAIS D'ECRAN BLOQUE
 *  · le défilement de la page passe par le verrou partagé (`lockScroll`) :
 *    il revient dès que la DERNIERE fenêtre se ferme, quel que soit l'ordre ;
 *  · dès que la fermeture commence, le voile devient « transparent aux
 *    clics » (`PresenceLayer`) : une fenêtre qui s'efface ne peut plus
 *    intercepter un clic, même si son animation est ralentie ou interrompue.
 * -------------------------------------------------------------------------- */
export function Modal({ open, onClose, title, children, size = 'md', footer }: ModalProps) {
  // La fermeture passe par une ref : l'effet ne se rejoue donc pas à chaque
  // rendu et l'ordre de la pile reste celui des ouvertures.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol('modal');
    openStack.push(id);
    const release = lockScroll();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id) closeRef.current();
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      const i = openStack.indexOf(id);
      if (i >= 0) openStack.splice(i, 1);
      release();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <PresenceLayer
          key="modal-root"
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.16, ease: EASE } }}
          exit={{ opacity: 0, transition: { duration: 0.12, ease: EASE } }}
        >
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-[3px]"
            onClick={onClose}
          />
          <motion.div
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            /* Marqueur lu par l'ecran « Historique » plein ecran : tant qu'une
               fenetre est ouverte par-dessus lui, Echap la ferme ELLE, pas
               l'historique. */
            data-modal-open="true"
            className={cn(
              'relative z-10 w-full bg-chocolate rounded-xl shadow-2xl border border-black/10 dark:border-white/10 max-h-[92vh] flex flex-col overflow-hidden',
              sizes[size]
            )}
          >
            {title && (
              <div className="relative flex items-center justify-between px-6 py-4 border-b border-black/[0.07] dark:border-white/[0.07] shrink-0">
                <span className="absolute left-0 top-0 h-[3px] w-full bg-gradient-to-r from-red-700 via-red-500 to-transparent" />
                <h2 className="text-lg font-bold tracking-tight text-text-primary">{title}</h2>
                <button
                  onClick={onClose}
                  aria-label="Fermer"
                  className="h-9 w-9 inline-flex items-center justify-center text-text-muted hover:text-white hover:bg-red-600 transition-colors rounded-md"
                >
                  <X size={20} />
                </button>
              </div>
            )}
            <div className="overflow-y-auto overscroll-contain px-6 py-5 flex-1">{children}</div>
            {footer && (
              <div className="px-6 py-4 border-t border-black/[0.07] dark:border-white/[0.07] bg-cream/60 flex justify-end gap-3 shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </PresenceLayer>
      )}
    </AnimatePresence>,
    document.body
  );
}
