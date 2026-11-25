'use client'

import { agentTools, createAgent, registerTools } from '@ui-sdk/react/agent'
import { useEffect } from 'react'

type Agent = ReturnType<typeof createAgent>
type AgentAllow = NonNullable<NonNullable<Parameters<typeof createAgent>[0]>['allow']>

let agent: Agent | null = null

/** The page's agent bridge, once an `AgentBridge` has mounted, or null before. */
function getAgent() {
  return agent
}

/**
 * Lets an agent read the components on the page and change them through their
 * own APIs. Render it once, near the root. It creates the bridge the first
 * time it mounts, with `allow` deciding every step any agent asks for, your
 * model's and the browser's own alike, and offers the bridge's tools to the
 * browser's agent where the browser has WebMCP.
 */
function AgentBridge({ allow }: { allow?: AgentAllow }) {
  useEffect(() => {
    agent ??= createAgent(allow ? { allow } : {})
    // ui-sdk runs the bridge's `allow` first, so with one this would ask again; without one it keeps the person's steps theirs.
    return registerTools(agent, { allow: allow ? () => true : (step) => !step.confirm })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `allow` is read once: the bridge can't take another after it is created
  }, [])
  return null
}

export { AgentBridge, agentTools, getAgent }
export type { AgentAllow }
