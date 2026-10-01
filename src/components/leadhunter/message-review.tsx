type Message = { id: string; subject: string; body: string; state: string; validationResult: unknown; createdAt: Date };
type Outbox = { id: string; messageVersionId: string; logicalStep: number; dueAt: Date; state: string; subject: string; providerMessageId: string | null; lastError: string | null };

export function MessageReview({ messages, outbox }: { messages: Message[]; outbox: Outbox[] }) {
  const initial = outbox.find((item) => item.logicalStep === 0);
  const message = messages.find((item) => item.id === initial?.messageVersionId) ?? messages[0];
  return <section className="leadhunter-panel leadhunter-panel--wide"><header><p className="eyebrow">Contacto</p><h2>Mensaje y seguimientos</h2></header>{message ? <><div className="message-preview"><span className={`prospect-evaluation prospect-evaluation--${message.state === "valid" ? "eligible" : "needs_review"}`}>{message.state}</span><strong>{message.subject}</strong><pre>{message.body}</pre></div><div className="outbox-timeline">{outbox.map((item) => <article key={item.id}><span>{item.logicalStep === 0 ? "Contacto inicial" : `Seguimiento ${item.logicalStep}`}</span><strong>{item.state.replaceAll("_", " ")}</strong><small>{new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(item.dueAt)}</small>{item.lastError ? <em>{item.lastError}</em> : null}</article>)}</div></> : <p>El mensaje se crea automáticamente cuando la calificación y el correo están verificados.</p>}</section>;
}
