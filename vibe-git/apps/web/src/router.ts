import { createRouter, createWebHistory } from "vue-router";
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "code", component: () => import("./views/CodeView.vue"), meta: { title: "Code", section: "code" } },
    { path: "/plans", name: "room", component: () => import("./views/RoomView.vue"), meta: { title: "个人计划", section: "code" } },
    { path: "/requirements", name: "requirements", component: () => import("./views/RequirementsView.vue"), meta: { title: "Wiki · 需求文档", section: "requirements" } },
    { path: "/issues", alias: "/changes", name: "changes", component: () => import("./views/ChangesView.vue"), meta: { title: "Issues", section: "issues" } },
    { path: "/pulls", name: "pulls", component: () => import("./views/PullRequestsView.vue"), meta: { title: "Pull requests", section: "pulls" } },
    { path: "/agents", name: "agents", component: () => import("./views/AgentsView.vue"), meta: { title: "Agents", section: "agents" } },
    { path: "/projects", name: "projects", component: () => import("./views/ProjectsView.vue"), meta: { title: "Projects", section: "projects" } },
    { path: "/tasks", redirect: route => ({ path: "/projects", query: { ...route.query, view: "packages" } }) },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue"), meta: { title: "Settings", section: "settings" } },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});
