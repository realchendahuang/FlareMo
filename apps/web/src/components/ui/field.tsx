import { cloneElement, isValidElement, useId } from "react";

/** Labeled form field: wires the label htmlFor to the child control's id. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ id?: string }>, {
            id,
          })
        : children}
    </div>
  );
}
