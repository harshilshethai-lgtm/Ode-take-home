import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * variant="default" is THE primary button (indigo, 32px). At most one per page file (design lint).
 * Everything else is secondary (bordered), ghost (text only) or link.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-body font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "h-8 bg-accent px-4 text-on-accent hover:opacity-90",
        secondary: "h-7 border border-line bg-panel px-3 text-fg hover:bg-hover",
        ghost: "h-7 px-2 text-fg-2 hover:bg-hover hover:text-fg",
        link: "h-7 px-1 text-accent-fg hover:underline",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}
