/** Renders a markdown string with the shared prose styling (the single source
 *  of truth for markdown rendering across the changelog/details dialogs and
 *  detail pages). [overflow-wrap:anywhere] wraps long unbroken tokens. */
import Markdown from 'react-markdown'

const MARKDOWN_PROSE_CLASS =
  'prose prose-sm dark:prose-invert max-w-none break-words [overflow-wrap:anywhere]'

export function MarkdownContent({ text }: Readonly<{ text: string }>) {
  return (
    <div className={MARKDOWN_PROSE_CLASS}>
      <Markdown>{text}</Markdown>
    </div>
  )
}
