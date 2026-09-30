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
    { path: "/", name: "code", component: () => import("./views/CodeView.vue"), meta: { title: "Code", section: "code", searchPlaceholder: "搜索成员或工作" } },
    { path: "/plans", name: "room", component: () => import("./views/RoomView.vue"), meta: { title: "个人计划", section: "code" } },
    { path: "/requirements", name: "requirements", component: () => import("./views/RequirementsView.vue"), meta: { title: "Wiki · 需求文档", section: "requirements" } },
    { path: "/issues", alias: "/changes", name: "changes", component: () => import("./views/ChangesView.vue"), meta: { title: "Issues", section: "issues", searchPlaceholder: "搜索需求 Issues" } },
    { path: "/pulls", name: "pulls", component: () => import("./views/PullRequestsView.vue"), meta: { title: "Pull requests", section: "pulls", searchPlaceholder: "搜索成员或分支" } },
    { path: "/agents", name: "agents", component: () => import("./views/AgentsView.vue"), meta: { title: "Agents", section: "agents" } },
    { path: "/projects", name: "projects", component: () => import("./views/ProjectsView.vue"), meta: { title: "Projects", section: "projects", searchPlaceholder: "搜索任务" } },
    { path: "/tasks", redirect: route => ({ path: "/projects", query: { ...route.query, view: "packages" } }) },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue"), meta: { title: "Settings", section: "settings" } },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});
