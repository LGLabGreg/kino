'use client'

import type { SectionHeadingLevel } from '@/registry/lib/section-heading'
import type { CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Integrations blocks share: a tool your product works with, its
 * mark on a tile, and the section they stand in.
 */

/** A tool's mark: a square picture, drawn in the text colour through its shape. */
interface IntegrationLogo {
  /**
   * An SVG or a PNG with a clear background. Its shape is drawn in the text
   * colour, as a CSS mask, so a picture on another site must be served with
   * CORS (`Access-Control-Allow-Origin`), or it draws nothing.
   */
  src: string
  /** The picture's width and height in any unit: only their ratio is used. */
  width: number
  height: number
}

/** A tool your product works with. */
interface Integration {
  /** Tells the tools apart. */
  value: string
  name: string
  /** What it does with your product, in a line: searched with its name. */
  description: string
  logo: IntegrationLogo
  /** Its page: how to set it up. */
  href: string
}

/** What every Integrations block takes, its tools aside. */
interface IntegrationsSectionProps {
  title: ReactNode
  /** A few words above the title that name the topic. */
  eyebrow?: ReactNode
  description?: ReactNode
  /** The title's level: `h2` under the page's `h1`. */
  heading?: SectionHeadingLevel
}

/** The section every arrangement stands in, laid out by its own width. */
const integrationsSectionClassName =
  '@container/integrations relative isolate flex w-full min-w-0 flex-col overflow-x-clip bg-background'

/**
 * A tool's mark, drawn in the text colour through its picture's shape, so it
 * follows the theme. It is the tool's picture beside its name, so it says
 * nothing itself; one with no name beside it takes `label`.
 */
function IntegrationMark({
  logo,
  label,
  className,
}: {
  logo: IntegrationLogo
  /** The tool's name, where nothing beside the mark says it. */
  label?: string
  className?: string
}) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-slot='integration-mark'
      style={
        {
          '--integration-src': `url(${JSON.stringify(logo.src)})`,
          aspectRatio: `${logo.width} / ${logo.height}`,
        } as CSSProperties
      }
      className={cn(
        // The shape of the picture, filled with the text colour; forced colours take the text's system colour.
        'block shrink-0 bg-current [mask:var(--integration-src)_center/contain_no-repeat] forced-colors:bg-[CanvasText]',
        className,
      )}
    />
  )
}

/** A tool's mark on its tile, as an app's icon sits: the card's and the hub's. */
function IntegrationTile({
  logo,
  label,
  className,
}: {
  logo: IntegrationLogo
  label?: string
  className?: string
}) {
  return (
    <span
      data-slot='integration-tile'
      className={cn(
        'bg-card text-foreground grid size-10 shrink-0 place-items-center rounded-(--control-radius-capped) border shadow-xs',
        className,
      )}
    >
      <IntegrationMark logo={logo} label={label} className='h-1/2' />
    </span>
  )
}

export {
  type Integration,
  type IntegrationLogo,
  IntegrationMark,
  integrationsSectionClassName,
  type IntegrationsSectionProps,
  IntegrationTile,
}
