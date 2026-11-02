/** What saving seals a secret: the Test, or the library Function a View shows. */
export type SecretSaveTarget = 'test' | 'Function'

/** The one sentence saying a secret's value shows until its save seals it. */
export function secretStaysVisibleText(saveTarget: SecretSaveTarget): string {
  return `Secret value stays visible until you save the ${saveTarget}.`
}

/** The amber strip over a secret whose value its saved definition does not hold yet, saying when it re-masks. */
export function SecretVisibilityNotice({ saveTarget }: Readonly<{ saveTarget: SecretSaveTarget }>) {
  return (
    <output
      data-testid="inspect-secret-notice"
      className="block border-t border-amber-500/20 bg-amber-500/[0.06] px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300"
    >
      {secretStaysVisibleText(saveTarget)}
    </output>
  )
}
