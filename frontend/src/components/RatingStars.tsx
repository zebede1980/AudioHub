interface Props {
  value: number | null;
  onChange?: (rating: number) => void;
  /** Clicking the already-selected star clears the rating instead of re-setting it, when provided. */
  onClear?: () => void;
  size?: "sm" | "lg";
  readOnly?: boolean;
}

export default function RatingStars({ value, onChange, onClear, size = "lg", readOnly = false }: Props) {
  const textSize = size === "lg" ? "text-2xl" : "text-base";

  if (readOnly) {
    if (!value) return null;
    return (
      <div className="flex gap-1" role="img" aria-label={`Rated ${value} of 5 stars`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <span key={star} className={`${textSize} leading-none ${star <= value ? "text-yellow-400" : "text-slate-600"}`}>
            ★
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          title={value === star && onClear ? "Click to clear rating" : undefined}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (value === star && onClear) onClear();
            else onChange?.(star);
          }}
          className={`${textSize} leading-none ${value && star <= value ? "text-yellow-400" : "text-slate-600"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
