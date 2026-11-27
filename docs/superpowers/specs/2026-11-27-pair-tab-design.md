# A Pair tab and back to top

Drafted 2026-11-27, after v0.7.0. This is a small change, client only. It
follows on from `2026-11-27-pair-faster-design.md`. Calls made without the
maintainer are marked **(call)**.

## Why

The maintainer wants the plus in the bottom middle instead of beside "My
books", and a way back to the top of a long wall.

## What the maintainer decided

- **The plus is a centre "Pair" tab**: design B from the pair-faster mockups.
  It is a fifth tab in the middle of the tab bar: Books · Holding · **Pair** ·
  Friends · More. This replaces the plus beside "My books", which goes.
- **Back to top lives on the A–Z rail.** An "↑" mark goes above A.

## Goals

1. Pairing is one tap from every screen that has the tab bar.
2. On a wall with the A–Z rail, one tap (or a drag to the top of the rail)
   goes back to the top.

## Non-goals

- Any server change.
- Changing what Pair does. The loop from v0.7.0 stays as it is.
- A back-to-top control on walls too short for the rail (`showRail`: more
  than 24 books in at least two letters). There is little to scroll there.

## Anti-goals

- A tab label that is cut off or wraps at 320px.
- A rail narrower than 44px, or a rail whose letters drift from where the
  finger is.
- A floating button over the covers.

## Approaches considered

For the plus:
- **A. Beside "My books"** (shipped in v0.7.0). Replaced.
- **B. A centre Pair tab (chosen).** One tap from everywhere, and it never
  covers a book.
- **C. A round button floating above the tab bar.** Not chosen: it sits over
  the middle column of covers.

For back to top:
- **An "↑" mark on the rail (chosen).** It goes where the thumb already is,
  and adds no new chrome.
- **A separate round button that appears after scrolling.** Not chosen: it
  needs its own spot, and bottom right is the rail's.

## The design

### The Pair tab

- `Tab` gains `"pair"`, and `tabRoot.pair` is `{ href: "/pair", label: "Pair a book" }`.
  `tabFor` maps the `pair` route to `"pair"`, no longer to `"more"`.
- The order is Books, Holding, Pair, Friends, More. The tab bar grid has five
  columns.
- As in mockup B, the Pair tab is a 40px accent disc holding a plus (paper on
  accent: 6.81:1 light, 8.40:1 dark), with the label "Pair" in the accent
  colour beneath it. On `/pair` it carries `aria-current="page"` like any
  other tab; the disc already marks it **(call)**.
- The whole tab is still at least 44px tall. At 320px each tab is 64px wide,
  and "Holding" must fit on one line.
- The plus beside "My books" (`.wall-head` / `.wall-pair`) is removed, with
  its tests. The `h1` goes back to how it was before v0.7.0.
- More drops its "Pair a book" entry, since the tab is on every screen
  **(call)**. The empty wall keeps its "Pair a book" link.
- The README's Pair step says "Open it from the Pair tab".

### Back to top on the rail

- `RAIL_MARKS` gains a first mark, "↑", above A. The rail has 28 marks and
  its `max-height` grows to match. Each mark keeps its share of the height.
- Tapping or dragging onto "↑" scrolls the page to the top
  (`window.scrollTo(0, 0)`). Dragging on down from "↑" picks letters as
  today. The bubble shows "↑" while the finger is on it.
- "↑" is never shown as empty, and it is drawn in the accent like a present
  letter.
- The rail stays `aria-hidden`. Screen-reader and keyboard users already move
  by the letter headings, and the next point gives everyone a second way back.
- **Tapping the tab you're already on scrolls to the top (call).** This holds
  only when you're on that tab's own page (`location.pathname` equals its
  href and there is no query string). It is the common phone-app habit, and it means a short wall without
  a rail still has a way back up. Without it, a full reload restores your
  scroll place, which feels like nothing happened.

## Constraints

- React 19, no router library, plain CSS with tokens. Light and dark
  settings, 44px targets, and text at 4.5:1 or better.
- It must render at 320, 375, 414 and 768px with no sideways scroll
  (`scripts/shoot.mjs`).
- Tests go by role and visible text, and are updated in the same pull
  request.
- The work goes through one pull request; the maintainer approves the merge
  and the tag.

## Left to the builder

- How `markAt` and `targetLetter` handle "↑", as long as a letter still maps
  to where the finger is.
- Whether the Pair tab's disc rises above the bar's top edge (mockup B kept
  it inside the bar).
