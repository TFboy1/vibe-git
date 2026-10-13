import { createRouter, createWebHistory } from "vue-router";
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.hash) return { el: to.hash, top: 24 };
    if (to.path !== from.path) return { left: 0, top: 0 };
    return false;
  },
  routes: [
    { path: "/", name: "code", component: () => import("./views/CodeView.vue"), meta: { title: "工作台", section: "code", searchPlaceholder: "搜索成员或工作" } },
    { path: "/plans", name: "room", component: () => import("./views/RoomView.vue"), meta: { title: "可选想法", section: "requirements" } },
    { path: "/requirements", name: "requirements", component: () => import("./views/RequirementsView.vue"), meta: { title: "团队需求", section: "requirements" } },
    { path: "/issues", alias: "/changes", name: "changes", component: () => import("./views/ChangesView.vue"), meta: { title: "需求变更", section: "issues", searchPlaceholder: "搜索需求变更" } },
    { path: "/pulls", name: "pulls", component: () => import("./views/PullRequestsView.vue"), meta: { title: "Pull requests", section: "pulls", searchPlaceholder: "搜索成员或分支" } },
    { path: "/agents", name: "agents", component: () => import("./views/AgentsView.vue"), meta: { title: "AI 分析建议", section: "agents" } },
    { path: "/projects", name: "projects", component: () => import("./views/ProjectsView.vue"), meta: { title: "任务与分工", section: "projects", searchPlaceholder: "搜索任务" } },
    { path: "/tasks", redirect: route => ({ path: "/projects", query: { ...route.query, view: "packages" } }) },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue"), meta: { title: "设置", section: "settings" } },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});
