import { failureMessage } from "./api";
import { ref, watch } from "vue";
import type { RoomEvent } from "@vibe-git/protocol";
import type { workspaceConnection } from "./connection";

const LIMIT = 500;
export function useActivities(key: () => { room?: string; flow?: string }, connection: ReturnType<typeof workspaceConnection>) {
  const activities = ref<RoomEvent[]>([]), moreActivities = ref(false), activityError = ref("");
  const browsingActivities = ref(false), newActivities = ref(0), loadingActivities = ref(false);
  let generation = 0;
  async function loadActivities(older = false) {
    if (loadingActivities.value) return;
    const current = key(), revision = generation;
    if (!current.flow) return;
    loadingActivities.value = true;
    try {
      const before = older && activities.value[0] ? "?before=" + activities.value[0].seq : "";
      const result = await connection.request<{ events: RoomEvent[]; hasMore: boolean }>("/api/v1/agile/flows/" + current.flow + "/activity" + before);
      if (revision !== generation) return;
      if (older) {
        browsingActivities.value = true;
        const seen = new Set(result.events.map(event => event.seq));
        activities.value = [...result.events, ...activities.value.filter(event => !seen.has(event.seq))].slice(0, LIMIT);
      } else {
        const last = result.events.at(-1)?.seq ?? 0;
        activities.value = [...result.events, ...(browsingActivities.value ? [] : activities.value.filter(event => event.seq > last))].slice(-LIMIT);
        browsingActivities.value = false; newActivities.value = 0;
      }
      moreActivities.value = result.hasMore; activityError.value = "";
    } catch (error) {
      if (revision === generation && !connection.signal.aborted) activityError.value = failureMessage(error);
    } finally { if (revision === generation) loadingActivities.value = false; }
  }
  function receiveActivity(event: RoomEvent) {
    if (browsingActivities.value) { newActivities.value++; return; }
    const list = activities.value, last = list.at(-1);
    if (!last || event.seq > last.seq) list.push(event);
    else if (!list.some(item => item.seq === event.seq)) { list.push(event); list.sort((a, b) => a.seq - b.seq); }
    if (list.length > LIMIT) { list.splice(0, list.length - LIMIT); moreActivities.value = true; }
  }
  watch([() => key().room, () => key().flow], () => {
    generation++; loadingActivities.value = false; activities.value = []; moreActivities.value = false;
    browsingActivities.value = false; newActivities.value = 0; activityError.value = "";
    void loadActivities();
  });
  return { activities, moreActivities, activityError, browsingActivities, newActivities, loadingActivities, loadActivities, receiveActivity };
}
