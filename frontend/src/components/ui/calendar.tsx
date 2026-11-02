import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, type DayPickerProps } from 'react-day-picker'
import 'react-day-picker/style.css'

import { cn } from '@/lib/utils'

export type CalendarProps = DayPickerProps

function CalendarChevron({ orientation }: { orientation?: 'left' | 'right' | 'up' | 'down' }) {
  return orientation === 'left' ? (
    <ChevronLeft className="h-4 w-4" />
  ) : (
    <ChevronRight className="h-4 w-4" />
  )
}

export function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  ...props
}: Readonly<CalendarProps>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3 text-sm', className)}
      classNames={{
        months: 'flex flex-col gap-4',
        month: 'flex flex-col gap-2',
        month_caption: 'flex items-center justify-center pt-1 pb-2 relative',
        caption_label: 'text-sm font-medium',
        nav: 'flex items-center gap-1',
        button_previous:
          'absolute left-2 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-transparent p-0 opacity-70 hover:opacity-100 hover:bg-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30 disabled:cursor-not-allowed',
        button_next:
          'absolute right-2 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-transparent p-0 opacity-70 hover:opacity-100 hover:bg-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-30 disabled:cursor-not-allowed',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'w-9 text-[0.75rem] font-normal text-muted-foreground text-center',
        week: 'flex w-full mt-1',
        day: 'relative p-0 text-center align-middle h-9 w-9 focus-within:relative focus-within:z-20',
        day_button:
          'inline-flex h-9 w-9 items-center justify-center rounded-md p-0 text-sm font-normal bg-transparent hover:bg-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        range_start:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-l-md [&>button]:rounded-r-none [&>button]:hover:bg-primary',
        range_end:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-r-md [&>button]:rounded-l-none [&>button]:hover:bg-primary',
        range_middle:
          '[&>button]:bg-primary/25 [&>button]:text-foreground [&>button]:rounded-none [&>button]:hover:bg-primary/30',
        today: '[&>button]:underline [&>button]:font-semibold',
        outside: '[&>button]:text-muted-foreground/50',
        disabled: '[&>button]:text-muted-foreground/40 [&>button]:cursor-not-allowed',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: CalendarChevron,
        ...components,
      }}
      {...props}
    />
  )
}
