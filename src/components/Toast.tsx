export interface ToastMessage {
  id: string;
  text: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
}

export function Toast({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id} onClick={() => onDismiss(t.id)}>
          <span aria-hidden>{t.tone === 'ok' ? '✓' : t.tone === 'error' ? '✕' : t.tone === 'warn' ? '!' : 'i'}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
