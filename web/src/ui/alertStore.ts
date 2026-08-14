export interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface PendingAlert {
  id: number;
  title: string;
  message?: string;
  buttons?: AlertButton[];
}

let queue: readonly PendingAlert[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToAlerts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentAlert(): PendingAlert | null {
  return queue.length > 0 ? queue[0] : null;
}

export function closeCurrentAlert(): void {
  queue = queue.slice(1);
  notify();
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]): void {
    queue = [...queue, { id: nextId++, title, message, buttons }];
    notify();
  },
};
