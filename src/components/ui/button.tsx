import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/src/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-full text-xs font-medium tracking-wide transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-jam-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-jam-accent-strong text-white hover:bg-jam-accent shadow-md shadow-jam-accent/10",
        destructive: "bg-red-900/50 text-red-200 border border-red-900/50 hover:bg-red-900/80 shadow-sm",
        outline: "border border-jam-border bg-transparent hover:bg-jam-hover text-jam-strong",
        secondary: "bg-jam-surface text-jam-strong border border-jam-border hover:bg-jam-hover hover:border-jam-border shadow-sm",
        ghost: "hover:bg-jam-hover text-jam-muted hover:text-jam-strong",
        link: "text-jam-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2.5",
        sm: "h-8 px-4 text-[11px]",
        lg: "h-12 px-8 text-sm",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
