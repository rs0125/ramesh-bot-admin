'use client';
/** Keeps section navigation in sync with scrolling, anchors, and responsive layout changes. */
import { useEffect, useState } from 'react';

export const workspaceSections = [
  ['overview', 'Overview', 'overview'],
  ['inbox', 'Inbox', 'inbox'],
  ['connection', 'Connection', 'phone'],
] as const;

export function useWorkspaceNavigation(onLeaveInbox: () => void) {
  const [activeSection, setActiveSection] = useState('overview');
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    let anchorFrame = 0;
    const header = document.querySelector<HTMLElement>('.workspace-header');
    const update = () => {
      frame = 0;
      const headerHeight = header?.getBoundingClientRect().height ?? 84;
      document.documentElement.style.setProperty('--workspace-header-height', `${headerHeight}px`);
      setScrolled(window.scrollY > 8);
      const visible = workspaceSections.flatMap(([id]) => {
        const element = document.getElementById(id);
        return element?.getClientRects().length
          ? [{ id, top: element.getBoundingClientRect().top }]
          : [];
      });
      const atBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      const candidates = atBottom ? visible : visible.filter(({ top }) => top <= headerHeight + 48);
      const last = candidates.at(-1) ?? visible[0];
      setActiveSection(last?.id ?? 'overview');
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const goToSection = (id: string) => {
      // Existing activity bookmarks still open the activity card within Connection.
      const destination = id === 'activity' ? 'connection' : id;
      if (!workspaceSections.some(([section]) => section === destination)) return;
      if (destination !== 'inbox') onLeaveInbox();
      cancelAnimationFrame(anchorFrame);
      // Restore hidden sections before moving to an anchor from the focused inbox.
      anchorFrame = requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
        schedule();
      });
    };
    const onHashChange = () => goToSection(window.location.hash.slice(1));
    const onAnchorClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href^="#"]')
          : null;
      if (link) goToSection(link.hash.slice(1));
    };
    const observer = new ResizeObserver(schedule);
    if (header) observer.observe(header);
    const main = document.getElementById('main-content');
    if (main) observer.observe(main);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('click', onAnchorClick);
    onHashChange();
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(anchorFrame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('click', onAnchorClick);
      document.documentElement.style.removeProperty('--workspace-header-height');
    };
  }, [onLeaveInbox]);

  return { activeSection, scrolled };
}
