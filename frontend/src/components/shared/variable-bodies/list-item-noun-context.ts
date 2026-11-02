/**
 * What the rows of a list editor are called (SHRUN-4): a Block list names its rows by its own noun
 * ("argument", "field", "stat"); a list whose host names none says "item".
 */

import { createContext } from 'react'

export const ListItemNounContext = createContext('item')
