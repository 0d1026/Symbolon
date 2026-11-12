import { useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { TransitionProvider } from "./components/Transition";
import { Cursor } from "./components/Cursor";
import { Footer, Nav } from "./components/Chrome";
import { startSmoothScroll, ScrollTrigger } from "./lib/motion";
import { applyMeta } from "./lib/seo";
import Home from "./pages/Home";
import Attacks, { AttackDetail } from "./pages/Attacks";
import Wallet from "./pages/Wallet";
import Demo from "./pages/Demo";
import Verify from "./pages/Verify";
import Deployments from "./pages/Deployments";
import NotFound from "./pages/NotFound";

function Titles() {
  const { pathname } = useLocation();
  useEffect(() => {
    applyMeta(pathname);
    const id = setTimeout(() => ScrollTrigger.refresh(), 400);
    return () => clearTimeout(id);
  }, [pathname]);
  return null;
}

export default function App() {
  useEffect(() => { startSmoothScroll(); }, []);
  return (
    <BrowserRouter>
      <TransitionProvider>
        <Titles />
        <a className="skip" href="#main">Skip to content</a>
        <Nav />
        <div id="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/attacks" element={<Attacks />} />
            <Route path="/attacks/:slug" element={<AttackDetail />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/demo" element={<Demo />} />
            <Route path="/verify" element={<Verify />} />
            <Route path="/deployments" element={<Deployments />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        <Footer />
        <Cursor />
      </TransitionProvider>
    </BrowserRouter>
  );
}
