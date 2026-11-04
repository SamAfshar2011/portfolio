import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { leaveTo } from './ExitVeil';
import { audio } from '../audio/engine';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  /** Short destination label shown during the exit transition. */
  label: string;
  onLeave?: () => void;
};

const isModified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/** External link with the exit transition. Modified clicks behave natively. */
export const ExternalLink = forwardRef<HTMLAnchorElement, Props>(function ExternalLink(
  { href, label, onClick, onLeave, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      href={href}
      rel="noopener"
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || isModified(e)) return;
        e.preventDefault();
        audio.chime();
        leaveTo(href, label, onLeave);
      }}
      {...rest}
    />
  );
});
