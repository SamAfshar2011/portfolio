import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from 'react';
import { useHref } from 'react-router';
import { useTransition } from './TransitionProvider';
import { audio } from '../audio/engine';

type Props = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

const isModified = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/**
 * Internal link. A real <a href> (crawlable, middle-click and cmd-click open a
 * new tab as usual); plain clicks run the route transition instead. Hover and
 * focus preload the destination so the transition never waits on the network.
 */
export const TLink = forwardRef<HTMLAnchorElement, Props>(function TLink({ to, onClick, onPointerEnter, onFocus, ...rest }, ref) {
  const href = useHref(to);
  const { go, preload } = useTransition();
  return (
    <a
      ref={ref}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || isModified(e) || rest.target === '_blank') return;
        e.preventDefault();
        audio.press();
        go(to);
      }}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        preload(to);
      }}
      onFocus={(e) => {
        onFocus?.(e);
        preload(to);
      }}
      {...rest}
    />
  );
});
