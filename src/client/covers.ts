// Open Library "medium" covers are about 180px wide, soft at hero size on a 3x screen; "large" ones are sharper.
// Every other URL (Google Books and the rest) passes through untouched.
export const largerCover = (url: string): string =>
  /^https:\/\/covers\.openlibrary\.org\/.+-M\.jpg$/.test(url) ? url.replace(/-M\.jpg$/, "-L.jpg") : url;
