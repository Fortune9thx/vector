import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-xl border border-border bg-paper-raised px-4 py-3 text-sm text-ink placeholder:text-ink-faint transition-colors duration-200 focus:border-ink focus:outline-none",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
