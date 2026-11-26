'use client'

import { Button } from '@/registry/components/kino/button'
import { CopyButton } from '@/registry/components/kino/copy-button'
import { Tabs, TabsPanel, TabsList, TabsTab } from '@/registry/components/kino/tabs'
import type { TooltipContentProps } from '@/registry/components/kino/tooltip'
import { IconPlaceholder } from '@/registry/icons/icon-placeholder'
import {
  type CodeBlockProps,
  type CodeFile,
  CodeLines,
  CodeScroller,
  fileValue,
  useCodeTokens,
} from '@/registry/lib/code-lines'
import { useControllable } from '@/registry/lib/controllable'
import { CutTooltip } from '@/registry/lib/cut'
import { bringTopBack } from '@/registry/lib/fold'
import { followHeight } from '@/registry/lib/resize'
import { codeLines, languageName } from '@/registry/lib/syntax'
import { useEffect, useId, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/*
 * Code in a panel: a header names the file, or holds a tab for each one,
 * with the Copy button at its end, and the lines sit under it. A long file
 * shows its first lines and a footer that shows all of them.
 */

/** Lines past the collapsed ones that aren't worth hiding: showing them costs less than a click. */
const COLLAPSE_SLACK = 3

function FileIcon() {
  return (
    <IconPlaceholder
      lucide='FileCodeIcon'
      tabler='IconFileCode'
      hugeicons='FileScriptIcon'
      phosphor='FileCodeIcon'
      remixicon='RiFileCodeLine'
      aria-hidden
      className='text-muted-foreground size-4 shrink-0'
    />
  )
}

function CodeBody({
  file,
  lineNumbers,
  labelledBy,
  collapsed,
  collapsedLines,
  id,
}: {
  file: CodeFile
  lineNumbers: boolean
  labelledBy?: string
  collapsed: boolean
  collapsedLines?: number
  id: string
}) {
  const lines = useCodeTokens(file.code, file.language, file.tokens)
  return (
    <CodeScroller
      id={id}
      label={file.label ?? `${file.title ?? languageName(file.language)} code`}
      labelledBy={file.label ? undefined : labelledBy}
      collapsed={collapsed}
      collapsedLines={collapsedLines}
      className='bg-muted/50'
    >
      <CodeLines
        lines={lines}
        lineNumbers={lineNumbers}
        startLine={file.startLine}
        highlighted={file.highlighted}
        added={file.added}
        removed={file.removed}
      />
    </CodeScroller>
  )
}

/** Tabs when there are several files; a single file is just its header and lines. */
function FileSwitch({
  tabbed,
  value,
  onValueChange,
  children,
}: {
  tabbed: boolean
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  if (!tabbed) return <div className='flex min-w-0 flex-col'>{children}</div>
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(String(next))}
      className='gap-0'
    >
      {children}
    </Tabs>
  )
}

/** A file's tab panel, when there are tabs. The lines scroll as their own region: no second stop for the keyboard. */
function FilePanel({
  tabbed,
  value,
  className,
  children,
}: {
  tabbed: boolean
  value: string
  className?: string
  children: ReactNode
}) {
  if (!tabbed) return children
  return (
    <TabsPanel value={value} tabIndex={-1} className={className}>
      {children}
    </TabsPanel>
  )
}

