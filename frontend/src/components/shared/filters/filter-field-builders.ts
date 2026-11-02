/**
 * Shared builders for common FilterField configurations.
 *
 * Reduces duplication across list filter components that share
 * the status multi-select pattern.
 */

import type { FilterField, FilterOption } from '@/components/shared/filters/entity-filters'

/** Build a standard Status multi-select filter field. */
export function buildStatusField(
  options: FilterOption[],
  selectedValues: string[],
): FilterField {
  return {
    key: 'status',
    placeholder: 'Status',
    countLabel: 'statuses',
    countLabelSingular: 'status',
    testId: 'filter-status',
    ariaLabel: 'Filter by status',
    buttonWidth: 'w-[140px]',
    searchPlaceholder: 'Search status…',
    emptyMessage: 'No status found.',
    options,
    mode: 'multi',
    selectedValues,
  }
}

/** Entity-type options shared by the executions and reports filters. */
export const ENTITY_TYPE_OPTIONS: FilterOption[] = [
  { value: 'test', label: 'Test' },
  { value: 'suite', label: 'Suite' },
  { value: 'regression', label: 'Regression' },
]

/** Build the standard entity Type multi-select filter field. */
export function buildTypeField(selectedValues: string[]): FilterField {
  return {
    key: 'type',
    placeholder: 'Type',
    countLabel: 'types',
    countLabelSingular: 'type',
    testId: 'filter-type',
    ariaLabel: 'Filter by type',
    buttonWidth: 'w-[140px]',
    searchPlaceholder: 'Search type…',
    emptyMessage: 'No type found.',
    options: ENTITY_TYPE_OPTIONS,
    mode: 'multi',
    selectedValues,
  }
}

/** Build the standard triggered-by User multi-select filter field. */
export function buildUserField(
  options: FilterOption[],
  selectedValues: string[],
): FilterField {
  return {
    key: 'user',
    placeholder: 'User',
    countLabel: 'users',
    countLabelSingular: 'user',
    testId: 'filter-user',
    ariaLabel: 'Filter by user',
    buttonWidth: 'w-[140px]',
    searchPlaceholder: 'Search users…',
    emptyMessage: 'No users found.',
    options,
    mode: 'multi',
    selectedValues,
  }
}
