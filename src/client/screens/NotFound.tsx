import { APP_NAME } from "../shell";

export function NotFound() {
  return (
    <>
      <h1>{APP_NAME}</h1>
      <p>We couldn't find that page.</p>
      <a className="button" href="/">Back to the library</a>
    </>
  );
}
