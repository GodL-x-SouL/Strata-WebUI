import { tr } from '../lib/i18n';
import { Brand } from '../components/Brand';
import { Icon } from '../components/ui';
import { href, useLocation, type Route } from '../lib/router';
import { setNavOpen, setTheme, toggleRail, useStore } from '../lib/store';
import { startNewStudioChat } from '../lib/studio-chat';
import { useMedia } from '../lib/responsive';
import type { RefObject } from 'react';

export function StudioSidebar({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const location = useLocation();
  const compact = useMedia('(max-width: 1279px)');
  const navOpen = useStore(s => s.navOpen);
  const rail = useStore(s => s.rail);
  const theme = useStore(s => s.theme);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const dark = theme === 'dark' || theme === 'system' && systemDark;
  const collapsed = compact ? !navOpen : rail;
  const items: { route: Route; label: string; icon: 'new-chat' | 'models' | 'link' | 'activity' }[] = [
    { route: 'chat', label: tr('Chat'), icon: 'new-chat' },
    { route: 'models', label: tr('Models'), icon: 'models' },
    { route: 'serving', label: tr('Serving'), icon: 'link' },
    { route: 'monitor', label: tr('Monitor'), icon: 'activity' },
  ];
  return <aside className="nav" ref={containerRef} aria-label={tr('Strata Studio')} aria-modal={navOpen && compact ? true : undefined} role={navOpen && compact ? 'dialog' : undefined} tabIndex={-1}>
    <div className="nav__top">
      {!collapsed && <a className="nav__brand" href={href('chat')} aria-label={tr('Strata Studio')}><Brand variant="lockup" height={28} decorative className="nav__brand-lockup"/></a>}
      <button type="button" className="nav__collapse" aria-label={tr(collapsed ? 'Show sidebar' : 'Hide sidebar')} onClick={() => compact ? setNavOpen(!navOpen) : toggleRail()}><Icon name="panel" size={20}/></button>
    </div>
    <div className="nav__scroll">
      {!collapsed && <p className="navgroup__label studio-label">{tr('Studio')}</p>}
      <button type="button" className="st-btn st-btn--primary nav-new" aria-label={tr('New chat')} title={tr('New chat')} onClick={startNewStudioChat}>
        <Icon name="new-chat" size={18}/><span className="nav__rail-hide">{tr('New chat')}</span>
      </button>
      {items.map(item => <a key={item.route} className="navitem" href={href(item.route)} aria-current={location.route === item.route || item.route === 'models' && location.route === 'tuning' ? 'page' : undefined} title={item.label}><Icon name={item.icon}/><span className="navitem__text">{item.label}</span></a>)}
    </div>
    <div className="nav__foot">
      <button className="navitem studio-signout" onClick={() => { void fetch('/studio/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).finally(() => window.location.assign('/studio/login')); }} title={tr('Sign out')}><Icon name="x"/><span className="navitem__text">{tr('Sign out')}</span></button>
      <div className="nav__bottom">
        <span className="nav__version nav__rail-hide">Studio</span>
        <button className="st-btn st-btn--icon theme-switch" aria-label={tr(dark ? 'Switch to light mode' : 'Switch to dark mode')} onClick={() => setTheme(dark ? 'light' : 'dark')}><span key={String(dark)} className="theme-switch__icon"><Icon name={dark ? 'sun' : 'moon'} size={19}/></span></button>
      </div>
    </div>
  </aside>;
}
