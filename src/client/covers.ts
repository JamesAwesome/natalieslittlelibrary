// Open Library "medium" covers are about 180px wide, soft at hero size on a 3x screen; "large" ones are sharper.
// "?default=false" makes a missing large cover a 404 (so the caller falls back) instead of a 1x1 placeholder with a 200.
// Every other URL passes through untouched, Google Books included: its zoom parameter was seen to return a
// different edition for some volumes, and a wrong image cannot be detected.
export const largerCover = (url: string): string =>
  /^https:\/\/covers\.openlibrary\.org\/.+-M\.jpg$/.test(url) ? `${url.replace(/-M\.jpg$/, "-L.jpg")}?default=false` : url;
