import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import SignIn from "./pages/AuthPages/SignIn";
import SignUp from "./pages/AuthPages/SignUp";
import NotFound from "./pages/OtherPage/NotFound";
import AppLayout from "./layout/AppLayout";
import EnhancedHome from "./pages/Dashboard/EnhancedHome";
import MarketOverview from "./pages/Market/MarketOverview";
import Watchlist from "./pages/Market/Watchlist";
import NewsSentiment from "./pages/Market/NewsSentiment";
import RedditSentimentPage from "./pages/Market/RedditSentiment";
import EnhancedTradingDashboard from "./pages/EnhancedTradingDashboard";
import StockDetails from "./pages/Market/StockDetails";
import AccountProfile from "./pages/Account/Profile";
import AccountSettings from "./pages/Account/Settings";
import AccountAuthentication from "./pages/Account/Authentication";
import ProtectedRoute from "./components/auth/ProtectedRoute";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index path="/" element={<EnhancedHome />} />
          <Route path="/analytics/portfolio" element={<Navigate to="/trading" replace />} />
          <Route path="/trading" element={<EnhancedTradingDashboard />} />
          <Route path="/market/overview" element={<MarketOverview />} />
          <Route path="/market/stocks" element={<StockDetails />} />
          <Route path="/market/stocks/:symbol" element={<StockDetails />} />
          <Route path="/market/watchlist" element={<Watchlist />} />
          <Route path="/market/news" element={<NewsSentiment />} />
          <Route path="/market/reddit" element={<RedditSentimentPage />} />
          <Route path="/account/profile" element={<AccountProfile />} />
          <Route path="/account/settings" element={<AccountSettings />} />
          <Route path="/account/authentication" element={<AccountAuthentication />} />
        </Route>

        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/account/setup" element={<Navigate to="/signup" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}
