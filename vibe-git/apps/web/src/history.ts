import { failureMessage } from "./api";
import { onBeforeUnmount, ref, shallowRef } from "vue";
import { request } from "./api";

export function useHistory<T>(kind: string | (() => string)) {
  const items = shallowRef<T[]>([]), nextCursor = ref<number | null>(null), loading = ref(false), error = ref("");
  let controller: AbortController | undefined;
  async function load(older = false) {
    if (older && nextCursor.value === null) return;
    controller?.abort(); controller = new AbortController();
    const current = controller; loading.value = true; error.value = "";
    try {
      const page = await request<{ items: T[]; nextCursor: number | null }>("/api/v1/history/" + (typeof kind === "function" ? kind() : kind) + (older ? "?before=" + nextCursor.value : ""), undefined, undefined, { signal: current.signal });
      if (current.signal.aborted) return;
      items.value = page.items; nextCursor.value = page.nextCursor;
    } catch (e) { if (!current.signal.aborted) error.value = failureMessage(e); }
    finally { if (current === controller) loading.value = false; }
  }
  onBeforeUnmount(() => controller?.abort());
  return { items, nextCursor, loading, error, load };
}
