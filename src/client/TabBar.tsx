import type { MouseEvent, ReactNode } from "react";
import { tabRoot, type Tab } from "./shell";

// One hand-drawn set: 24x24, 1.6 stroke, round caps and joins. The .fill shapes fill in on the active tab.
const icons: Record<Tab, ReactNode> = {
  books: (
    <>
      <path className="fill" d="M5 4.5h9.5a2 2 0 0 1 2 2V19H7a2 2 0 0 1-2-2z" />
      <path d="M16.5 8.5h2.5V19.5" />
      <path d="M8.5 9h4M8.5 12h3" />
    </>
  ),
  holding: (
    <>
      <path className="fill" d="M4 13l2.2-6.5a1.5 1.5 0 0 1 1.4-1h8.8a1.5 1.5 0 0 1 1.4 1L20 13v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" />
      <path d="M4 13h4.5a1 1 0 0 1 1 .8 2.6 2.6 0 0 0 5 0 1 1 0 0 1 1-.8H20" />
    </>
  ),
  pair: <path d="M12 5v14M5 12h14" />,
  friends: (
    <>
      <circle className="fill" cx="9" cy="8.5" r="3.2" />
      <path className="fill" d="M3.5 19c0-3.2 2.4-5.2 5.5-5.2s5.5 2 5.5 5.2z" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" />
      <path d="M17.5 14.2c2 .6 3.2 2.3 3.2 4.8" />
    </>
  ),
  more: (
    <>
      <circle className="fill" cx="5.5" cy="12" r="1.7" />
      <circle className="fill" cx="12" cy="12" r="1.7" />
      <circle className="fill" cx="18.5" cy="12" r="1.7" />
    </>
  ),
};

const order: [Tab, string][] = [["books", "Books"], ["holding", "Holding"], ["pair", "Pair"], ["friends", "Friends"], ["more", "More"]];

// Tapping the tab you're on, on that tab's own page, scrolls to the top instead of reloading.
function scrollToTop(tab: Tab, active: Tab | null, e: MouseEvent<HTMLAnchorElement>) {
  if (tab !== active || location.pathname !== tabRoot[tab].href || location.search !== "") return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "instant" : "smooth" });
}

export function TabBar({ active }: { active: Tab | null }) {
  return (
    <nav aria-label="Main" className="tab-bar app-chrome">
      {order.map(([tab, label]) => {
        const icon = <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{icons[tab]}</svg>;
        return (
          <a key={tab} onClick={(e) => scrollToTop(tab, active, e)} href={tabRoot[tab].href} className={tab === "pair" ? "tab tab-pair" : "tab"} aria-current={tab === active ? "page" : undefined}>
            {tab === "pair" ? <span className="tab-disc">{icon}</span> : icon}
            <span className="tab-label">{label}</span>
          </a>
        );
      })}
    </nav>
  );
}
