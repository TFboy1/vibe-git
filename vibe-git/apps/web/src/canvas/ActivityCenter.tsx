import type { V20BootstrapPayload } from "@vibe-git/protocol";
import { deriveUnreadActivity, type InspectorTarget } from "./model";
export function ActivityCenter({
  data,
  read,
  close,
  open,
  markRead,
}: {
  data: V20BootstrapPayload;
  read: Set<string>;
  close: () => void;
  open: (target: InspectorTarget) => void;
  markRead: (id: string) => Promise<void>;
}) {
  const unread = deriveUnreadActivity(data, read);
  return (
    <section className="activity-center" aria-label="活动通知">
      <header>
        <h3>活动通知 · {unread.length} 未读</h3>
        <button onClick={close} aria-label="关闭通知">
          ×
        </button>
      </header>
      {["今天", "昨天", "更早"].map((group, index) => {
        const entries = data.notifications.filter((n) => {
          const age = Math.floor(
            (new Date().setHours(0, 0, 0, 0) -
              new Date(n.createdAt).setHours(0, 0, 0, 0)) /
              86400000,
          );
          return index === 0 ? age <= 0 : index === 1 ? age === 1 : age > 1;
        });
        return entries.length ? (
          <section key={group}>
            <h4>{group}</h4>
            {entries.map((n) => (
              <button
                key={n.id}
                className="object-row"
                onClick={() => {
                  const c = data.pullRequests.find((c) => c.id === n.entityId);
                  const t = data.tasks.find((t) => t.id === n.entityId);
                  const member = data.nodes.find(
                    (member) => member.id === n.entityId,
                  );
                  const plan = data.plans.find((p) => p.id === n.entityId);
                  open(
                    c
                      ? { type: "change", id: c.id }
                      : t
                        ? { type: "task", id: t.id }
                        : member
                          ? { type: "member", id: member.id }
                          : plan
                            ? {
                                type: "member",
                                id: plan.ownerNodeId,
                                tab: "plan",
                              }
                            : {
                                type: "project",
                                id: "project",
                                tab: n.type === "REVIEW" ? "review" : "stage",
                              },
                  );
                  void markRead(n.id);
                }}
              >
                <span>
                  <b>
                    {unread.some((u) => u.id === n.id) ? "● " : ""}
                    {n.title}
                  </b>
                  <small>{n.body}</small>
                </span>
              </button>
            ))}
          </section>
        ) : null;
      })}
      {!data.notifications.length && <p>暂无通知。</p>}
    </section>
  );
}
