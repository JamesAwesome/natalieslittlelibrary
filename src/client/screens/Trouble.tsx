export function Trouble({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p role="alert" className="refusal">The library is having trouble right now. Please try again later.</p>
      <button type="button" onClick={onRetry}>Try again</button>
    </>
  );
}

// A wall merged from several shelves, some of which didn't load: what did load stays, and this says the rest is missing.
export function SomeFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p role="alert" className="refusal">Some books couldn't load.</p>
      <button type="button" onClick={onRetry}>Try again</button>
    </>
  );
}
