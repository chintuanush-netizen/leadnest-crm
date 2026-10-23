import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import { SessionProvider } from "./context/Session";
import { isDemo } from "./lib/supabase";
import "./styles.css";

const Router = isDemo ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDemo && <div className="demo-banner">Demo mode: sample data, nothing is saved. A new Meta lead arrives about 8 seconds after opening.</div>}
    <Router>
      <SessionProvider>
        <App />
      </SessionProvider>
    </Router>
  </React.StrictMode>,
);
