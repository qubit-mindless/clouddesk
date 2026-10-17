export function Loading({ label = 'Ładowanie…' }: { label?: string }) {
  return (
    <p className="loading" role="status" data-testid="loading">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  )
}
