/**
 * Quick Insert (Ctrl+Space) shared selectors and Function-half waits.
 *
 * The built-in rows filter in the browser and settle on the first beat; the
 * published-Function half is paged and searched on the server (CANVAS-241) and
 * arrives a beat later. A row count taken before that answer lands therefore
 * says nothing about the Functions, which is why every Function assertion goes
 * through one of the waits below.
 */

import type { Page } from './playwright-fixtures'

export const QUICK_ADD_POPOVER = '[data-testid="quick-add-popover"]'
export const QUICK_ADD_LIST = '[data-testid="quick-add-list"]'
export const QUICK_ADD_ROWS = `${QUICK_ADD_POPOVER} [data-slot="command-item"]`
export const QUICK_ADD_STATUS = '[data-testid="quick-add-functions-status"]'
export const QUICK_ADD_INPUT = `${QUICK_ADD_POPOVER} input`

/** One answered page of the Function half. */
export interface QuickAddFunctionsPage {
  /** Server total for the applied search, which the status line reports. */
  total: number
  /** Names this page carried, in server order. */
  names: string[]
}

/**
 * Resolve when GET /functions answers for `search` (and for `page`, when
 * given). An absent `search` param counts as the empty search, which is what
 * opening the window issues.
 */
export function quickAddFunctionsResponse(
  page: Page,
  params: { search?: string; page?: number } = {},
) {
  return page.waitForResponse((response) => {
    const url = response.url()
    if (!url.includes('/functions?')) return false
    const query = new URL(url).searchParams
    if (params.search !== undefined && (query.get('search') ?? '') !== params.search) {
      return false
    }
    return params.page === undefined || query.get('page') === String(params.page)
  })
}

/** Type a query into Quick Insert and wait for the Function half to answer it. */
export async function applyQuickAddSearch(
  page: Page,
  search: string,
): Promise<QuickAddFunctionsPage> {
  const answered = quickAddFunctionsResponse(page, { search, page: 1 })
  await page.locator(QUICK_ADD_INPUT).fill(search)
  const body = await (await answered).json()
  return {
    total: body.pagination.total as number,
    names: (body.data as Array<{ name: string }>).map((fn) => fn.name),
  }
}

/** Drive the list to its bottom, which is what asks for the next page. */
export async function scrollQuickAddListToBottom(page: Page): Promise<void> {
  await page.locator(QUICK_ADD_LIST).evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
}
