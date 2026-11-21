'use client'

import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import { pageColumnClassName } from '@/registry/lib/hero-parts'
import type { SectionHeadingLevel } from '@/registry/lib/section-heading'
import type { ComponentProps, CSSProperties, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * What the Logo cloud blocks share: a customer's logo, drawn in the text
 * colour at a size that gives every logo the same area, the line over the
 * logos, and the section they stand in.
 */

/** A customer's logo: a picture of it, and its size, so it takes its room before it loads. */
interface CustomerLogo {
  /** The company's name, read out in place of the logo. */
  name: string
  /**
   * An SVG or a PNG with a clear background. Its shape is drawn in the text
   * colour, as a CSS mask, so a picture on another site must be served with
   * CORS (`Access-Control-Allow-Origin`), or it draws nothing.
   */
  src: string
  /** The picture's width and height in any unit: only their ratio is used. */
  width: number
  height: number
  /** Where their story is told, such as a case study: the logo leads there. */
  href?: string
}

/** What every Logo cloud block takes. */
interface LogoCloudProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  /** The line over the logos, such as Trusted by the teams behind… */
  title: ReactNode
  /** The title's level: `h2` under the page's `h1`. */
  heading?: SectionHeadingLevel
  logos: CustomerLogo[]
}

/** The section every arrangement stands in, laid out by its own width. */
const logoCloudSectionClassName =
  '@container/logo-cloud relative isolate flex w-full min-w-0 flex-col overflow-x-clip bg-background'

/** The column the line and the logos sit in, with a strip's room above and below. */
const logoCloudColumnClassName = cn(pageColumnClassName, 'py-12 @3xl:py-16')

/**
 * How wide a logo is beside a square one of the same area, from its width
 * and height: the square root of its ratio. A logo four times as wide as it
 * is tall is twice as wide as the square and half as tall, so long wordmarks
 * and compact marks read at the same weight.
 */
function logoScale({ width, height }: Pick<CustomerLogo, 'width' | 'height'>) {
  if (!(width > 0) || !(height > 0)) return 1
  return Math.sqrt(width / height)
}

/**
 * A logo, drawn in the text colour through its picture's shape, so it
 * follows the theme and the hover colour around it. Its area is the square
 * of `--logo-cloud-size` (2.5rem on a phone to 3.25rem on a page, unless set on it or anything above it),
 * and it never grows wider than its box.
 */
function LogoCloudLogo({ logo, className }: { logo: CustomerLogo; className?: string }) {
  return (
    <span
      role='img'
      aria-label={logo.name}
      data-slot='logo-cloud-logo'
      style={
        {
          '--logo-cloud-src': `url(${JSON.stringify(logo.src)})`,
          aspectRatio: `${logo.width} / ${logo.height}`,
          width: `calc(var(--logo-cloud-size,clamp(2.5rem,7cqi,3.25rem))*${logoScale(logo).toFixed(4)})`,
        } as CSSProperties
      }
      className={cn(
        // The shape of the picture, filled with the text colour; forced colours take the text's system colour.
        'block max-w-full shrink-0 bg-current [mask:var(--logo-cloud-src)_center/contain_no-repeat] forced-colors:bg-[CanvasText]',
        className,
      )}
    />
  )
}

/** The line over the logos: small and quiet, as the logos are the proof. */
function LogoCloudTitle({
  id,
  title,
  heading = 'h2',
  className,
}: {
  id: string
  title: ReactNode
  heading?: SectionHeadingLevel
  className?: string
}) {
  const Title = heading
  return (
    <Title
      id={id}
      className={cn(
        'text-muted-foreground text-center text-sm font-medium text-balance',
        className,
      )}
    >
      <bdi>{title}</bdi>
    </Title>
  )
}

/** A logo that leads to its customer's story: the whole box is the link, named "Tessel: read their story". */
function LogoCloudLink({
  logo,
  className,
  children,
}: {
  logo: CustomerLogo & { href: string }
  className?: string
  children: ReactNode
}) {
  return (
    <a
      href={logo.href}
      // The logo inside is its picture; the link says where it leads.
      aria-label={`${logo.name}: read their story`}
      data-slot='logo-cloud-link'
      className={cn(
        'group/logo relative focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden',
        className,
      )}
    >
      {children}
    </a>
  )
}

/**
 * The arrow at a linked box's top end, that says it leads to a story before
 * a pointer finds it, and nudges out while the link is hovered.
 */
function LogoCloudStoryArrow() {
  return (
    <IconPlaceholder
      lucide='ArrowUpRightIcon'
      tabler='IconArrowUpRight'
      hugeicons='ArrowUpRight01Icon'
      phosphor='ArrowUpRightIcon'
      remixicon='RiArrowRightUpLine'
      aria-hidden
      className='text-muted-foreground group-hover/logo:text-foreground absolute end-3 top-3 size-4 transition-[color,translate] duration-(--motion-press-duration) ease-[var(--motion-press-fade-easing),var(--motion-press-easing)] group-hover/logo:translate-x-0.5 group-hover/logo:-translate-y-0.5 motion-reduce:transition-[color] rtl:-scale-x-100 rtl:group-hover/logo:-translate-x-0.5'
    />
  )
}

export {
  type CustomerLogo,
  logoCloudColumnClassName,
  LogoCloudLink,
  LogoCloudLogo,
  LogoCloudStoryArrow,
  type LogoCloudProps,
  logoCloudSectionClassName,
  LogoCloudTitle,
  logoScale,
}
