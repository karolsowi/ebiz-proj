import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import "./index.css";
import "swiper/swiper-bundle.css";
import "flatpickr/dist/flatpickr.css";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { AuthProvider } from "./context/AuthContext.tsx";
import { ErrorBoundary } from "./components/common/ErrorBoundary.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <AppWrapper>
            <App />
          </AppWrapper>
        </ThemeProvider>
      </AuthProvider>
      {/* Global toast notifications — used via react-hot-toast anywhere in the app */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "var(--toast-bg, #1f2937)",
            color: "var(--toast-color, #f9fafb)",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
          },
          success: { iconTheme: { primary: "#22c55e", secondary: "#fff" } },
          error: { iconTheme: { primary: "#ef4444", secondary: "#fff" }, duration: 6000 },
        }}
      />
    </ErrorBoundary>
  </StrictMode>,
);
