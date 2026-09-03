import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import "./shared/ui/tokens.css";
import "./shared/ui/row.css";      // 줄 문법·선택 칩 — 두 화면 이상이 쓴다
import "./shared/ui/components.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
