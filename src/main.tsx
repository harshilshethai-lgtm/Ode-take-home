import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { PersonaProvider } from "./lib/persona";
import { OrdersProvider } from "./lib/useWorklistState";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <TooltipProvider>
        <PersonaProvider>
          <OrdersProvider>
            <App />
          </OrdersProvider>
        </PersonaProvider>
      </TooltipProvider>
    </BrowserRouter>
  </StrictMode>,
);
