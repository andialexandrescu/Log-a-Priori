"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: "bg-white text-black hover:bg-neutral-100",
        colorful: "bg-gradient-to-b from-pink-600 to-blue-700 text-primary-foreground hover:from-pink-700 hover:to-blue-700",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        ghost:
          "bg-accent border-transparent shadow-none hover:bg-neutral-100 hover:text-accent-foreground",
        muted: "bg-neutral-200 text-neutral-600 hover:bg-neutral-200/80",
        craft: "bg-black text-white hover:bg-neutral-900",
        glass: "bg-white/20 backdrop-blur-sm border-white/30 hover:bg-white/30 text-gray-800",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

// CraftButton (npx shadcn@latest add @ss-components/button-49)
const CraftButtonContext = React.createContext<{
  size?: VariantProps<typeof buttonVariants>['size']
}>({})

interface CraftButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: VariantProps<typeof buttonVariants>['size']
  children?: React.ReactNode
  asChild?: boolean
}

interface CraftButtonLabelProps {
  children: React.ReactNode
  className?: string
}

interface CraftButtonIconProps {
  children: React.ReactNode
  className?: string
}

function CraftButtonLabel({ children, className }: CraftButtonLabelProps) {
  return (
    <span className={cn('group-hover:text-foreground relative z-2 transition-colors duration-500', className)}>
      {children}
    </span>
  )
}

function CraftButtonIcon({ children, className }: CraftButtonIconProps) {
  const { size } = React.useContext(CraftButtonContext)
  const iconSize = size === 'lg' ? 'size-6' : size === 'sm' ? 'size-4' : 'size-5'

  return (
    <span className={cn('relative z-1', iconSize, className)}>
      <span
        className={cn(
          'bg-background absolute inset-0 -z-1 rounded-full transition-transform duration-500 group-hover:scale-[15]',
          iconSize
        )}
      />
      <span
        className={cn(
          'bg-background text-primary group-hover:bg-primary group-hover:text-background relative z-2 flex items-center justify-center rounded-full transition-all duration-500',
          iconSize
        )}
      >
        {children}
      </span>
    </span>
  )
}

function CraftButton(props: CraftButtonProps) {
  const { children, size, asChild = false, className, ...rest } = props

  return (
    <CraftButtonContext.Provider value={{ size }}>
      <Button
        variant="craft"
        size={size}
        asChild={asChild}
        className={cn(
          'group hover:bg-background dark:hover:border-primary/30 relative cursor-pointer overflow-hidden rounded-full duration-500 hover:shadow-md dark:border dark:border-transparent',
          className
        )}
        {...rest}
      >
        {children}
      </Button>
    </CraftButtonContext.Provider>
  )
}

export { Button, buttonVariants, CraftButton, CraftButtonLabel, CraftButtonIcon }
