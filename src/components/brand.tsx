/** Shared wordmark for public access and the authenticated workspace. */
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        w.
      </span>
      <span className="brand-name">
        WareOnGo<span className="brand-product">Ramesh</span>
      </span>
    </span>
  );
}
