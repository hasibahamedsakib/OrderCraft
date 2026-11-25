import { AlertIcon } from '../../components/ui/icons';
import type { Violation } from '../../domain/validate';
import s from './builder.module.css';

/** Violations shown next to the group they belong to. */
export function ValidationMessage({ violations, id }: { violations: Violation[]; id?: string }) {
  if (violations.length === 0) return null;
  return (
    <ul className={s.messages} id={id}>
      {violations.map((v) => (
        <li key={`${v.code}-${v.ruleId ?? ''}-${v.message}`} className={s.message}>
          <AlertIcon size={14} />
          <span>{v.message}</span>
        </li>
      ))}
    </ul>
  );
}
