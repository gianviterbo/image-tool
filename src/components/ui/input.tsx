import * as React from "react"
import { cn } from "@/src/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-lg border border-jam-border bg-jam-surface px-4 py-2 text-xs text-jam-strong shadow-inner transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-jam-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-jam-accent disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
