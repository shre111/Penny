import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, CircleAlert } from 'lucide-react'
import type { ActivityEvent, Artifact, ChatMessage, InterruptAction } from '../../lib/types'
import { CoinMark, Spinner } from '../ui'
import { ApprovalCard, ChartCard, ExtractionCard, InvoiceListCard } from './cards'

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (!events.length) return null
  return (
    <ul className="space-y-1 mb-2" aria-label="What Penny did">
      {events.map((e) => (
        <li key={e.id} className="flex items-center gap-2 text-xs text-ink-soft animate-fade-up">
          {e.status === 'running' ? (
            <Spinner className="h-3 w-3 text-copper-500" />
          ) : e.status === 'error' ? (
            <CircleAlert className="h-3.5 w-3.5 text-danger-500" />
          ) : (
            <Check className="h-3.5 w-3.5 text-brand-500" />
          )}
          <span>{e.label}</span>
          {e.agent && (
            <span className="rounded-full bg-stone-100 px-1.5 py-px text-[10px] font-semibold text-ink-soft/80">{e.agent}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Artifacts({
  artifacts,
  messageId,
  onPatchArtifact,
}: {
  artifacts: Artifact[]
  messageId: string
  onPatchArtifact?: (messageId: string, index: number, patch: Record<string, any>) => void
}) {
  return (
    <>
      {artifacts.map((a, i) => {
        if (a.type === 'chart') return <ChartCard key={i} data={a.data} />
        if (a.type === 'invoices') return <InvoiceListCard key={i} data={a.data} />
        if (a.type === 'extraction')
          return (
            <ExtractionCard
              key={i}
              data={a.data}
              onAdded={(patch) => onPatchArtifact?.(messageId, i, patch)}
            />
          )
        return null
      })}
    </>
  )
}

const mdComponents = {
  p: (props: any) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
  ul: (props: any) => <ul className="list-disc ml-5 mb-2 space-y-1" {...props} />,
  ol: (props: any) => <ol className="list-decimal ml-5 mb-2 space-y-1" {...props} />,
  a: (props: any) => <a className="text-brand-700 underline" target="_blank" rel="noreferrer" {...props} />,
  strong: (props: any) => <strong className="font-bold" {...props} />,
  table: (props: any) => <table className="w-full text-[13px] border border-line rounded-lg overflow-hidden mb-2" {...props} />,
  th: (props: any) => <th className="text-left bg-paper/70 px-2.5 py-1.5 text-xs border-b border-line" {...props} />,
  td: (props: any) => <td className="px-2.5 py-1.5 border-b border-line/50" {...props} />,
  code: (props: any) => <code className="bg-stone-100 rounded px-1 py-0.5 text-[0.85em]" {...props} />,
}

export function MessageView({
  message,
  isStreaming = false,
  onResume,
  onPatchArtifact,
}: {
  message: Pick<ChatMessage, 'role' | 'content' | 'events' | 'artifacts'> & {
    _id?: string
    interrupt?: { actions: InterruptAction[]; status: 'pending' | 'resolved'; decisions?: string[] }
  }
  isStreaming?: boolean
  onResume?: (messageId: string, decisions: any[]) => void
  onPatchArtifact?: (messageId: string, index: number, patch: Record<string, any>) => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-700 text-white px-4 py-2.5 text-[0.95rem] whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2.5 animate-fade-up">
      <div className="shrink-0 mt-0.5">
        <CoinMark size={28} />
      </div>
      <div className="min-w-0 flex-1">
        <ActivityFeed events={message.events || []} />
        {message.content ? (
          <div className="text-[0.95rem] text-ink">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {message.content}
            </ReactMarkdown>
            {isStreaming && <span className="inline-block w-1.5 h-4 bg-copper-500 align-text-bottom animate-pulse ml-0.5" />}
          </div>
        ) : isStreaming && !(message.events || []).length ? (
          <div className="flex items-center gap-2 text-sm text-ink-soft py-1">
            <Spinner className="h-3.5 w-3.5 text-copper-500" /> Penny is thinking…
          </div>
        ) : null}
        <Artifacts artifacts={message.artifacts || []} messageId={message._id || ''} onPatchArtifact={onPatchArtifact} />
        {message.interrupt && (
          <ApprovalCard
            actions={message.interrupt.actions}
            status={message.interrupt.status}
            resolvedNote={message.interrupt.status === 'resolved' ? 'You already handled this one' : undefined}
            onResolve={(decisions) => message._id && onResume?.(message._id, decisions)}
          />
        )}
      </div>
    </div>
  )
}
