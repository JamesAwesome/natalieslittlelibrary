export function Trouble({ onRetry }: { onRetry: () => void }) {
  return (
    <>
      <p role="alert" className="refusal">The library is having trouble right now. Please try again later.</p>
      <button type="button" onClick={onRetry}>Try again</button>
    </>
  );
}
