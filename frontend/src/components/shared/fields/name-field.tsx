/**
 * Specialized name input. Composes TextField with name-flavored defaults:
 *   - default `maxLength` = MAX_ELEMENT_NAME_LENGTH (64)
 *   - counter on by default
 *   - no trim, no empty-rejection
 */

import { TextField, type TextFieldProps } from './text-field'
import { MAX_ELEMENT_NAME_LENGTH } from '@/lib/field-constraints'

export type NameFieldProps = Omit<TextFieldProps, 'showCount'>

export function NameField({
  maxLength = MAX_ELEMENT_NAME_LENGTH,
  ...rest
}: Readonly<NameFieldProps>) {
  return <TextField {...rest} maxLength={maxLength} showCount />
}
