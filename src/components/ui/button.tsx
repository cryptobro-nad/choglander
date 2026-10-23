"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-semibold tracking-tight transition-transform duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4a55c9]",
  {
    variants: {
      variant: {
        dark: "rounded-full bg-gradient-to-b from-[#2c3470] to-[#1b2150] text-white shadow-[0_14px_26px_-18px_rgba(27,33,80,0.65)]",
        /** The primary action on a night sky: moonlight on ink. */
        light: "rounded-full bg-gradient-to-b from-[#fbf9ff] to-[#e9e5fb] text-ink shadow-[0_14px_28px_-18px_rgba(0,0,0,0.75)]",
        ghost: "rounded-full bg-white/75 text-ink shadow-[0_0_0_1px_rgba(29,35,64,0.06)]",
        /** Secondary action on a white sheet, where a translucent white would vanish. */
        soft: "rounded-full bg-[#f1efe9] text-ink",
        quiet: "rounded-full bg-transparent text-ink",
        danger: "rounded-full bg-[#e24b4b] text-white",
      },
      size: {
        sm: "h-11 px-4 text-[14px]",
        md: "h-12 px-5 text-[15px]",
        lg: "h-14 px-6 text-[16px]",
        icon: "h-16 w-16 rounded-full",
      },
    },
    defaultVariants: { variant: "dark", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), "active:scale-[0.97]", className)} {...props} />;
}
