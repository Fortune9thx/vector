import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
  {
    variants: {
      variant: {
        primary: "pill-yellow active:scale-[0.98]",
        dark: "pill-dark active:scale-[0.98]",
        outline: "pill-outline active:scale-[0.98]",
        ghost: "rounded-full text-ink-soft hover:text-ink hover:bg-ink/5",
        danger:
          "rounded-full border border-ink/20 bg-ink/5 text-ink hover:border-ink/40 active:scale-[0.98]",
      },
      size: {
        default: "h-11 px-6 rounded-full",
        sm: "h-9 px-4 text-xs rounded-full",
        lg: "h-13 px-8 text-base rounded-full",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
