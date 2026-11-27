// Development only: screens and parts rendered from fixtures, with no API.
// Open /src/client/preview/preview.html?view=<name>. Not linked from the app and not in the production build.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Book, Cover, type CoverSize } from "../screens/BookCard";
import { BookBack, Copy, PublicBook } from "../screens/CopyPage";
import { FriendRows } from "../screens/Members";
import { TabBar } from "../TabBar";
import "../styles/index.css";
import { CoverWall, type WallKind } from "../wall/CoverWall";
import { ALL, type Status, type WallFilter } from "../wall/model";
import type { CopyView } from "../../shared/types";
import { tabRoot, type Tab } from "../shell";
import {
  BOOK_COLLECTIONS, BOOK_FRIEND, BOOK_GOOGLE, BOOK_GOOGLE_SHORT, BOOK_LONG, BOOK_OWNER, BOOK_OWNERLESS, BOOK_VIEWER, FAILED, FAILED_LONG, LOADED, LONG_TITLE, NO_COVER, NO_COVER_LONG,
  WALL, WALL_COLLECTIONS, type FixtureBook,
} from "./fixtures";

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

// &kind=friend|holding|… picks another wall, &loading shows the skeleton, &empty shows an empty wall,
// &status=out|home|unlabelled and &collection=<id> start with that filter.
function WallView() {
  document.getElementById("root")?.classList.add("has-tab-bar");
  const params = new URLSearchParams(location.search);
  const kind = (params.get("kind") ?? "mine") as WallKind;
  const [filter, setFilter] = useState<WallFilter>({
    status: (params.get("status") as Status | null) ?? ALL.status, collectionId: params.get("collection") ?? ALL.collectionId,
  });
  return (
    <>
      <main>
        <CoverWall
          kind={kind} title={kind === "holding" ? "Holding" : kind === "mine" ? "My books" : "Ann"}
          items={params.has("empty") ? [] : WALL} collections={WALL_COLLECTIONS} filter={filter} onFilter={setFilter}
          onNewCollection={() => {}} loading={params.has("loading")}
          empty={<p>You haven’t added any books yet.</p>}
        />
      </main>
      <TabBar active="books" />
    </>
  );
}

function FriendsView() {
  document.getElementById("root")?.classList.add("has-tab-bar");
  const people = [
    { id: "2", name: "Ann", pictureUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#2a7f8f"/><circle cx="20" cy="16" r="7" fill="#f4d58d"/><rect x="8" y="26" width="24" height="14" rx="7" fill="#f4d58d"/></svg>')}` },
    { id: "7", name: "Zed", pictureUrl: "data:image/png;base64,AAAA" },
    { id: "3", name: "Bob", pictureUrl: null },
    { id: "4", name: "W".repeat(60), pictureUrl: null },
    { id: "5", name: "Sam", pictureUrl: null, removed: true as const },
    { id: "6", name: "Émile", pictureUrl: null },
  ];
  return (
    <>
      <main><div className="shelf-page"><h1>Friends</h1><FriendRows people={people} counts={{ "2": 12, "3": 1, "4": 0, "5": 3 }} /></div></main>
      <TabBar active="friends" />
    </>
  );
}

// &v=owner|friend|public|ownerless|long|google|google-short shows one book page; with none, all of them one after another.
const BOOKS: Record<string, { copy: CopyView | null; viewer: string | null; tab: Tab | null; back: { href: string; label: string } | null }> = {
  owner: { copy: BOOK_OWNER, viewer: BOOK_VIEWER.natalie, tab: "books", back: tabRoot.books },
  friend: { copy: BOOK_FRIEND, viewer: BOOK_VIEWER.ann, tab: "friends", back: { href: "/members/1", label: "Natalie’s books" } },
  public: { copy: null, viewer: null, tab: null, back: null },
  ownerless: { copy: BOOK_OWNERLESS, viewer: BOOK_VIEWER.ann, tab: "friends", back: tabRoot.friends },
  long: { copy: BOOK_LONG, viewer: BOOK_VIEWER.ann, tab: "friends", back: { href: "/collections/k3", label: WALL_COLLECTIONS[2].name } },
  google: { copy: BOOK_GOOGLE, viewer: BOOK_VIEWER.ann, tab: "friends", back: { href: "/members/1", label: "Natalie’s books" } },
  "google-short": { copy: BOOK_GOOGLE_SHORT, viewer: BOOK_VIEWER.ann, tab: "friends", back: { href: "/members/1", label: "Natalie’s books" } },
};

function BookPage({ name }: { name: string }) {
  const { copy, viewer, back } = BOOKS[name];
  return (
    <div className="copy-page">
      {back && <BookBack {...back} />}
      {copy ? (
        <Copy
          copy={copy} viewerId={viewer} busy={false} choices={BOOK_COLLECTIONS} choicesFailed={false}
          onAction={() => {}} onMove={() => {}} onLend={() => {}} onGive={() => {}} onRelease={() => {}}
        />
      ) : <PublicBook book={LOADED[2]} returnTo="/b/abc" />}
    </div>
  );
}

function BookView() {
  const v = new URLSearchParams(location.search).get("v");
  const names = v !== null && v in BOOKS ? [v] : Object.keys(BOOKS);
  const tab = names.length === 1 ? BOOKS[names[0]].tab : "books";
  if (tab !== null) document.getElementById("root")?.classList.add("has-tab-bar");
  return (
    <>
      <main>
        {names.map((n, i) => (
          <section key={n} className="preview-book">
            {names.length > 1 && <p className="preview-caption">{i + 1}. {n}</p>}
            <BookPage name={n} />
          </section>
        ))}
      </main>
      {tab !== null && <TabBar active={tab} />}
    </>
  );
}

const VIEWS: Record<string, () => React.JSX.Element> = { book: BookView, friends: FriendsView, covers: Covers, tabbar: TabBarView, wall: WallView };
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
      .preview-book + .preview-book { margin-top: var(--space-8); padding-top: var(--space-6); border-top: 4px solid var(--color-rule); }
      .preview-caption { font-size: var(--text-sm); color: var(--color-muted); margin: 0 0 var(--space-4); }
      .preview figcaption { font-size: var(--text-sm); color: var(--color-muted); margin-top: var(--space-1); overflow-wrap: anywhere; }
    `}</style>
    {View ? <View /> : <main className="preview"><p>Views: {Object.keys(VIEWS).join(", ")}. Add ?view=&lt;name&gt;.</p></main>}
  </StrictMode>,
);
