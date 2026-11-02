/**
 * Whether a test has anything uploading and whether anything did not land
 * (TDATA-16). The chip carries this with the sheet closed, so it reads the
 * test's own topic; this tab's own uploads are added from the moment they start,
 * before the server has heard about them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { testdataApi } from '@/features/tests/api/testdata'
import type { TestDataUploadState } from '@/features/tests/api/types'
import { alreadyReported } from '@/features/workbench/lib/already-reported'
import { useOwnUploadIds } from '@/features/workbench/stores/testdata-upload-store'
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'
import { TESTDATA_TOPIC_PREFIX, toUploadState } from './use-testdata'

export interface TestDataActivity {
  /** Files on their way in. */
  uploads: number
  /** Files that did not land and that nobody has dismissed. */
  interruptions: number
}

interface ActivityEvent extends Partial<TestDataUploadState> {
  event: string
}

/** What the server reports: the ids on their way in, and how many did not land. */
interface ServerActivity {
  uploads: string[]
  interruptions: number
}

const IDLE: ServerActivity = { uploads: [], interruptions: 0 }

function serverActivityOf(value: Partial<TestDataUploadState>): ServerActivity {
  const state = toUploadState(value)
  return {
    uploads: state.uploads.map((upload) => upload.id),
    interruptions: state.interruptions.length,
  }
}

/** Same set of uploads, same number of notices: nothing the chip shows has moved. */
function unchanged(previous: ServerActivity, next: ServerActivity): boolean {
  return (
    previous.interruptions === next.interruptions &&
    previous.uploads.length === next.uploads.length &&
    previous.uploads.every((id, index) => id === next.uploads[index])
  )
}

/** Keeps the same object while nothing moved, so a progress frame renders nothing. */
function settle(previous: ServerActivity, next: ServerActivity): ServerActivity {
  return unchanged(previous, next) ? previous : next
}

export function useTestDataActivity(testId: string | null): TestDataActivity {
  const [server, setServer] = useState<ServerActivity>(IDLE)
  const own = useOwnUploadIds(testId)
  // Destructured like every other workbench subscriber, so the effect deps stay
  // on isConnected rather than on store function identities.
  const { isConnected, subscribe } = useWebSocketStore()
  const subscribeRef = useRef(subscribe)
  subscribeRef.current = subscribe

  useEffect(() => {
    setServer(IDLE)
    if (testId === null) return
    let dropped = false
    testdataApi
      .uploadState(testId)
      .then((state) => {
        if (!dropped) setServer((previous) => settle(previous, serverActivityOf(state)))
      })
      .catch(alreadyReported)
    return () => {
      dropped = true
    }
  }, [testId])

  const handleEvent = useCallback((payload: ActivityEvent) => {
    if (payload.event !== 'uploads_changed') return
    setServer((previous) => settle(previous, serverActivityOf(payload)))
  }, [])

  useEffect(() => {
    if (testId === null) return
    const subscription = subscribeRef.current<ActivityEvent>(
      `${TESTDATA_TOPIC_PREFIX}${testId}`,
      handleEvent
    )
    return () => subscription.unsubscribe()
  }, [testId, isConnected, handleEvent])

  // The tab's own request is counted before the server has seen it, and only once
  // after it has.
  const uploads = new Set([...server.uploads, ...own]).size
  const { interruptions } = server
  return useMemo(() => ({ uploads, interruptions }), [uploads, interruptions])
}
