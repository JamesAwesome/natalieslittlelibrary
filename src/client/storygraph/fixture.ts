// A synthetic StoryGraph-style export for tests. Every title, name and number here is invented; the real
// export is never read by anything. BOM, CRLF line ends, and a review spanning three lines are deliberate.
export const REVIEW_SENTINEL = "PRIVATE-REVIEW-7f3a";
export const RATING = "4.25";
export const DATE_READ = "2025/03/01";

const HEADER = "Title,Authors,Contributors,ISBN/UID,Format,Read Status,Owned?,Star Rating,Review,Dates Read";
const review = `"First line of a review ${REVIEW_SENTINEL}\nsecond line, with a comma\nthird line ""quoted"""`;
const line = (title: string, authors: string, isbn: string, format: string, owned: string, rev = "") =>
  `${title},${authors},"Some Translator",${isbn},${format},read,${owned},${RATING},${rev},${DATE_READ}`;

export const FIXTURE_LINES = [
  HEADER,
  line("Hardcover Book", '"Ann Author, Bo Writer"', "9780306406157", "hardcover", "Yes"),
  line("Paperback Book", "Cy Penn", "0306406152", "paperback", "yes"),
  line("Digital Book", "Di Gital", "9781111111117", "digital", "Yes"),
  line("Audio Book", "Au Dio", "9782222222222", "audio", "Yes"),
  line("Not Mine", "No Body", "9783333333333", "hardcover", "No"),
  line("Formatless Book", "Fo Rmat", "", "", " YES "),
  line("UID Book", "Ui Dee", "b3a1c2d4-0000-1111-2222-333344445555", "paperback", "Yes"),
  line('"A Title, with a comma and ""quotes"""', "Quo Ted", "", "hardcover", "Yes"),
  line("Reviewed Book", "Re View", "", "Hardcover", "Yes", review),
  line("", "No Title", "", "hardcover", "Yes"),
];
export const FIXTURE = "﻿" + FIXTURE_LINES.join("\r\n") + "\r\n\r\n";
