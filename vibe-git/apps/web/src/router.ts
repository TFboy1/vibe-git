import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
export const router = createRouter({
  history: createWebHistory(),
  async scrollBehavior(to, from, savedPosition) {
    await nextTick();
    if (savedPosition) return savedPosition;
    const anchor = to.hash ? document.getElementById(to.hash.slice(1)) : null;
    if (anchor) return { el: anchor, top: 24 };
    if (to.path !== from.path || to.query.task !== from.query.task || to.query.change !== from.query.change || to.query.batch !== from.query.batch || to.query.view !== from.query.view) return { left: 0, top: 0 };
    return false;
  },
  routes: [
    { path: "/", beforeEnter: to => to.query.q ? { path: "/execute", query: { ...to.query, view: "progress" }, hash: to.hash } : true, name: "code", component: () => import("./views/CodeView.vue"), meta: { title: "工作台", section: "code" } },
    { path: "/plans", name: "room", component: () => import("./views/RoomView.vue"), meta: { title: "可选想法", section: "requirements" } },
    { path: "/requirements", name: "requirements", component: () => import("./views/RequirementsView.vue"), meta: { title: "团队需求", section: "requirements" } },
    { path: "/issues", alias: "/changes", name: "changes", component: () => import("./views/ChangesView.vue"), meta: { title: "需求变更", section: "review", searchPlaceholder: "搜索需求变更" } },
    { path: "/pulls", name: "pulls", component: () => import("./views/PullRequestsView.vue"), meta: { title: "代码合并请求", section: "review", searchPlaceholder: "搜索成员或分支" } },
    { path: "/agents", name: "agents", component: () => import("./views/AgentsView.vue"), meta: { title: "AI 分析建议", section: "agents" } },
    { path: "/projects", name: "projects", component: () => import("./views/ProjectsView.vue"), meta: { title: "任务与分工", section: "projects", searchPlaceholder: "搜索任务" } },
    { path: "/execute", name: "execution", component: () => import("./views/ProjectsView.vue"), meta: { title: "执行任务", section: "execution", searchPlaceholder: "搜索任务或成员" } },
    { path: "/tasks", redirect: route => ({ path: "/projects", query: { ...route.query, view: "packages" }, hash: route.hash }) },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue"), meta: { title: "设置", section: "settings" } },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});
