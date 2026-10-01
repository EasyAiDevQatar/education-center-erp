import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function FormField({
  label,
  htmlFor,
  children,
  hint,
  labelActions,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  labelActions?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {labelActions ? (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={htmlFor} className="shrink-0">{label}</Label>
          <div className="flex items-center gap-2">{labelActions}</div>
        </div>
      ) : <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {hint && <p className="text-xs text-muted-foreground" dir="auto">{hint}</p>}
    </div>
  );
}
