"use client";

// Adapted from Magic UI BlurFade; upstream reference: docs/UI-FOUNDATION.md
// Local source distribution; Foliage adaptations are documented in docs/UI-FOUNDATION.md.

/*
 * `"use client"` ADDED BY US. Magic UI shipped this component without the directive, and it uses
 * `useRef`/`useInView` — so importing it from a Server Component fails the build outright with
 * "You're importing a module that depends on `useRef` into a React Server Component module".
 *
 * Marked HERE rather than on the page that imports it, deliberately: the constraint belongs to the
 * component, not to its caller. Putting `"use client"` on the page would drag the whole landing —
 * copy, structure, everything — into the client bundle to satisfy one animation wrapper.
 */
import { useEffect, useRef, useState } from "react"
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  type MotionProps,
  type UseInViewOptions,
  type Variants,
} from "motion/react"

type MarginType = UseInViewOptions["margin"]

interface BlurFadeProps extends MotionProps {
  children: React.ReactNode
  className?: string
  variant?: {
    hidden: { y: number }
    visible: { y: number }
  }
  duration?: number
  delay?: number
  offset?: number
  direction?: "up" | "down" | "left" | "right"
  inView?: boolean
  inViewMargin?: MarginType
  blur?: string
}

const getFilter = (v: Variants[string]) =>
  typeof v === "function" ? undefined : v.filter

export function BlurFade({
  children,
  className,
  variant,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = "down",
  inView = false,
  inViewMargin = "-50px",
  blur = "6px",
  ...props
}: BlurFadeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [ease, setEase] = useState<[number, number, number, number]>()

  useEffect(() => {
    if (!ref.current) return
    const token = getComputedStyle(ref.current).getPropertyValue("--fol-ease-grow").trim()
    const match = /^cubic-bezier\(([^)]+)\)$/.exec(token)
    const values = match?.[1]?.split(",").map(Number)
    if (values?.length === 4 && values.every(Number.isFinite)) {
      setEase(values as [number, number, number, number])
    }
  }, [])
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin })
  const isInView = !inView || inViewResult
  const defaultVariants: Variants = {
    hidden: {
      [direction === "left" || direction === "right" ? "x" : "y"]:
        direction === "right" || direction === "down" ? -offset : offset,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: {
      [direction === "left" || direction === "right" ? "x" : "y"]: 0,
      opacity: 1,
      filter: `blur(0px)`,
    },
  }
  const combinedVariants = variant ?? defaultVariants

  const hiddenFilter = getFilter(combinedVariants.hidden)
  const visibleFilter = getFilter(combinedVariants.visible)

  const shouldTransitionFilter =
    hiddenFilter != null &&
    visibleFilter != null &&
    hiddenFilter !== visibleFilter

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial={false}
        animate={reducedMotion || !ease || isInView ? "visible" : "hidden"}
        exit={reducedMotion ? "visible" : "hidden"}
        variants={combinedVariants}
        transition={{
          delay: reducedMotion || !ease ? 0 : 0.04 + delay,
          duration: reducedMotion || !ease ? 0 : duration,
          ...(ease ? { ease } : {}),
          ...(shouldTransitionFilter ? { filter: { duration: reducedMotion || !ease ? 0 : duration } } : {}),
        }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
