import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useClientStore } from '@/store/clientStore';
import { useWebsiteStore } from '@/store/websiteStore';
import { ClientForm, type ClientAccountInput } from './ClientForm';
import type { Client } from '@/types';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Client créé — à sélectionner dans l'écran appelant. */
  onCreated: (client: Client) => void;
}

/**
 * Création d'un client — EXACTEMENT le formulaire de l'écran Clients (mêmes
 * champs, identifiants fiscaux et accès au site web), réutilisé par la caisse,
 * les commandes, les livraisons et partout où l'on peut créer un client.
 */
export function NewClientModal({ open, onClose, onCreated }: Props) {
  const addClient = useClientStore((s) => s.addClient);
  const setClientAccount = useWebsiteStore((s) => s.setClientAccount);

  const handleSubmit = async (data: Omit<Client, 'id'>, account?: ClientAccountInput) => {
    const client = await addClient(data);
    toast.success('Client créé');
    if (account?.enabled) {
      try {
        await setClientAccount(client.id, account.email, account.password);
        toast.success('Accès au site enregistré');
      } catch (e) {
        toast.error('Accès au site : ' + (e as Error).message);
      }
    }
    onCreated(client);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Nouveau client" size="sm">
      {open && <ClientForm withAccount onSubmit={handleSubmit} onCancel={onClose} />}
    </Modal>
  );
}
