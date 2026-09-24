import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { IntroOverlay } from "./IntroOverlay";
import "./canvas/canvas.css";



ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /><IntroOverlay /></React.StrictMode>);