function CodeBlock({
  files,
  value: valueProp,
  defaultValue,
  onValueChange,
  lineNumbers = false,
  collapsedLines,
  expanded: expandedProp,
  defaultExpanded = false,
  onExpandedChange,
  label = 'Files',
  tooltipProps,
  onCopy,
  streaming = false,
  className,
}: CodeBlockProps & {
  /** The code is still arriving: each line shows as it lands, with no glide, and Copy waits until it has all of it. */
  streaming?: boolean
  /** Props for the Copy button's tooltip, as the Copy button takes them. */
  tooltipProps?: Omit<TooltipContentProps, 'children'>
  /** Called when the Copy button is pressed, with the file it copies. */
  onCopy?: (file: CodeFile) => void
}) {
  const id = useId()
  const [value, setValue] = useControllable(
    valueProp,
    defaultValue ?? fileValue(files[0]),
    onValueChange,
  )
  const [expanded, setExpanded] = useControllable(
    expandedProp,
    defaultExpanded,
    onExpandedChange,
  )
  const active = files.find((file) => fileValue(file) === value) ?? files[0]
  const lineCount = codeLines(active.code).length
  const collapsible =
    collapsedLines !== undefined && lineCount > collapsedLines + COLLAPSE_SLACK
  const collapsed = collapsible && !expanded
  const tabbed = files.length > 1

  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // A file longer or shorter than the last moves the block to its height.
  useEffect(() => {
    const body = bodyRef.current
    const inner = body?.firstElementChild
    if (!body || !(inner instanceof HTMLElement)) return
    // A fold moves the lines' own box: the body takes each of its frames as they come.
    // Code still arriving lands at once, or a glide would hide lines that have come.
    return followHeight(body, inner, {
      instant: () =>
        body.querySelector('[data-moving]') !== null ||
        rootRef.current?.hasAttribute('data-streaming') === true,
    })
  }, [])

  const toggle = () => {
    const root = rootRef.current
    if (expanded && root) bringTopBack(root)
    setExpanded(!expanded)
  }

  const scrollerId = `${id}-${fileValue(active)}`
  const titleId = `${id}-title`

  return (
    <div
      ref={rootRef}
      data-slot='code-block'
      data-streaming={streaming ? '' : undefined}
      className={cn(
        'bg-card text-card-foreground flex min-w-0 flex-col overflow-clip rounded-(--surface-radius) border text-sm',
        className,
      )}
    >
      <FileSwitch tabbed={tabbed} value={fileValue(active)} onValueChange={setValue}>
        <div
          data-slot='code-block-header'
          className='flex min-h-(--control-height-lg) min-w-0 items-center gap-2 border-b ps-(--surface-padding) pe-1.5'
        >
          {tabbed ? (
            <TabsList
              variant='line'
              aria-label={label}
              className='min-w-0 flex-1 self-end'
            >
              {files.map((file) => (
                <TabsTab
                  key={fileValue(file)}
                  value={fileValue(file)}
                  className={cn('text-xs', file.title !== undefined && 'font-mono')}
                >
                  {file.title ?? languageName(file.language)}
                </TabsTab>
              ))}
            </TabsList>
          ) : (
            <>
              {active.title !== undefined ? <FileIcon /> : null}
              <CutTooltip
                render={
                  <span
                    id={titleId}
                    data-cut
                    dir='auto'
                    className={cn(
                      'min-w-0 flex-1 truncate text-xs',
                      active.title !== undefined
                        ? 'font-mono'
                        : 'text-muted-foreground font-medium',
                    )}
                  >
                    {active.title ?? languageName(active.language)}
                  </span>
                }
              />
            </>
          )}
          <CopyButton
            value={active.code}
            size='icon-sm'
            aria-label='Copy code'
            tooltipProps={tooltipProps}
            onClick={() => onCopy?.(active)}
            disabled={streaming}
            className='shrink-0'
          />
        </div>
        <div
          ref={bodyRef}
          data-slot='code-block-body'
          className='min-w-0 overflow-clip transition-[height] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none'
        >
          <div>
            {files.map((file) => (
              <FilePanel
                key={fileValue(file)}
                tabbed={tabbed}
                value={fileValue(file)}
                className='rounded-none'
              >
                <CodeBody
                  file={file}
                  id={`${id}-${fileValue(file)}`}
                  lineNumbers={lineNumbers}
                  labelledBy={tabbed ? undefined : titleId}
                  collapsed={collapsed}
                  collapsedLines={collapsible ? collapsedLines : undefined}
                />
              </FilePanel>
            ))}
          </div>
        </div>
      </FileSwitch>
      {collapsible ? (
        <div data-slot='code-block-footer' className='border-t p-1'>
          <Button
            variant='ghost'
            size='sm'
            aria-expanded={expanded}
            aria-controls={scrollerId}
            onClick={toggle}
            className='text-muted-foreground hover:text-foreground w-full'
          >
            <IconPlaceholder
              lucide='ChevronDownIcon'
              tabler='IconChevronDown'
              hugeicons='ArrowDown01Icon'
              phosphor='CaretDownIcon'
              remixicon='RiArrowDownSLine'
              aria-hidden
              data-icon='inline-start'
              className={cn(
                'transition-[rotate] duration-(--motion-layout-duration) ease-(--motion-layout-easing) motion-reduce:transition-none',
                expanded && 'rotate-180',
              )}
            />
            {expanded ? 'Show fewer lines' : `Show all ${lineCount} lines`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export { CodeBlock }
