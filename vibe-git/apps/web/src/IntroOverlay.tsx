import { useEffect, useState } from "react";

const KEY = "vibe-git-intro-seen-v20";
const seen = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; } };
const markSeen = () => { try { sessionStorage.setItem(KEY, "1"); } catch { /* The animation can still close. */ } };

export function IntroOverlay() {
  const [visible, setVisible] = useState(() => !seen() && !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const leave = () => { markSeen(); setLeaving(true); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" || event.key === "Enter") leave(); };
    window.addEventListener("keydown", onKey);
    const timer = window.setTimeout(leave, 2480);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [visible]);
  useEffect(() => { if (!leaving) return; const timer = window.setTimeout(() => setVisible(false), 760); return () => window.clearTimeout(timer); }, [leaving]);
  if (!visible) return null;
  return <div className={`intro-overlay ${leaving ? "leaving" : ""}`} aria-label="vibe-git 启动画面">
    <div className="intro-visual"><img src="/vibe-git-logo.png" alt="vibe-git 标志"/><span className="intro-eye-wink" aria-hidden="true"/>
      <div className="intro-lightning" aria-hidden="true"><svg viewBox="0 0 440 90" preserveAspectRatio="none"><path d="M3 55 L76 36 L105 59 L174 21 L205 43 L256 29 L288 51 L348 18 L377 38 L437 14"/></svg></div>
    </div>
    <button className="intro-skip" onClick={() => { markSeen(); setLeaving(true); }}>跳过动画</button>
  </div>;
}
