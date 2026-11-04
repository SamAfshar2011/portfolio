import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { StageHost } from '../gl/StageHost';
import { TransitionProvider } from '../components/transition/TransitionProvider';
import { Header } from '../components/nav/Header';
import { IndexMenu } from '../components/nav/IndexMenu';
import { Cursor } from '../components/cursor/Cursor';
import { ExitVeil } from '../components/transition/ExitVeil';
import { Toast } from '../components/ui/Toast';
import { Opening } from '../components/boot/Opening';
import { initPointer } from '../experience/pointer';
import { initScroll } from '../motion/scroll';
import { projectBySlug } from '../projects/registry';
import { useEasterEggs } from './useEasterEggs';
import { useDocumentMeta } from './useDocumentMeta';
import { useTouchPress } from '../components/cursor/useTouchPress';

export function Shell() {
  const { pathname } = useLocation();
  const room = projectBySlug(pathname.match(/^\/projects\/([^/]+)/)?.[1])?.room ?? 'home';

  useEffect(() => initPointer(), []);
  useEffect(() => initScroll(), []);
  useEasterEggs();
  useTouchPress();
  useDocumentMeta(pathname);

  useEffect(() => {
    document.documentElement.dataset.room = room;
  }, [room]);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);

  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <StageHost />
      <TransitionProvider>
        <Header />
        <IndexMenu />
        <main id="content" className="app-root" tabIndex={-1}>
          <div id="page">
            <Outlet />
          </div>
        </main>
      </TransitionProvider>
      <Opening />
      <Cursor />
      <Toast />
      <ExitVeil />
    </>
  );
}
