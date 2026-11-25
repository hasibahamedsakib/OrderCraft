import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { PageHeader } from '../../app/AppLayout';
import { geminiConfigFromEnv } from '../../assistant/gemini';
import { Alert, Badge, Button, Card, cx } from '../../components/ui';
import { RefreshIcon, SendIcon, SparkleIcon } from '../../components/ui/icons';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { askAssistant, chatCleared, type ChatMessage } from '../../store/slices/chatSlice';
import s from './chat.module.css';

/** Questions the bot supports (C2), plus one it must refuse (D5). */
const SUGGESTIONS = [
  'How many orders do we have?',
  'What is our total revenue?',
  'What is the best-selling option?',
  'Revenue by payment method?',
  'What is the average order value?',
  'How many orders actually got the MORNING15 coupon?',
  'How many orders were placed on 21 November 2026?',
  'Who is our best customer?',
];

export function ChatAssistant() {
  const dispatch = useAppDispatch();
  const messages = useAppSelector((state) => state.chat.messages);
  const pending = useAppSelector((state) => state.chat.pending);
  const orderCount = useAppSelector((state) => state.orders.items.length);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const hasKey = Boolean(geminiConfigFromEnv().apiKey);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length, pending]);

  const ask = (question: string) => {
    const text = question.trim();
    if (!text || pending) return;
    void dispatch(askAssistant({ question: text }));
    setDraft('');
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    ask(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask(draft);
    }
  };

  return (
    <>
      <PageHeader
        title="Sales assistant"
        subtitle="Ask about sales in plain English or Bangla. Numbers are computed by OrderCraft, Gemini only words the answer."
      />
      {!hasKey && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warning" title="Gemini API key missing" role="status">
            Add <code>VITE_GEMINI_API_KEY</code> to <code>.env.local</code> and restart <code>pnpm dev</code>. See{' '}
            <code>.env.example</code>.
          </Alert>
        </div>
      )}
      <div className={s.layout}>
        <section className={s.panel} aria-label="Chat with the sales assistant">
          <header className={s.panelHeader}>
            <span className={s.avatar}>
              <SparkleIcon />
            </span>
            <div>
              <div className={s.panelTitle}>OrderCraft assistant</div>
              <div className={s.panelSub}>Reading {orderCount} orders · updates live after each checkout</div>
            </div>
            <div className={s.panelEnd}>
              {messages.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => dispatch(chatCleared())} disabled={pending}>
                  Clear
                </Button>
              )}
            </div>
          </header>

          <div className={s.log} ref={logRef} role="log" aria-live="polite" aria-relevant="additions" aria-busy={pending}>
            {messages.length === 0 && !pending && (
              <div className={s.welcome}>
                <span className={s.avatar}>
                  <SparkleIcon />
                </span>
                <div className={s.welcomeTitle}>Ask about your sales</div>
                <p>Try a suggestion, or ask your own question. If the data can’t answer it, I’ll say so instead of guessing.</p>
              </div>
            )}
            {messages.map((message) => (
              <Message key={message.id} message={message} onRetry={(question, id) => dispatch(askAssistant({ question, retryOf: id }))} />
            ))}
            {pending && (
              <div className={s.row}>
                <div className={cx(s.bubble, s.assistant, s.typing)} aria-label="Assistant is typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          <form className={s.composer} onSubmit={onSubmit}>
            <label htmlFor="chat-input" className="visually-hidden">
              Your question
            </label>
            <textarea
              id="chat-input"
              className={s.textarea}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="e.g. How many orders were paid by bKash?"
              disabled={pending}
            />
            <Button type="submit" variant="accent" icon={<SendIcon size={15} />} disabled={!draft.trim() || pending} aria-label="Send">
              Send
            </Button>
          </form>
          <div className={s.hint}>Enter to send · Shift+Enter for a new line</div>
        </section>

        <aside className={s.side}>
          <Card title="Try asking">
            <div className={s.suggestions}>
              {SUGGESTIONS.map((q) => (
                <button key={q} type="button" className={s.suggestion} onClick={() => ask(q)} disabled={pending}>
                  {q}
                </button>
              ))}
            </div>
          </Card>
          <p className={s.sideNote}>
            The assistant can only see what orders store: time, items, payment method, coupon and totals. It has no customer
            data, so it can’t answer questions about people.
          </p>
        </aside>
      </div>
    </>
  );
}

function Message({ message, onRetry }: { message: ChatMessage; onRetry: (question: string, id: string) => void }) {
  if (message.role === 'user') {
    return (
      <div className={cx(s.row, s.rowUser)}>
        <div className={cx(s.bubble, s.user)}>{message.text}</div>
      </div>
    );
  }
  if (message.error) {
    const { question } = message.error;
    const retryable = message.error.kind !== 'missing_key';
    return (
      <div className={s.row} role="alert">
        <div className={cx(s.bubble, s.error)}>
          {message.text}
          {retryable && (
            <div className={s.errorActions}>
              <Button size="sm" variant="secondary" icon={<RefreshIcon size={14} />} onClick={() => onRetry(question, message.id)}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={s.row}>
      <div className={cx(s.bubble, s.assistant)}>
        {message.text}
        {(message.tool || message.note) && (
          <div className={s.meta}>
            {message.tool && <span className={s.toolTag}>{message.tool.name}</span>}
            {message.phrasedBy === 'code' && <Badge tone="neutral">computed reply</Badge>}
            {message.note && <span>{message.note}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
