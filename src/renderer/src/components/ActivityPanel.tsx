import type { WorkbenchView } from '../hooks/useWorkbench.ts'
import { Icon } from '../Icon.tsx'

export function ActivityPanel({ model }: { model: WorkbenchView }) {
  const { state } = model
  return (
    <section className="activity-panel">
      <div className="section-heading">
        <h2>Recent activity</h2>
        <Icon name="clock" size={16} />
      </div>
      <div className="activity-list">
        {state.activity.slice(0, 4).map((entry) => (
          <div className="activity-row" key={entry.id}>
            <span className={`status-dot ${entry.level === 'error' ? 'error-dot' : ''}`} />
            <p>{entry.message}</p>
            <time>{new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time>
          </div>
        ))}
      </div>
    </section>
  )
}
