import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles/tokens.css";
import "./styles/global.css";
import { Player } from "./routes/Player";
import { Host } from "./routes/Host";
import { Screen } from "./routes/Screen";
import { Toasts } from "./components/Toast";

const router = createBrowserRouter([
  { path: "/", element: <Player /> },
  { path: "/host", element: <Host /> },
  { path: "/screen", element: <Screen /> },
  { path: "*", element: <Player /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <Toasts />
  </React.StrictMode>,
);
