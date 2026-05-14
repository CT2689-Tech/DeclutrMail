import { Route, Routes } from "react-router-dom";
import Landing from "@/pages/Landing";
import Pricing from "@/pages/Pricing";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/pricing" element={<Pricing />} />
    </Routes>
  );
}
