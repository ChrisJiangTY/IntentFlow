/** Route right-Chat intent submissions to the host Requirements methods. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  RequirementAuthoringLanguage,
  RequirementRoundStartRequest,
} from '@deepseek-ai/dsh-session-requirements/client'

interface RequirementsComposerRemote {
  startRound(sessionId: SessionId, request: RequirementRoundStartRequest): Promise<{ readonly ok: boolean }>
  appendRequirement(sessionId: SessionId, request: RequirementRoundStartRequest): Promise<{ readonly ok: boolean }>
  startTaskRound(sessionId: SessionId, request: RequirementRoundStartRequest): Promise<{ readonly ok: boolean }>
}

type RequirementsComposerActions = Readonly<{
  submit: (sessionId: SessionId, input: string) => Promise<boolean>
  appendRequirement: (sessionId: SessionId, input: string) => Promise<boolean>
  startTaskRound: (sessionId: SessionId, input: string) => Promise<boolean>
}>

/**
 * Bind one intent route to the current locale and generated host Remotes.
 * @param remote - Requirements methods; rejected results return false to keep the draft in Chat.
 * @param language - Current authoring language read when each prompt is submitted.
 * @returns Three submission callbacks that preserve the selected Session identity.
 */
export function createRequirementsComposer(
  remote: RequirementsComposerRemote,
  language: () => RequirementAuthoringLanguage,
): RequirementsComposerActions {
  const request = (input: string): RequirementRoundStartRequest => ({ input, language: language() })
  return {
    submit: async (sessionId: SessionId, input: string): Promise<boolean> =>
      (await remote.startRound(sessionId, request(input))).ok,
    appendRequirement: async (sessionId: SessionId, input: string): Promise<boolean> =>
      (await remote.appendRequirement(sessionId, request(input))).ok,
    startTaskRound: async (sessionId: SessionId, input: string): Promise<boolean> =>
      (await remote.startTaskRound(sessionId, request(input))).ok,
  }
}
