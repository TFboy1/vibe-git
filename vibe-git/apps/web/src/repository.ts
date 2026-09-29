import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useWorkspace } from "./store";

/** Repository links are browser preferences; code PRs remain in the Git hosting service. */
export const useRepository = defineStore("repository", () => {
  const workspace = useWorkspace(), remote = ref("");
  const key = computed(() => "vibe-repository:" + workspace.data?.room.id);
  watch(key, () => { try { remote.value = localStorage.getItem(key.value) ?? ""; } catch { remote.value = ""; } }, { immediate: true });
  const name = computed(() => workspace.project?.name || "vibe-git");
  const owner = computed(() => workspace.data?.nodes.find(node => node.role === "captain")?.label || "团队");
  const url = computed(() => {
    try { const value = new URL(remote.value); return value.protocol === "https:" || value.protocol === "http:" ? value : null; }
    catch { return null; }
  });
  const gitlab = computed(() => !!url.value && (url.value.hostname.includes("gitlab") || url.value.pathname.includes("/-/")));
  const pullUrl = computed(() => url.value ? url.value.href.replace(/\/$/, "") + (gitlab.value ? "/-/merge_requests" : "/pulls") : "");
  const compareUrl = computed(() => url.value ? url.value.href.replace(/\/$/, "") + (gitlab.value ? "/-/merge_requests/new" : "/compare") : "");
  function save(value: string) {
    const candidate = new URL(value.trim());
    if (!["https:", "http:"].includes(candidate.protocol) || candidate.username || candidate.password || candidate.search || candidate.hash)
      throw new Error("请输入不含凭据、查询参数的 HTTPS 或 HTTP 仓库地址");
    candidate.pathname = candidate.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "");
    if (!candidate.pathname || candidate.pathname === "/") throw new Error("请填写完整的仓库页面地址");
    const next = candidate.href.replace(/\/$/, "");
    localStorage.setItem(key.value, next); remote.value = next;
  }
  return { name, owner, remote, url, gitlab, pullUrl, compareUrl, save };
});
