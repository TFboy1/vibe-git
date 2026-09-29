import { createRouter, createWebHistory } from "vue-router";
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "room", component: () => import("./views/RoomView.vue"), meta: { title: "房间与计划", eyebrow: "THE ROOM" } },
    { path: "/requirements", name: "requirements", component: () => import("./views/RequirementsView.vue"), meta: { title: "需求文档", eyebrow: "THE DOCUMENT" } },
    { path: "/tasks", name: "tasks", component: () => import("./views/TasksView.vue"), meta: { title: "任务包", eyebrow: "THE WORK" } },
    { path: "/changes", name: "changes", component: () => import("./views/ChangesView.vue"), meta: { title: "需求变更", eyebrow: "THE NEXT ITERATION" } },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});
