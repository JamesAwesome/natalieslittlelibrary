// Development only: screens and parts rendered from fixtures, with no API.
// Open /src/client/preview/preview.html?view=<name>. Not linked from the app and not in the production build.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Book, Cover, type CoverSize } from "../screens/BookCard";
import { TabBar } from "../TabBar";
import "../styles/index.css";
import { FAILED, FAILED_LONG, LOADED, LONG_TITLE, NO_COVER, NO_COVER_LONG, type FixtureBook } from "./fixtures";

const SIZES: CoverSize[] = ["wall", "row", "hero"];
const STATES: [string, FixtureBook][] = [
  ["loaded", LOADED[0]],
  ["loaded", LOADED[1]],
  ["no cover", NO_COVER],
  ["no cover, 90-character title", NO_COVER_LONG],
  ["failed", FAILED],
  ["failed, 90-character title", FAILED_LONG],
];

function Covers() {
  return (
    <main className="preview">
      <h1>Covers</h1>
      {SIZES.map((size) => (
        <section key={size}>
          <h2>{size}</h2>
          <div className={`preview-grid preview-${size}`}>
            {STATES.map(([label, b], i) => (
              <figure key={i}>
                <Cover url={b.coverUrl} title={b.title} authors={b.authors} size={size} />
                <figcaption>{label}</figcaption>
              </figure>
            ))}
            {size === "hero" && LOADED.slice(2).map((b) => (
              <figure key={b.title}>
                <Cover url={b.coverUrl} title={b.title} authors={b.authors} size={size} />
                <figcaption>loaded</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h2>On the book page</h2>
        <Book title={LONG_TITLE} authors={NO_COVER_LONG.authors} coverUrl={null} />
        <Book title={LOADED[3].title} authors={LOADED[3].authors} coverUrl={LOADED[3].coverUrl} />
      </section>
    </main>
  );
}

function TabBarView() {
  document.getElementById("root")?.classList.add("has-tab-bar");
  return (
    <>
      <main className="preview">
        <h1>Tab bar</h1>
        {Array.from({ length: 30 }, (_, i) => <p key={i}>Filler line {i + 1}, so the bar sits over content.</p>)}
      </main>
      <TabBar active="holding" />
    </>
  );
}

const VIEWS: Record<string, () => React.JSX.Element> = { covers: Covers, tabbar: TabBarView };
const name = new URLSearchParams(location.search).get("view") ?? "";
const View = VIEWS[name];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <style>{`
      .preview { padding: var(--space-4); }
      .preview-grid { display: grid; gap: var(--space-4); align-items: start; }
      .preview-wall { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
      .preview-row, .preview-hero { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
      .preview figure { margin: 0; min-width: 0; }
      .preview figcaption { font-size: var(--text-sm); color: var(--color-muted); margin-top: var(--space-1); overflow-wrap: anywhere; }
    `}</style>
    {View ? <View /> : <main className="preview"><p>Views: {Object.keys(VIEWS).join(", ")}. Add ?view=&lt;name&gt;.</p></main>}
  </StrictMode>,
);
