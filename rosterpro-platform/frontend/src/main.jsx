import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { AuthProvider } from "./store/AuthContext.jsx";
import { StationProvider } from "./store/StationContext.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StationProvider>
          <App />
        </StationProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
