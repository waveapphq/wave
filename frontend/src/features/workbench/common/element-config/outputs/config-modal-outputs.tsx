/**
 * ConfigModalOutputs - Output variables section with query editors
 *
 * Renders XML/JSON query editors and the output parameter table.
 */

import { useId, type ReactNode } from 'react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { ParameterTable } from '../parameters/parameter-table'
import { OutputListSection } from './output-list-section'
import { XmlQueryEditor } from '../../editors/xml-query-editor'
import { JsonQueryEditor } from '../../editors/json-query-editor'
import type { OutputTableParameter, EnrichedVariable } from '../types'
import type { OutputListEditState } from '../use-output-list'

interface ConfigModalOutputsProps {
  isXmlParser: boolean
  isJsonParser: boolean
  values: Record<string, unknown>
  setValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  outputParameters: OutputTableParameter[]
  /** Shown under Output Variables when the Block has no outputs; with none, the section is left out. */
  emptyNote?: ReactNode
  outputBindings: Record<string, string>
  outputErrors: Record<string, string>
  enrichedVariables: EnrichedVariable[]
  expressionFields: string[]
  templateFields: string[]
  outputSecretFields: string[]
  setOutputSecretFields: React.Dispatch<React.SetStateAction<string[]>>
  setExpressionFields: React.Dispatch<React.SetStateAction<string[]>>
  handleOutputChange: (name: string, value: unknown) => void
  setXmlQueryValid: (valid: boolean) => void
  setJsonQueryValid: (valid: boolean) => void
  /** The element's author-declared export rows, rendered under the fixed rows. */
  outputList?: OutputListEditState
}

function OutputVariablesSection({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="space-y-3 mt-6">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Output Variables
      </h3>
      {children}
    </div>
  )
}

export function ConfigModalOutputs({
  isXmlParser,
  isJsonParser,
  values,
  setValues,
  outputParameters,
  emptyNote,
  outputBindings,
  outputErrors,
  enrichedVariables,
  expressionFields,
  templateFields,
  outputSecretFields,
  setOutputSecretFields,
  setExpressionFields,
  handleOutputChange,
  setXmlQueryValid,
  setJsonQueryValid,
  outputList,
}: Readonly<ConfigModalOutputsProps>) {
  const outputModeHeadingId = useId()
  if (outputParameters.length === 0) {
    return emptyNote === undefined ? null : <OutputVariablesSection>{emptyNote}</OutputVariablesSection>
  }

  const isParser = isXmlParser || isJsonParser
  const outputMode = String((values.output_mode as string | undefined) ?? 'combined')
  const isIndividual = outputMode === 'individual'

  return (
    <>
      {/* Queries section (parsers) - lifted out of Output Variables */}
      {isXmlParser && (
        <div className="space-y-3 mt-6">
          <XmlQueryEditor
            queries={(values.queries as Record<string, string>) ?? {}}
            expressionFields={expressionFields}
            queryOutputTypes={(values.query_output_types as Record<string, string>) ?? {}}
            outputMode={isIndividual ? 'individual' : outputMode}
            xmlContent={String((values.xml_content as string | undefined) ?? '')}
            xmlContentIsExpression={expressionFields.includes('xml_content') || templateFields.includes('xml_content')}
            availableVariables={enrichedVariables}
            onQueriesChange={(queries) =>
              setValues((prev) => ({ ...prev, queries }))
            }
            onExpressionFieldsChange={setExpressionFields}
            onQueryOutputTypesChange={(types) =>
              setValues((prev) => ({ ...prev, query_output_types: types }))
            }
            onValidChange={setXmlQueryValid}
          />
        </div>
      )}
      {isJsonParser && (
        <div className="space-y-3 mt-6">
          <JsonQueryEditor
            queries={(values.queries as Record<string, string>) ?? {}}
            expressionFields={expressionFields}
            queryOutputTypes={(values.query_output_types as Record<string, string>) ?? {}}
            outputMode={isIndividual ? 'individual' : outputMode}
            jsonContent={String((values.json_content as string | undefined) ?? '')}
            jsonContentIsExpression={expressionFields.includes('json_content') || templateFields.includes('json_content')}
            availableVariables={enrichedVariables}
            onQueriesChange={(queries) =>
              setValues((prev) => ({ ...prev, queries }))
            }
            onExpressionFieldsChange={setExpressionFields}
            onQueryOutputTypesChange={(types) =>
              setValues((prev) => ({ ...prev, query_output_types: types }))
            }
            onValidChange={setJsonQueryValid}
          />
        </div>
      )}

      {/* Output Mode section (parsers) - mirrors the Assert Branching Mode */}
      {isParser && (
        <div className="space-y-3 mt-6">
          <h3 id={outputModeHeadingId} className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Output Mode
          </h3>
          <RadioGroup
            aria-labelledby={outputModeHeadingId}
            value={outputMode}
            onValueChange={(v) => setValues((prev) => ({ ...prev, output_mode: v }))}
            className="space-y-2"
          >
            <div className="flex items-start gap-2">
              <RadioGroupItem value="combined" id="output-mode-combined" className="mt-0.5" />
              <div>
                <Label htmlFor="output-mode-combined" className="cursor-pointer font-medium">
                  Combined
                </Label>
                <p className="text-xs text-muted-foreground">
                  All query results returned together in a single results map.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <RadioGroupItem value="individual" id="output-mode-individual" className="mt-0.5" />
              <div>
                <Label htmlFor="output-mode-individual" className="cursor-pointer font-medium">
                  Individual
                </Label>
                <p className="text-xs text-muted-foreground">
                  Each query result becomes its own output variable, with optional per-query type coercion.
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>
      )}

      {/* Output Variables section - the bindings only */}
      <OutputVariablesSection>
        <ParameterTable
          mode="output"
          parameters={outputParameters}
          values={outputBindings}
          onChange={handleOutputChange}
          availableVariables={enrichedVariables}
          fieldErrors={outputErrors}
          secretFields={outputSecretFields}
          onSecretFieldsChange={setOutputSecretFields}
        />
        {outputList && (
          <OutputListSection {...outputList} availableVariables={enrichedVariables} />
        )}
      </OutputVariablesSection>
    </>
  )
}
