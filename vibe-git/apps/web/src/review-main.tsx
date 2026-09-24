import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { IntroOverlay } from "./IntroOverlay";
import { getReviewRole, installReviewApi, setReviewRole, type ReviewRole } from "./reviewFixture";
import "./canvas/canvas.css";


import "./review.css";

installReviewApi();

function ReviewRoom() {
  const [role, selectRole] = useState<ReviewRole>(getReviewRole());
  const [key, setKey] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const roles: Array<[ReviewRole, string]> = [["captain", "队长 · Ivan"], ["chen", "成员 · 小芋头"], ["xu", "成员 · 汤神"]];
  return <div className={`review-room ${collapsed ? "identity-collapsed" : "identity-expanded"}`}>
    {collapsed ? <button className="view-switcher-launcher" type="button" aria-label="展开身份切换" title="展开身份切换" aria-expanded={false} onClick={() => setCollapsed(false)}>身份</button> : <div className="view-switcher" role="group" aria-label="查看身份">
      <span>查看身份</span>
      {roles.map(([id, label]) => <button key={id} type="button" aria-pressed={role === id} className={role === id ? "selected" : ""} onClick={() => {
        const url = new URL(location.href); for (const key of ["object","id","tab"]) url.searchParams.delete(key);
        history.replaceState(null,"",url); setReviewRole(id); selectRole(id); setKey((value) => value + 1);
      }}>{label}</button>)}
      <button className="view-switcher-minimize" type="button" aria-label="收起身份切换" title="收起身份切换" aria-expanded={true} onClick={() => setCollapsed(true)}>−</button>
    </div>}
    <App key={key}/>
    <IntroOverlay/>
  </div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ReviewRoom/></React.StrictMode>);
